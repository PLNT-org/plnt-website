'use client'

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Patch Leaflet's getPosition to guard against undefined elements
// during React unmount/remount cycles
const originalGetPosition = L.DomUtil.getPosition
L.DomUtil.getPosition = function (el) {
  if (!el) return new L.Point(0, 0)
  return originalGetPosition.call(this, el)
}

// Add custom styles to fix focus outline on polygons
const customStyles = `
  .leaflet-interactive:focus {
    outline: none !important;
  }
  .leaflet-container svg path:focus {
    outline: none !important;
  }
  .leaflet-overlay-pane svg path {
    outline: none !important;
  }
`

// Inject custom styles
if (typeof document !== 'undefined') {
  const styleId = 'orthomosaic-map-custom-styles'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = customStyles
    document.head.appendChild(style)
  }
}

// Fix default marker icon issue with Leaflet + webpack
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface Orthomosaic {
  id: string
  name: string
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  orthomosaic_url: string | null
  tiles_url?: string | null
  resolution_cm?: number | null
  image_width?: number | null
  image_height?: number | null
}

interface PlantLabel {
  id: string
  latitude: number
  longitude: number
  pixel_x?: number
  pixel_y?: number
  source: 'manual' | 'ai'
  confidence?: number
  label: string
  notes?: string
  verified: boolean
}

interface ArUcoMarker {
  id: string
  marker_id: number
  latitude: number
  longitude: number
  pixel_x?: number
  pixel_y?: number
  confidence?: number
  rotation_deg?: number
  corner_coords?: number[][]
  verified: boolean
}

interface Plot {
  id: string
  name: string
  boundaries: any // GeoJSON Polygon
  species_name?: string
  plant_count?: number
}

interface OrthomosaicMapProps {
  orthomosaic: Orthomosaic
  labels: PlantLabel[]
  labelMode: boolean
  selectedLabelType: string
  onAddLabel: (lat: number, lng: number, pixelX?: number, pixelY?: number) => void
  onDeleteLabel: (labelId: string) => void
  onVerifyLabel: (labelId: string, verified: boolean) => void
  arucoMarkers?: ArUcoMarker[]
  onVerifyArucoMarker?: (markerId: string, verified: boolean) => void
  plots?: Plot[]
}

// Color palette for different label types
const labelColors: Record<string, string> = {
  plant: '#22c55e',    // green
  healthy: '#10b981',  // emerald
  stressed: '#f59e0b', // amber
  dead: '#ef4444',     // red
  weed: '#8b5cf6',     // purple
}

// Get color for a label
const getLabelColor = (label: string) => labelColors[label] || labelColors.plant

// Color palette for plot boundaries
const plotColors = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#eab308', // yellow
  '#06b6d4', // cyan
  '#f43f5e', // rose
]

