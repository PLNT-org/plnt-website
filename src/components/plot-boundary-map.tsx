'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, Trash2, Navigation, Layers, Pencil, MapPin } from 'lucide-react'

// Fix Leaflet default marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

interface Plot {
  id: string
  name: string
  boundaries?: GeoJSONPolygon
  species?: {
    id: string
    name: string
  }
}

interface Orthomosaic {
  id: string
  name: string
  orthomosaic_url?: string
  webodm_project_id?: string
  webodm_task_id?: string
  bounds?: {
    north: number
    south: number
    east: number
    west: number
  }
}

interface MarkerRegistration {
  id: string
  aruco_marker_id: number
  latitude: number
  longitude: number
  species?: {
    id: string
    name: string
    scientific_name?: string
  }
  registered_at: string
  plot_name?: string
}

interface PlotBoundaryMapProps {
  onBoundaryDrawn?: (boundary: GeoJSONPolygon, areaAcres: number) => void
  onBoundaryCleared?: () => void
  existingBoundary?: GeoJSONPolygon
  otherPlots?: Plot[]
  orthomosaics?: Orthomosaic[]
  selectedOrthomosaicId?: string
  onOrthomosaicChange?: (id: string | null) => void
  defaultCenter?: [number, number]
  defaultZoom?: number
  height?: string
  readOnly?: boolean // Disable drawing functionality (for view-only mode)
  // New props for consolidated page
  onPlotClick?: (plot: Plot) => void
  selectedPlotId?: string | null
  isDrawingMode?: boolean // External control of drawing mode
  onDrawingModeChange?: (isDrawing: boolean) => void
  // Marker visualization
  markers?: MarkerRegistration[]
  showMarkers?: boolean
  onShowMarkersChange?: (show: boolean) => void
}

// Generate consistent color from string (for plot colors)
function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
    '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
  ]
  return colors[Math.abs(hash) % colors.length]
}

// Calculate area of polygon in acres using Shoelace formula with spherical correction
function calculateAreaAcres(latlngs: L.LatLng[]): number {
  if (latlngs.length < 3) return 0

  const earthRadius = 6371000 // meters
  let area = 0

  for (let i = 0; i < latlngs.length; i++) {
    const j = (i + 1) % latlngs.length
    const lat1 = (latlngs[i].lat * Math.PI) / 180
    const lat2 = (latlngs[j].lat * Math.PI) / 180
    const lng1 = (latlngs[i].lng * Math.PI) / 180
    const lng2 = (latlngs[j].lng * Math.PI) / 180

    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2))
  }

  area = Math.abs((area * earthRadius * earthRadius) / 2)
  const acres = area * 0.000247105 // Convert square meters to acres
  return Math.round(acres * 100) / 100
}