export default function OrthomosaicMap({
  orthomosaic,
  labels,
  labelMode,
  selectedLabelType,
  onAddLabel,
  onDeleteLabel,
  onVerifyLabel,
  arucoMarkers = [],
  onVerifyArucoMarker,
  plots = [],
}: OrthomosaicMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const orthophotoLayerRef = useRef<L.TileLayer | null>(null)
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const arucoLayerRef = useRef<L.LayerGroup | null>(null)
  const plotsLayerRef = useRef<L.LayerGroup | null>(null)
  const [showOrthophoto, setShowOrthophoto] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showSatellite, setShowSatellite] = useState(true)
  const [showArucoMarkers, setShowArucoMarkers] = useState(true)
  const [showPlots, setShowPlots] = useState(true)

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const { north, south, east, west } = orthomosaic.bounds
    const center: [number, number] = [(north + south) / 2, (east + west) / 2]

    const map = L.map(mapContainerRef.current, {
      center,
      zoom: 18,
      maxZoom: 24,
      minZoom: 10,
    })

    // Base satellite layer
    const satelliteLayer = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      {
        attribution: 'Imagery &copy; Google',
        maxZoom: 24,
      }
    )
    satelliteLayer.addTo(map)

    // Orthophoto layer — prefer pre-generated tiles, fall back to image overlay
    if (orthomosaic.tiles_url) {
      // Pre-generated XYZ tiles in Supabase Storage
      const orthophotoLayer = L.tileLayer(orthomosaic.tiles_url, {
        maxZoom: 24,
        minZoom: 10,
        opacity: 0.9,
        bounds: [[south, west], [north, east]],
      })
      orthophotoLayer.addTo(map)
      orthophotoLayerRef.current = orthophotoLayer
    } else if (orthomosaic.orthomosaic_url) {
      // Extract project and task IDs from the URL to build proxy tiles URL
      const urlMatch = orthomosaic.orthomosaic_url.match(/projects\/(\d+)\/tasks\/([^/]+)/)

      if (urlMatch) {
        const [, projectId, taskId] = urlMatch
        const tilesUrl = `/api/orthomosaic/tiles/${projectId}/${taskId}/{z}/{x}/{y}`

        const orthophotoLayer = L.tileLayer(tilesUrl, {
          maxZoom: 24,
          minZoom: 15,
          opacity: 0.9,
          bounds: [[south, west], [north, east]],
        })
        orthophotoLayer.addTo(map)
        orthophotoLayerRef.current = orthophotoLayer
      } else {
        // Direct image overlay (Supabase Storage URL, demo image, etc.)
        const bounds: L.LatLngBoundsExpression = [[south, west], [north, east]]
        const imageLayer = L.imageOverlay(orthomosaic.orthomosaic_url, bounds, {
          opacity: 0.9,
        }) as any
        imageLayer.addTo(map)
        orthophotoLayerRef.current = imageLayer
      }
    }

    // Plots layer (below markers so boundaries don't cover plants)
    const plotsLayer = L.layerGroup().addTo(map)
    plotsLayerRef.current = plotsLayer

    // Markers layer
    const markersLayer = L.layerGroup().addTo(map)
    markersLayerRef.current = markersLayer

    // ArUco markers layer
    const arucoLayer = L.layerGroup().addTo(map)
    arucoLayerRef.current = arucoLayer

    // Fit bounds
    map.fitBounds([
      [south, west],
      [north, east],
    ])

    // Add scale control
    L.control.scale({ position: 'bottomleft' }).addTo(map)

    mapRef.current = map

    return () => {
      map.off()
      map.remove()
      mapRef.current = null
      orthophotoLayerRef.current = null
      markersLayerRef.current = null
      arucoLayerRef.current = null
      plotsLayerRef.current = null
    }
  }, [orthomosaic])

  // Handle click for labeling
  useEffect(() => {
    if (!mapRef.current) return

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (!labelMode) return

      const { lat, lng } = e.latlng

      // Calculate pixel coordinates if we have image dimensions
      let pixelX, pixelY
      if (orthomosaic.image_width && orthomosaic.image_height) {
        const { north, south, east, west } = orthomosaic.bounds
        const latRatio = (north - lat) / (north - south)
        const lngRatio = (lng - west) / (east - west)
        pixelX = Math.round(lngRatio * orthomosaic.image_width)
        pixelY = Math.round(latRatio * orthomosaic.image_height)
      }

      onAddLabel(lat, lng, pixelX, pixelY)
    }

    mapRef.current.on('click', handleClick)

    return () => {
      mapRef.current?.off('click', handleClick)
    }
  }, [labelMode, orthomosaic, onAddLabel])

  // Update cursor based on label mode
  useEffect(() => {
    if (!mapContainerRef.current) return
    mapContainerRef.current.style.cursor = labelMode ? 'crosshair' : 'grab'
  }, [labelMode])

  // Update markers when labels change
  useEffect(() => {
    if (!markersLayerRef.current) return

    markersLayerRef.current.clearLayers()

    if (!showLabels) return

    labels.forEach((label) => {
      const color = getLabelColor(label.label)
      const opacity = label.source === 'ai' && !label.verified ? 0.7 : 1
      const radius = label.source === 'manual' ? 6 : 4 // Manual labels slightly larger

      // Use circle markers for better performance and cleaner look
      const marker = L.circleMarker([label.latitude, label.longitude], {
        radius: radius,
        fillColor: color,
        fillOpacity: opacity,
        color: label.source === 'ai' ? '#ffffff' : color,
        weight: label.source === 'ai' ? 1 : 2,
        opacity: 1,
      })

      const popupContent = `
        <div style="min-width: 150px;">
          <div style="font-weight: bold; margin-bottom: 4px;">
            ${label.label.charAt(0).toUpperCase() + label.label.slice(1)}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            ${label.source === 'ai' ? `AI Detection (${Math.round((label.confidence || 0) * 100)}%)` : 'Manual Label'}
          </div>
          <div style="font-size: 11px; font-family: monospace; margin-bottom: 8px;">
            ${label.latitude.toFixed(6)}, ${label.longitude.toFixed(6)}
          </div>
          ${label.notes ? `<div style="font-size: 12px; margin-bottom: 8px;">${label.notes}</div>` : ''}
          <div style="display: flex; gap: 8px;">
            ${
              label.source === 'ai' && !label.verified
                ? `<button onclick="window.dispatchEvent(new CustomEvent('verify-label', {detail: '${label.id}'}))"
                     style="padding: 4px 8px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                     Verify
                   </button>`
                : ''
            }
            <button onclick="window.dispatchEvent(new CustomEvent('delete-label', {detail: '${label.id}'}))"
                    style="padding: 4px 8px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
              Delete
            </button>
          </div>
        </div>
      `

      marker.bindPopup(popupContent)
      markersLayerRef.current?.addLayer(marker)
    })
  }, [labels, showLabels])

  // Listen for popup button events
  useEffect(() => {
    const handleVerify = (e: CustomEvent) => onVerifyLabel(e.detail, true)
    const handleDelete = (e: CustomEvent) => onDeleteLabel(e.detail)

    window.addEventListener('verify-label' as any, handleVerify)
    window.addEventListener('delete-label' as any, handleDelete)

    return () => {
      window.removeEventListener('verify-label' as any, handleVerify)
      window.removeEventListener('delete-label' as any, handleDelete)
    }
  }, [onVerifyLabel, onDeleteLabel])

  // Toggle orthophoto visibility
  useEffect(() => {
    if (!orthophotoLayerRef.current || !mapRef.current) return
    if (showOrthophoto) {
      orthophotoLayerRef.current.addTo(mapRef.current)
    } else {
      orthophotoLayerRef.current.remove()
    }
  }, [showOrthophoto])

  // Create ArUco marker icon
  const createArucoIcon = (markerId: number, verified: boolean, confidence?: number) => {
    const bgColor = verified ? '#10b981' : '#f59e0b'
    const borderColor = verified ? '#059669' : '#d97706'
    const opacity = confidence ? Math.max(0.6, confidence) : 1

    return L.divIcon({
      className: 'aruco-marker-icon',
      html: `
        <div style="
          width: 28px;
          height: 28px;
          background: ${bgColor};
          border: 2px solid ${borderColor};
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 11px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          opacity: ${opacity};
        ">
          ${markerId}
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    })
  }

  // Update ArUco markers
  useEffect(() => {
    if (!arucoLayerRef.current) return

    arucoLayerRef.current.clearLayers()

    if (!showArucoMarkers || arucoMarkers.length === 0) return

    arucoMarkers.forEach((marker) => {
      const leafletMarker = L.marker([marker.latitude, marker.longitude], {
        icon: createArucoIcon(marker.marker_id, marker.verified, marker.confidence),
      })

      const confidenceText = marker.confidence
        ? `${Math.round(marker.confidence * 100)}%`
        : 'N/A'

      const popupContent = `
        <div style="min-width: 160px;">
          <div style="font-weight: bold; font-size: 14px; margin-bottom: 6px;">
            ArUco #${marker.marker_id}
          </div>
          <div style="font-size: 11px; color: #666; margin-bottom: 3px;">
            <strong>Status:</strong> ${marker.verified ? '✓ Verified' : '⏳ Unverified'}
          </div>
          <div style="font-size: 11px; color: #666; margin-bottom: 3px;">
            <strong>Confidence:</strong> ${confidenceText}
          </div>
          <div style="font-size: 10px; font-family: monospace; margin-bottom: 6px; color: #888;">
            ${marker.latitude.toFixed(6)}, ${marker.longitude.toFixed(6)}
          </div>
          ${onVerifyArucoMarker ? `
            <div style="display: flex; gap: 6px;">
              ${!marker.verified ? `
                <button onclick="window.dispatchEvent(new CustomEvent('verify-aruco', {detail: {id: '${marker.id}', verified: true}}))"
                        style="padding: 3px 8px; background: #10b981; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
                  Verify
                </button>
              ` : `
                <button onclick="window.dispatchEvent(new CustomEvent('verify-aruco', {detail: {id: '${marker.id}', verified: false}}))"
                        style="padding: 3px 8px; background: #6b7280; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
                  Unverify
                </button>
              `}
            </div>
          ` : ''}
        </div>
      `

      leafletMarker.bindPopup(popupContent)
      arucoLayerRef.current?.addLayer(leafletMarker)
    })
  }, [arucoMarkers, showArucoMarkers, onVerifyArucoMarker])

  // Listen for ArUco verify events
  useEffect(() => {
    if (!onVerifyArucoMarker) return

    const handleVerifyAruco = (e: CustomEvent<{ id: string; verified: boolean }>) => {
      onVerifyArucoMarker(e.detail.id, e.detail.verified)
    }

    window.addEventListener('verify-aruco' as any, handleVerifyAruco)

    return () => {
      window.removeEventListener('verify-aruco' as any, handleVerifyAruco)
    }
  }, [onVerifyArucoMarker])

  // Render plot boundaries
  useEffect(() => {
    if (!plotsLayerRef.current) return

    plotsLayerRef.current.clearLayers()

    if (!showPlots || plots.length === 0) return

    plots.forEach((plot, index) => {
      if (!plot.boundaries) return

      try {
        // Parse GeoJSON polygon coordinates
        let coordinates: [number, number][] = []

        if (plot.boundaries.type === 'Polygon' && plot.boundaries.coordinates) {
          // GeoJSON format: coordinates are [lng, lat], Leaflet needs [lat, lng]
          coordinates = plot.boundaries.coordinates[0].map((coord: number[]) => [coord[1], coord[0]])
        } else if (Array.isArray(plot.boundaries)) {
          // Direct array format
          if (plot.boundaries[0]?.lat !== undefined) {
            coordinates = plot.boundaries.map((p: any) => [p.lat, p.lng])
          } else if (Array.isArray(plot.boundaries[0])) {
            coordinates = plot.boundaries.map((coord: number[]) => [coord[1], coord[0]])
          }
        }

        if (coordinates.length === 0) return

        const color = plotColors[index % plotColors.length]

        const polygon = L.polygon(coordinates as L.LatLngExpression[], {
          color: color,
          weight: 3,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.1,
          bubblingMouseEvents: false, // Prevent click from propagating to map
        })

        const popupContent = `
          <div style="min-width: 140px;">
            <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px;">
              ${plot.name}
            </div>
            ${plot.species_name ? `
              <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
                Species: ${plot.species_name}
              </div>
            ` : ''}
            ${plot.plant_count !== undefined ? `
              <div style="font-size: 12px; color: #22c55e; font-weight: 500;">
                ${plot.plant_count} plants detected
              </div>
            ` : ''}
          </div>
        `

        polygon.bindPopup(popupContent)
        polygon.bindTooltip(plot.name, {
          permanent: false,
          direction: 'center',
          className: 'plot-label'
        })

        plotsLayerRef.current?.addLayer(polygon)
      } catch (e) {
        console.error('Error rendering plot boundary:', e)
      }
    })
  }, [plots, showPlots])

  return (
    <div className="relative">
      {/* Map Container */}
      <div key={orthomosaic.id} ref={mapContainerRef} className="h-[600px] w-full" />

      {/* Layer Controls */}
      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-3 z-[1000]">
        <div className="text-sm font-medium mb-2">Layers</div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSatellite}
              onChange={(e) => setShowSatellite(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Satellite</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOrthophoto}
              onChange={(e) => setShowOrthophoto(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Orthomosaic</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Labels ({labels.length})</span>
          </label>
          {arucoMarkers.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showArucoMarkers}
                onChange={(e) => setShowArucoMarkers(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">ArUco ({arucoMarkers.length})</span>
            </label>
          )}
          {plots.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPlots}
                onChange={(e) => setShowPlots(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Plots ({plots.length})</span>
            </label>
          )}
        </div>
      </div>

      {/* Label Mode Indicator */}
      {labelMode && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-full shadow-lg z-[1000] text-sm font-medium">
          Click on map to add "{selectedLabelType}" label
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg p-3 z-[1000]">
        <div className="text-sm font-medium mb-2">Legend</div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span>Healthy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span>Stressed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span>Dead</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-500" />
            <span>Plant</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-purple-500" />
            <span>Weed</span>
          </div>
          <hr className="my-2" />
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-dashed border-black" />
            <span>AI (unverified)</span>
          </div>
          {arucoMarkers.length > 0 && (
            <>
              <hr className="my-2" />
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-green-500 flex items-center justify-center text-white text-[8px] font-bold">#</div>
                <span>ArUco (verified)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-amber-500 flex items-center justify-center text-white text-[8px] font-bold">#</div>
                <span>ArUco (unverified)</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Coordinates Display */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg px-3 py-2 z-[1000] text-xs font-mono">
        Bounds: {orthomosaic.bounds.south.toFixed(4)}, {orthomosaic.bounds.west.toFixed(4)} to {orthomosaic.bounds.north.toFixed(4)}, {orthomosaic.bounds.east.toFixed(4)}
      </div>
    </div>
  )
}