export default function PlotBoundaryMap({
  onBoundaryDrawn,
  onBoundaryCleared,
  existingBoundary,
  otherPlots = [],
  orthomosaics = [],
  selectedOrthomosaicId,
  onOrthomosaicChange,
  defaultCenter = [34.0522, -118.2437],
  defaultZoom = 18,
  height = '500px',
  readOnly = false,
  onPlotClick,
  selectedPlotId,
  isDrawingMode,
  onDrawingModeChange,
  markers = [],
  showMarkers: showMarkersProp,
  onShowMarkersChange,
}: PlotBoundaryMapProps) {
  const mapContainerId = useRef(`plot-boundary-map-${Math.random().toString(36).substr(2, 9)}`)
  const mapRef = useRef<L.Map | null>(null)
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null)
  const otherPlotsLayerRef = useRef<L.LayerGroup | null>(null)
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const orthomosaicLayerRef = useRef<L.TileLayer | null>(null)
  const drawingPolygonRef = useRef<L.Polygon | null>(null)
  const rubberBandLineRef = useRef<L.Polyline | null>(null)
  const closingLineRef = useRef<L.Polyline | null>(null)
  const drawingPointsRef = useRef<L.LatLng[]>([])
  const pointMarkersRef = useRef<L.CircleMarker[]>([])

  const [searchAddress, setSearchAddress] = useState('')
  const [isDrawing, setIsDrawingInternal] = useState(false)
  const [showOrtho, setShowOrtho] = useState(false)
  const [areaAcres, setAreaAcres] = useState<number | null>(null)
  const [showMarkersInternal, setShowMarkersInternal] = useState(false)

  // Use prop if provided, otherwise use internal state
  const showMarkers = showMarkersProp !== undefined ? showMarkersProp : showMarkersInternal
  const setShowMarkers = (value: boolean) => {
    setShowMarkersInternal(value)
    onShowMarkersChange?.(value)
  }

  // Wrapper to sync internal drawing state with external control
  const setIsDrawing = (value: boolean) => {
    setIsDrawingInternal(value)
    onDrawingModeChange?.(value)
  }

  // Sync external drawing mode control
  useEffect(() => {
    if (isDrawingMode !== undefined && isDrawingMode !== isDrawing) {
      if (isDrawingMode) {
        startDrawing()
      } else if (isDrawing) {
        // Cancel drawing without finishing
        cancelDrawing()
      }
    }
  }, [isDrawingMode])

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(mapContainerId.current, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: true,
    })

    // Satellite base layer
    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      attribution: '© Google',
      maxZoom: 22,
    }).addTo(map)

    // Feature groups
    const drawnItems = new L.FeatureGroup()
    map.addLayer(drawnItems)
    drawnItemsRef.current = drawnItems

    const otherPlotsLayer = new L.LayerGroup()
    map.addLayer(otherPlotsLayer)
    otherPlotsLayerRef.current = otherPlotsLayer

    // Layer for registered markers
    const markersLayer = new L.LayerGroup()
    map.addLayer(markersLayer)
    markersLayerRef.current = markersLayer

    // Scale control
    L.control.scale({ position: 'bottomleft', metric: true, imperial: true }).addTo(map)

    mapRef.current = map

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Load existing boundary
  useEffect(() => {
    if (!mapRef.current || !drawnItemsRef.current || !existingBoundary) return

    drawnItemsRef.current.clearLayers()

    // Convert GeoJSON to Leaflet format [lat, lng]
    const coords = existingBoundary.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number])

    const polygon = L.polygon(coords, {
      color: '#10b981',
      weight: 3,
      fillColor: '#10b981',
      fillOpacity: 0.2,
    })

    drawnItemsRef.current.addLayer(polygon)
    mapRef.current.fitBounds(polygon.getBounds(), { padding: [50, 50] })

    const latlngs = coords.map(([lat, lng]) => new L.LatLng(lat, lng))
    setAreaAcres(calculateAreaAcres(latlngs))
  }, [existingBoundary])

  // Load other plots
  useEffect(() => {
    if (!mapRef.current || !otherPlotsLayerRef.current) return

    otherPlotsLayerRef.current.clearLayers()

    otherPlots.forEach((plot) => {
      if (!plot.boundaries?.coordinates) return

      const coords = plot.boundaries.coordinates[0].map(
        ([lng, lat]) => [lat, lng] as [number, number]
      )
      const isSelected = plot.id === selectedPlotId
      const color = isSelected ? '#10b981' : stringToColor(plot.species?.id || plot.id)

      const polygon = L.polygon(coords, {
        color,
        weight: isSelected ? 4 : 2,
        fillColor: color,
        fillOpacity: isSelected ? 0.3 : 0.15,
        dashArray: isSelected ? undefined : '5, 5',
      })

      // Click to select plot
      if (onPlotClick) {
        polygon.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onPlotClick(plot)
        })
        polygon.setStyle({ cursor: 'pointer' })
      } else {
        // Fallback to popup if no click handler
        polygon.bindPopup(`
          <div style="min-width: 120px;">
            <strong>${plot.name}</strong>
            ${plot.species ? `<br/><span style="color: #666;">${plot.species.name}</span>` : ''}
          </div>
        `)
      }

      otherPlotsLayerRef.current?.addLayer(polygon)
    })
  }, [otherPlots, selectedPlotId, onPlotClick])

  // Load orthomosaic overlay using WebODM tiles
  useEffect(() => {
    if (!mapRef.current) return

    // Remove existing orthomosaic layer
    if (orthomosaicLayerRef.current) {
      mapRef.current.removeLayer(orthomosaicLayerRef.current)
      orthomosaicLayerRef.current = null
    }

    if (!showOrtho || !selectedOrthomosaicId) return

    const ortho = orthomosaics.find((o) => o.id === selectedOrthomosaicId)
    if (!ortho?.bounds) return

    // Need webodm_project_id and webodm_task_id for tile URL
    if (!ortho.webodm_project_id || !ortho.webodm_task_id) {
      console.warn('Orthomosaic missing WebODM project/task IDs')
      return
    }

    // Use our tile proxy API (handles WebODM authentication)
    const tileUrl = `/api/orthomosaic/tiles/${ortho.webodm_project_id}/${ortho.webodm_task_id}/{z}/{x}/{y}`

    const bounds = L.latLngBounds(
      [ortho.bounds.south, ortho.bounds.west],
      [ortho.bounds.north, ortho.bounds.east]
    )

    const tileLayer = L.tileLayer(tileUrl, {
      bounds,
      opacity: 0.9,
      maxZoom: 24,
      maxNativeZoom: 22,
    })
    tileLayer.addTo(mapRef.current)
    orthomosaicLayerRef.current = tileLayer

    // Fit map to orthomosaic bounds
    mapRef.current.fitBounds(bounds, { padding: [20, 20] })
  }, [showOrtho, selectedOrthomosaicId, orthomosaics])

  // Render registered markers
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return

    markersLayerRef.current.clearLayers()

    if (!showMarkers || markers.length === 0) return

    // Create a custom icon for markers
    const markerIcon = L.divIcon({
      className: 'custom-marker-icon',
      html: `<div style="
        width: 12px;
        height: 12px;
        background: #ec4899;
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    })

    markers.forEach((marker) => {
      const leafletMarker = L.marker([marker.latitude, marker.longitude], {
        icon: markerIcon,
      })

      // Popup with marker info
      const popupContent = `
        <div style="min-width: 150px;">
          <strong>ArUco #${marker.aruco_marker_id}</strong>
          ${marker.species ? `<br/><span style="color: #059669;">${marker.species.name}</span>` : ''}
          ${marker.species?.scientific_name ? `<br/><em style="color: #6b7280; font-size: 12px;">${marker.species.scientific_name}</em>` : ''}
          ${marker.plot_name ? `<br/><span style="color: #6b7280; font-size: 12px;">Plot: ${marker.plot_name}</span>` : ''}
          <br/><span style="color: #9ca3af; font-size: 11px;">${new Date(marker.registered_at).toLocaleDateString()}</span>
        </div>
      `
      leafletMarker.bindPopup(popupContent)

      markersLayerRef.current?.addLayer(leafletMarker)
    })
  }, [showMarkers, markers])

  // Drawing functions
  const startDrawing = useCallback(() => {
    if (!mapRef.current || !drawnItemsRef.current) return

    setIsDrawing(true)
    drawnItemsRef.current.clearLayers()
    drawingPointsRef.current = []
    pointMarkersRef.current.forEach((m) => m.remove())
    pointMarkersRef.current = []
    setAreaAcres(null)

    const map = mapRef.current

    const handleClick = (e: L.LeafletMouseEvent) => {
      const latlng = e.latlng
      drawingPointsRef.current.push(latlng)

      // Add point marker
      const marker = L.circleMarker(latlng, {
        radius: 6,
        fillColor: '#10b981',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1,
      })
      marker.addTo(map)
      pointMarkersRef.current.push(marker)

      // Update preview polygon
      if (drawingPolygonRef.current) {
        drawingPolygonRef.current.remove()
      }

      if (drawingPointsRef.current.length >= 2) {
        drawingPolygonRef.current = L.polygon(drawingPointsRef.current, {
          color: '#10b981',
          weight: 2,
          fillColor: '#10b981',
          fillOpacity: 0.1,
          dashArray: '5, 5',
        }).addTo(map)
      }
    }

    const handleDblClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e)
      finishDrawing()
    }

    const handleContextMenu = (e: L.LeafletMouseEvent) => {
      L.DomEvent.preventDefault(e)
      finishDrawing()
    }

    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (drawingPointsRef.current.length > 0) {
        const lastPoint = drawingPointsRef.current[drawingPointsRef.current.length - 1]

        // Remove previous rubber band line
        if (rubberBandLineRef.current) {
          rubberBandLineRef.current.remove()
        }

        // Draw rubber band line from last point to cursor
        rubberBandLineRef.current = L.polyline([lastPoint, e.latlng], {
          color: '#10b981',
          weight: 2,
          dashArray: '5, 10',
          opacity: 0.7,
        }).addTo(map)

        // Also show preview of closing line if we have 2+ points
        if (drawingPointsRef.current.length >= 2) {
          if (closingLineRef.current) {
            closingLineRef.current.remove()
          }
          const firstPoint = drawingPointsRef.current[0]
          closingLineRef.current = L.polyline([e.latlng, firstPoint], {
            color: '#10b981',
            weight: 2,
            dashArray: '3, 6',
            opacity: 0.4,
          }).addTo(map)
        }
      }
    }

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)
    map.on('contextmenu', handleContextMenu)
    map.on('mousemove', handleMouseMove)
    map.doubleClickZoom.disable()

    // Store handlers for cleanup
    ;(map as any)._drawingHandlers = { handleClick, handleDblClick, handleContextMenu, handleMouseMove }
  }, [])

  const finishDrawing = useCallback(() => {
    if (!mapRef.current || !drawnItemsRef.current) return

    const map = mapRef.current
    const points = drawingPointsRef.current

    // Remove handlers
    const handlers = (map as any)._drawingHandlers
    if (handlers) {
      map.off('click', handlers.handleClick)
      map.off('dblclick', handlers.handleDblClick)
      map.off('contextmenu', handlers.handleContextMenu)
      map.off('mousemove', handlers.handleMouseMove)
    }
    map.doubleClickZoom.enable()

    // Clean up drawing elements
    if (drawingPolygonRef.current) {
      drawingPolygonRef.current.remove()
      drawingPolygonRef.current = null
    }
    if (rubberBandLineRef.current) {
      rubberBandLineRef.current.remove()
      rubberBandLineRef.current = null
    }
    if (closingLineRef.current) {
      closingLineRef.current.remove()
      closingLineRef.current = null
    }
    pointMarkersRef.current.forEach((m) => m.remove())
    pointMarkersRef.current = []

    setIsDrawing(false)

    if (points.length < 3) {
      alert('Please draw at least 3 points to create a polygon')
      return
    }

    // Create final polygon
    const polygon = L.polygon(points, {
      color: '#10b981',
      weight: 3,
      fillColor: '#10b981',
      fillOpacity: 0.2,
    })
    drawnItemsRef.current.addLayer(polygon)

    // Calculate area
    const acres = calculateAreaAcres(points)
    setAreaAcres(acres)

    // Convert to GeoJSON
    const geoJson: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [points.map((p) => [p.lng, p.lat])],
    }

    // Close the polygon
    geoJson.coordinates[0].push(geoJson.coordinates[0][0])

    onBoundaryDrawn?.(geoJson, acres)
  }, [onBoundaryDrawn])

  const clearDrawing = useCallback(() => {
    if (!drawnItemsRef.current) return

    drawnItemsRef.current.clearLayers()
    drawingPointsRef.current = []
    pointMarkersRef.current.forEach((m) => m.remove())
    pointMarkersRef.current = []
    setAreaAcres(null)
    setIsDrawingInternal(false)
    onDrawingModeChange?.(false)

    if (drawingPolygonRef.current) {
      drawingPolygonRef.current.remove()
      drawingPolygonRef.current = null
    }
    if (rubberBandLineRef.current) {
      rubberBandLineRef.current.remove()
      rubberBandLineRef.current = null
    }
    if (closingLineRef.current) {
      closingLineRef.current.remove()
      closingLineRef.current = null
    }

    onBoundaryCleared?.()
  }, [onBoundaryCleared, onDrawingModeChange])

  // Cancel drawing without finishing (for external control)
  const cancelDrawing = useCallback(() => {
    if (!mapRef.current) return

    const map = mapRef.current

    // Remove handlers
    const handlers = (map as any)._drawingHandlers
    if (handlers) {
      map.off('click', handlers.handleClick)
      map.off('dblclick', handlers.handleDblClick)
      map.off('contextmenu', handlers.handleContextMenu)
      map.off('mousemove', handlers.handleMouseMove)
    }
    map.doubleClickZoom.enable()

    // Clean up drawing elements
    if (drawingPolygonRef.current) {
      drawingPolygonRef.current.remove()
      drawingPolygonRef.current = null
    }
    if (rubberBandLineRef.current) {
      rubberBandLineRef.current.remove()
      rubberBandLineRef.current = null
    }
    if (closingLineRef.current) {
      closingLineRef.current.remove()
      closingLineRef.current = null
    }
    pointMarkersRef.current.forEach((m) => m.remove())
    pointMarkersRef.current = []
    drawingPointsRef.current = []

    setIsDrawingInternal(false)
  }, [])

  const searchLocation = async () => {
    if (!searchAddress.trim() || !mapRef.current) return

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}`
      )
      const data = await response.json()

      if (data && data.length > 0) {
        const { lat, lon } = data[0]
        mapRef.current.setView([parseFloat(lat), parseFloat(lon)], 18)
      } else {
        alert('Location not found')
      }
    } catch (error) {
      console.error('Search error:', error)
    }
  }

  const getCurrentLocation = () => {
    if (!mapRef.current || !('geolocation' in navigator)) return

    navigator.geolocation.getCurrentPosition(
      (position) => {
        mapRef.current?.setView([position.coords.latitude, position.coords.longitude], 18)
      },
      (error) => {
        console.error('Geolocation error:', error)
        alert('Could not get your location')
      }
    )
  }

  return (
    <div className="relative" style={{ height }}>
      {/* Map container */}
      <div id={mapContainerId.current} className="w-full h-full rounded-lg" />

      {/* Controls overlay */}
      <div className="absolute top-3 left-14 right-3 flex flex-wrap gap-2 z-[1000]">
        {/* Search */}
        <div className="flex gap-1 bg-white rounded-lg shadow-md">
          <Input
            type="text"
            placeholder="Search location..."
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchLocation()}
            className="w-48 h-9 text-sm border-0"
          />
          <Button variant="ghost" size="sm" onClick={searchLocation} className="h-9 px-2">
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* Location button */}
        <Button
          size="sm"
          onClick={getCurrentLocation}
          className="h-9 shadow-md bg-white hover:bg-gray-100 text-gray-700"
        >
          <Navigation className="h-4 w-4" />
        </Button>

        {/* Show markers toggle */}
        {markers.length > 0 && (
          <Button
            size="sm"
            onClick={() => setShowMarkers(!showMarkers)}
            className={`h-9 shadow-md ${
              showMarkers
                ? 'bg-pink-600 hover:bg-pink-700 text-white'
                : 'bg-white hover:bg-gray-100 text-gray-700'
            }`}
            title={`${showMarkers ? 'Hide' : 'Show'} ${markers.length} registered markers`}
          >
            <MapPin className="h-4 w-4 mr-1" />
            {markers.length}
          </Button>
        )}

        {/* Layer selector */}
        <div className="flex items-center gap-2 bg-white rounded-lg shadow-md px-2">
          <Layers className="h-4 w-4 text-gray-500" />
          <Select
            value={showOrtho && selectedOrthomosaicId ? selectedOrthomosaicId : 'satellite'}
            onValueChange={(value) => {
              if (value === 'satellite') {
                setShowOrtho(false)
                onOrthomosaicChange?.(null)
              } else {
                setShowOrtho(true)
                onOrthomosaicChange?.(value)
              }
            }}
          >
            <SelectTrigger className="w-44 h-9 border-0 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[1100]">
              <SelectItem value="satellite">Satellite</SelectItem>
              {orthomosaics.length > 0 ? (
                orthomosaics.map((ortho) => (
                  <SelectItem key={ortho.id} value={ortho.id}>
                    {ortho.name}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="no-ortho" disabled>
                  No orthomosaics uploaded
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Drawing controls - only show when not in readOnly mode */}
      {!readOnly && (
        <div className="absolute bottom-3 left-3 flex gap-2 z-[1000]">
          {!isDrawing ? (
            <Button onClick={startDrawing} className="shadow-md bg-green-600 hover:bg-green-700">
              <Pencil className="h-4 w-4 mr-2" />
              Draw Boundary
            </Button>
          ) : (
            <div className="bg-white rounded-lg shadow-md px-3 py-2 text-sm">
              <span className="text-green-600 font-medium">Drawing mode</span>
              <span className="text-gray-500 ml-2">
                Click to add points, double-click or right-click to finish
              </span>
            </div>
          )}

          {(areaAcres !== null || existingBoundary) && (
            <Button variant="outline" onClick={clearDrawing} className="shadow-md">
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Area display */}
      {areaAcres !== null && (
        <div className="absolute bottom-3 right-3 bg-white rounded-lg shadow-md px-3 py-2 z-[1000]">
          <span className="text-gray-600 text-sm">Area: </span>
          <span className="font-bold text-green-600">{areaAcres.toFixed(2)} acres</span>
        </div>
      )}
    </div>
  )
}
