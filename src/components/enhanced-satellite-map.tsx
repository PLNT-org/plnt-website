// components/enhanced-satellite-map.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { 
  MapPin, Search, Plane, Trash2, Navigation, Layers, 
  Maximize2, Pencil, Info, ChevronDown, ChevronUp
} from 'lucide-react'

// Using Plane icon as Drone
const Drone = Plane

// Custom drawing tool icon
const DrawingToolIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M15.5 3H20v4.5L8.5 19l-5.5 1.5L4.5 15 16 3.5M15.5 3l2.5 2.5M12 9l4 4"/>
  </svg>
)

// Fix Leaflet default marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface MapArea {
  id: number
  points: { x: number; y: number; lat: number; lng: number }[]
  area: string
  coordinates: { lat: number; lng: number; action?: 'photo' }[]
  photoIntervalMeters?: number
  estimatedPhotos?: number
}

interface EnhancedSatelliteMapProps {
  onAreaDrawn?: (area: MapArea) => void
  defaultCenter?: [number, number]
  defaultZoom?: number
  existingBoundary?: { lat: number; lng: number }[]
  altitude?: number
}

export default function EnhancedSatelliteMap({ 
  onAreaDrawn, 
  defaultCenter = [34.0522, -118.2437],
  defaultZoom = 18,
  existingBoundary,
  altitude = 30
}: EnhancedSatelliteMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null)
  const flightPathLayerRef = useRef<L.LayerGroup | null>(null)
  const drawingPolygonRef = useRef<L.Polygon | null>(null)
  const rubberBandLineRef = useRef<L.Polyline | null>(null)
  const drawingPointsRef = useRef<L.LatLng[]>([])
  const pointMarkersRef = useRef<L.CircleMarker[]>([])
  const [searchAddress, setSearchAddress] = useState('')
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentArea, setCurrentArea] = useState<MapArea | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [mousePosition, setMousePosition] = useState<L.LatLng | null>(null)

  useEffect(() => {
    if (!mapRef.current) {
      // Initialize map
      const map = L.map('enhanced-satellite-map', {
        center: defaultCenter,
        zoom: defaultZoom,
        zoomControl: false,
        attributionControl: false,
      })

      // Add custom zoom control
      L.control.zoom({
        position: 'topright'
      }).addTo(map)

      // Add hybrid tile layer (satellite with labels)
      L.tileLayer(
        'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        {
          attribution: '© Google',
          maxZoom: 20,
        }
      ).addTo(map)

      // Initialize feature groups
      const drawnItems = new L.FeatureGroup()
      map.addLayer(drawnItems)
      drawnItemsRef.current = drawnItems

      const flightPathLayer = new L.LayerGroup()
      map.addLayer(flightPathLayer)
      flightPathLayerRef.current = flightPathLayer

      // Add scale control
      L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: true,
      }).addTo(map)

      mapRef.current = map

      // Load existing boundary if provided
      if (existingBoundary && existingBoundary.length > 0) {
        const polygon = L.polygon(
          existingBoundary.map(coord => [coord.lat, coord.lng]),
          {
            color: '#10b981',
            weight: 3,
            opacity: 1,
            fillColor: '#10b981',
            fillOpacity: 0.2
          }
        )
        drawnItems.addLayer(polygon)
        map.fitBounds(polygon.getBounds())
        
        // Generate flight path for existing boundary, filtered to polygon
        const { flightPath } = generateFlightPath(polygon.getBounds(), altitude, existingBoundary)
        drawHighQualityFlightPath(map, flightPathLayer, flightPath, polygon.getLatLngs()[0] as L.LatLng[])
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  const startDrawing = () => {
    if (!mapRef.current || !drawnItemsRef.current) return

    setIsDrawing(true)
    
    // Clear existing drawings
    drawnItemsRef.current.clearLayers()
    if (flightPathLayerRef.current) {
      flightPathLayerRef.current.clearLayers()
    }
    
    // Reset drawing state
    drawingPointsRef.current = []
    drawingPolygonRef.current = null
    rubberBandLineRef.current = null
    pointMarkersRef.current = []

    // Create handlers for drawing
    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const point = e.latlng
      drawingPointsRef.current.push(point)

      // Add a point marker with number
      const pointNumber = drawingPointsRef.current.length
      const pointMarker = L.circleMarker(point, {
        radius: 8,
        fillColor: '#10b981',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1
      }).addTo(drawnItemsRef.current!)
      
      // Add number label
      const numberIcon = L.divIcon({
        html: `<div style="
          background: #10b981;
          color: white;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">${pointNumber}</div>`,
        iconSize: [20, 20],
        className: 'point-number'
      })
      L.marker(point, { icon: numberIcon }).addTo(drawnItemsRef.current!)
      
      pointMarkersRef.current.push(pointMarker)

      // Update or create polygon
      if (drawingPolygonRef.current) {
        drawingPolygonRef.current.setLatLngs(drawingPointsRef.current)
      } else if (drawingPointsRef.current.length > 1) {
        drawingPolygonRef.current = L.polygon(drawingPointsRef.current, {
          color: '#10b981',
          weight: 3,
          opacity: 1,
          fillColor: '#10b981',
          fillOpacity: 0.15,
          dashArray: ''
        }).addTo(drawnItemsRef.current!)
      }

      // Create rubber band line from last point
      if (rubberBandLineRef.current) {
        drawnItemsRef.current!.removeLayer(rubberBandLineRef.current)
      }
    }

    // Mouse move handler for rubber band effect
    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (drawingPointsRef.current.length > 0) {
        const lastPoint = drawingPointsRef.current[drawingPointsRef.current.length - 1]
        
        // Remove previous rubber band line
        if (rubberBandLineRef.current) {
          drawnItemsRef.current!.removeLayer(rubberBandLineRef.current)
        }
        
        // Create new rubber band line
        rubberBandLineRef.current = L.polyline([lastPoint, e.latlng], {
          color: '#10b981',
          weight: 2,
          opacity: 0.7,
          dashArray: '5, 10',
          className: 'rubber-band-line'
        }).addTo(drawnItemsRef.current!)

        // Also show preview of closing line if we have 2+ points
        if (drawingPointsRef.current.length >= 2) {
          const firstPoint = drawingPointsRef.current[0]
          L.polyline([e.latlng, firstPoint], {
            color: '#10b981',
            weight: 1,
            opacity: 0.4,
            dashArray: '3, 6',
            className: 'closing-preview-line'
          }).addTo(drawnItemsRef.current!)
        }
      }
    }

    // Double-click handler to finish
    const handleMapDblClick = () => {
      finishDrawing()
    }

    // Right-click to finish (alternative method)
    const handleContextMenu = (e: L.LeafletMouseEvent) => {
      L.DomEvent.preventDefault(e.originalEvent)
      if (drawingPointsRef.current.length >= 3) {
        finishDrawing()
      }
    }

    // Attach event listeners
    mapRef.current.on('click', handleMapClick)
    mapRef.current.on('mousemove', handleMouseMove)
    mapRef.current.on('dblclick', handleMapDblClick)
    mapRef.current.on('contextmenu', handleContextMenu)

    // Change cursor style
    const container = document.getElementById('enhanced-satellite-map')
    if (container) {
      container.style.cursor = 'crosshair'
    }
  }

  const finishDrawing = () => {
    if (!mapRef.current || !drawnItemsRef.current) return

    // Need at least 3 points for a valid polygon
    if (drawingPointsRef.current.length < 3) {
      alert('Please add at least 3 points to create a valid survey area')
      return
    }

    // Remove rubber band line and temporary elements
    if (rubberBandLineRef.current) {
      drawnItemsRef.current.removeLayer(rubberBandLineRef.current)
    }
    
    // Remove closing preview lines
    drawnItemsRef.current.eachLayer((layer) => {
      if (layer instanceof L.Polyline && 
          (layer.options.className === 'rubber-band-line' || 
           layer.options.className === 'closing-preview-line')) {
        drawnItemsRef.current!.removeLayer(layer)
      }
    })

    // Update polygon style to solid
    if (drawingPolygonRef.current) {
      drawingPolygonRef.current.setStyle({
        fillOpacity: 0.2,
        weight: 4
      })
    }

    // Calculate area and generate flight path with camera triggers
    const area = calculateArea(drawingPointsRef.current)
    const bounds = L.latLngBounds(drawingPointsRef.current)

    // Convert polygon points to the format needed for point-in-polygon check
    const polygonBoundary = drawingPointsRef.current.map(ll => ({ lat: ll.lat, lng: ll.lng }))

    // Generate optimized flight path with camera trigger waypoints, filtered to polygon boundary
    const { flightPath, photoIntervalMeters, estimatedPhotos } = generateFlightPath(bounds, altitude, polygonBoundary)

    const mapArea: MapArea = {
      id: Date.now(),
      points: drawingPointsRef.current.map(ll => ({
        x: ll.lng,
        y: ll.lat,
        lat: ll.lat,
        lng: ll.lng
      })),
      area: `${area.toFixed(2)} acres`,
      // Use the full flight path with camera triggers as coordinates
      coordinates: flightPath,
      photoIntervalMeters,
      estimatedPhotos
    }

    console.log(`Generated flight path: ${estimatedPhotos} photo waypoints, ${photoIntervalMeters.toFixed(1)}m interval`)

    setCurrentArea(mapArea)
    onAreaDrawn?.(mapArea)

    // Draw flight path on map
    if (flightPathLayerRef.current) {
      drawHighQualityFlightPath(mapRef.current, flightPathLayerRef.current, flightPath, drawingPointsRef.current)
    }

    // Clean up event listeners
    mapRef.current.off('click')
    mapRef.current.off('mousemove')
    mapRef.current.off('dblclick')
    mapRef.current.off('contextmenu')
    setIsDrawing(false)

    // Reset cursor
    const container = document.getElementById('enhanced-satellite-map')
    if (container) {
      container.style.cursor = ''
    }
  }

  const clearAll = () => {
    if (drawnItemsRef.current) {
      drawnItemsRef.current.clearLayers()
    }
    if (flightPathLayerRef.current) {
      flightPathLayerRef.current.clearLayers()
    }
    
    // Reset all drawing state
    drawingPointsRef.current = []
    drawingPolygonRef.current = null
    rubberBandLineRef.current = null
    pointMarkersRef.current = []
    setCurrentArea(null)
    setIsDrawing(false)

    // Remove event listeners if drawing
    if (mapRef.current) {
      mapRef.current.off('click')
      mapRef.current.off('mousemove')
      mapRef.current.off('dblclick')
      mapRef.current.off('contextmenu')
    }

    // Reset cursor
    const container = document.getElementById('enhanced-satellite-map')
    if (container) {
      container.style.cursor = ''
    }
  }

  const calculateArea = (latLngs: L.LatLng[]) => {
    let area = 0
    const numPoints = latLngs.length

    for (let i = 0; i < numPoints; i++) {
      const j = (i + 1) % numPoints
      const lat1 = latLngs[i].lat * Math.PI / 180
      const lat2 = latLngs[j].lat * Math.PI / 180
      const lng1 = latLngs[i].lng * Math.PI / 180
      const lng2 = latLngs[j].lng * Math.PI / 180

      area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2))
    }

    area = Math.abs(area * 6378137 * 6378137 / 2)
    return area * 0.000247105 // square meters to acres
  }

  // Check if a point is inside a polygon using ray casting algorithm
  const isPointInPolygon = (point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean => {
    let inside = false
    const x = point.lng
    const y = point.lat

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng
      const yi = polygon[i].lat
      const xj = polygon[j].lng
      const yj = polygon[j].lat

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }

    return inside
  }

  // Calculate distance between two lat/lng points in meters
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000 // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Generate camera trigger waypoints along a flight line
  const generateCameraTriggerWaypoints = (
    startLat: number, startLng: number,
    endLat: number, endLng: number,
    photoIntervalMeters: number
  ): { lat: number; lng: number; action: 'photo' }[] => {
    const waypoints: { lat: number; lng: number; action: 'photo' }[] = []
    const totalDistance = calculateDistance(startLat, startLng, endLat, endLng)

    if (totalDistance === 0) return waypoints

    const numPhotos = Math.max(1, Math.floor(totalDistance / photoIntervalMeters))

    for (let i = 0; i <= numPhotos; i++) {
      const fraction = i / numPhotos
      const lat = startLat + (endLat - startLat) * fraction
      const lng = startLng + (endLng - startLng) * fraction

      waypoints.push({ lat, lng, action: 'photo' })
    }

    return waypoints
  }

  // Find the optimal flight direction based on the polygon's longest edge
  const findOptimalFlightAngle = (boundary: { lat: number; lng: number }[]): number => {
    if (boundary.length < 2) return 0

    let longestEdgeLength = 0
    let longestEdgeAngle = 0

    for (let i = 0; i < boundary.length; i++) {
      const p1 = boundary[i]
      const p2 = boundary[(i + 1) % boundary.length]

      // Calculate edge length in meters
      const edgeLength = calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng)

      if (edgeLength > longestEdgeLength) {
        longestEdgeLength = edgeLength
        // Calculate angle of this edge (in radians)
        const avgLat = (p1.lat + p2.lat) / 2
        const lngScale = Math.cos(avgLat * Math.PI / 180)
        const dx = (p2.lng - p1.lng) * lngScale
        const dy = p2.lat - p1.lat
        longestEdgeAngle = Math.atan2(dy, dx)
      }
    }

    return longestEdgeAngle
  }

  // Rotate a point around a center point
  const rotatePoint = (
    point: { lat: number; lng: number },
    center: { lat: number; lng: number },
    angle: number
  ): { lat: number; lng: number } => {
    const lngScale = Math.cos(center.lat * Math.PI / 180)
    const dx = (point.lng - center.lng) * lngScale
    const dy = point.lat - center.lat
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotatedX = dx * cos - dy * sin
    const rotatedY = dx * sin + dy * cos
    return {
      lat: rotatedY + center.lat,
      lng: rotatedX / lngScale + center.lng
    }
  }

  const generateFlightPath = (
    bounds: L.LatLngBounds,
    altitudeM: number,
    polygon?: { lat: number; lng: number }[]
  ): {
    flightPath: { lat: number; lng: number; action?: 'photo' }[],
    photoIntervalMeters: number,
    estimatedPhotos: number
  } => {
    const horizontalFOV = 84 // degrees (typical for DJI/Autel drones)
    const verticalFOV = 55 // degrees (approximate for 4:3 sensor)
    const overlapPercent = 80

    // Calculate ground coverage (side overlap - for line spacing)
    const coverageWidth = 2 * altitudeM * Math.tan((horizontalFOV / 2) * Math.PI / 180)
    const lineSpacing = coverageWidth * (1 - overlapPercent / 100)
    const lineSpacingDeg = lineSpacing / 111320 // meters to degrees

    // Calculate forward ground coverage (for photo interval)
    const forwardCoverage = 2 * altitudeM * Math.tan((verticalFOV / 2) * Math.PI / 180)
    const photoIntervalMeters = forwardCoverage * (1 - overlapPercent / 100)

    // If we have a polygon, use optimized rotation-based approach
    if (polygon && polygon.length >= 3) {
      // Calculate center of polygon
      const centerLat = polygon.reduce((sum, p) => sum + p.lat, 0) / polygon.length
      const centerLng = polygon.reduce((sum, p) => sum + p.lng, 0) / polygon.length
      const center = { lat: centerLat, lng: centerLng }

      // Find optimal flight angle (parallel to longest edge)
      const flightAngle = findOptimalFlightAngle(polygon)

      // Rotate polygon to align with axes
      const rotatedPolygon = polygon.map(p => rotatePoint(p, center, -flightAngle))

      // Get bounds of rotated polygon
      const rotatedLats = rotatedPolygon.map(p => p.lat)
      const rotatedLngs = rotatedPolygon.map(p => p.lng)
      const north = Math.max(...rotatedLats)
      const south = Math.min(...rotatedLats)
      const east = Math.max(...rotatedLngs)
      const west = Math.min(...rotatedLngs)

      const allWaypoints: { lat: number; lng: number; action?: 'photo' }[] = []
      let currentLat = south
      let lineNumber = 0

      // Generate lawnmower pattern in rotated coordinate system
      while (currentLat <= north) {
        let lineStart: { lat: number; lng: number }
        let lineEnd: { lat: number; lng: number }

        if (lineNumber % 2 === 0) {
          lineStart = { lat: currentLat, lng: west }
          lineEnd = { lat: currentLat, lng: east }
        } else {
          lineStart = { lat: currentLat, lng: east }
          lineEnd = { lat: currentLat, lng: west }
        }

        const lineWaypoints = generateCameraTriggerWaypoints(
          lineStart.lat, lineStart.lng,
          lineEnd.lat, lineEnd.lng,
          photoIntervalMeters
        )

        allWaypoints.push(...lineWaypoints)
        currentLat += lineSpacingDeg
        lineNumber++
      }

      // Rotate waypoints back to original coordinate system
      const rotatedWaypoints = allWaypoints.map(wp => {
        const rotatedBack = rotatePoint(wp, center, flightAngle)
        return { ...wp, lat: rotatedBack.lat, lng: rotatedBack.lng }
      })

      // Filter to only include points inside the original polygon
      const flightPath = rotatedWaypoints.filter(wp => isPointInPolygon(wp, polygon))

      return {
        flightPath,
        photoIntervalMeters,
        estimatedPhotos: flightPath.length
      }
    }

    // Fallback: use bounds-based approach (no polygon)
    const north = bounds.getNorth()
    const south = bounds.getSouth()
    const east = bounds.getEast()
    const west = bounds.getWest()

    const allWaypoints: { lat: number; lng: number; action?: 'photo' }[] = []
    let currentLat = south
    let lineNumber = 0

    while (currentLat <= north) {
      let lineStart: { lat: number; lng: number }
      let lineEnd: { lat: number; lng: number }

      if (lineNumber % 2 === 0) {
        lineStart = { lat: currentLat, lng: west }
        lineEnd = { lat: currentLat, lng: east }
      } else {
        lineStart = { lat: currentLat, lng: east }
        lineEnd = { lat: currentLat, lng: west }
      }

      const lineWaypoints = generateCameraTriggerWaypoints(
        lineStart.lat, lineStart.lng,
        lineEnd.lat, lineEnd.lng,
        photoIntervalMeters
      )

      allWaypoints.push(...lineWaypoints)
      currentLat += lineSpacingDeg
      lineNumber++
    }

    return {
      flightPath: allWaypoints,
      photoIntervalMeters,
      estimatedPhotos: allWaypoints.length
    }
  }

  const drawHighQualityFlightPath = (
    map: L.Map, 
    layer: L.LayerGroup, 
    path: { lat: number; lng: number }[], 
    boundary: L.LatLng[]
  ) => {
    layer.clearLayers()

    // Draw flight path
    const smoothPath = L.polyline(
      path.map(p => [p.lat, p.lng]),
      {
        color: '#3b82f6',
        weight: 2,
        opacity: 0.9,
        dashArray: '10, 5',
        className: 'flight-path'
      }
    ).addTo(layer)

    // Add waypoint markers
    path.forEach((point, index) => {
      if (index % 4 === 0 && index > 0 && index < path.length - 1) {
        const waypointIcon = L.divIcon({
          html: `<div style="
            background: #3b82f6;
            color: white;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: bold;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          ">W${Math.floor(index/4) + 1}</div>`,
          iconSize: [18, 18],
          className: 'waypoint-marker',
        })
        L.marker([point.lat, point.lng], { icon: waypointIcon }).addTo(layer)
      }
    })

    // Add start and end markers
    if (path.length > 0) {
      const startIcon = L.divIcon({
        html: `
          <div style="
            background: #10b981;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 6px rgba(0,0,0,0.3);
            border: 3px solid white;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        `,
        iconSize: [30, 30],
      })
      L.marker([path[0].lat, path[0].lng], { icon: startIcon })
        .bindPopup('Start Point')
        .addTo(layer)

      const endIcon = L.divIcon({
        html: `
          <div style="
            background: #ef4444;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 6px rgba(0,0,0,0.3);
            border: 3px solid white;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12" y2="16"/>
            </svg>
          </div>
        `,
        iconSize: [30, 30],
      })
      L.marker([path[path.length - 1].lat, path[path.length - 1].lng], { icon: endIcon })
        .bindPopup('End Point')
        .addTo(layer)
    }
  }

  const searchLocation = async () => {
    if (!searchAddress) return

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&limit=1`
      )
      const data = await response.json()

      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0]
        mapRef.current?.setView([parseFloat(lat), parseFloat(lon)], 18)
        
        const searchMarker = L.marker([parseFloat(lat), parseFloat(lon)])
          .addTo(mapRef.current!)
          .bindPopup(display_name)
          .openPopup()
        
        setTimeout(() => {
          mapRef.current?.removeLayer(searchMarker)
        }, 5000)
      } else {
        alert('Location not found. Try being more specific.')
      }
    } catch (error) {
      console.error('Error searching location:', error)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      searchLocation()
    }
  }

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords
          mapRef.current?.setView([latitude, longitude], 18)
          
          const locationMarker = L.marker([latitude, longitude])
            .addTo(mapRef.current!)
            .bindPopup('Your current location')
            .openPopup()
        },
        (error) => {
          alert('Unable to get your location.')
        }
      )
    }
  }

  return (
    <div className="relative">
      {/* Search Bar */}
      <Card className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] p-3 bg-white/95 backdrop-blur-sm shadow-lg">
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="Search any location..."
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-10 pr-4 w-80"
            />
          </div>
          <Button onClick={searchLocation} size="sm" className="bg-green-700 hover:bg-green-800 text-white">
            Search
          </Button>
          <Button onClick={getCurrentLocation} size="sm" variant="outline" title="Use current location">
            <Navigation className="w-4 h-4" />
          </Button>
        </div>
      </Card>

      {/* Controls */}
      <div className="absolute top-20 left-4 z-[999] space-y-2">
        <Card className="p-2 bg-white/95 backdrop-blur-sm shadow-lg">
          <div className="space-y-2">
            <Button
              size="sm"
              variant={isDrawing ? "default" : "outline"}
              onClick={isDrawing ? finishDrawing : startDrawing}
              className={`w-full justify-start ${isDrawing ? "bg-green-700 hover:bg-green-800" : ""}`}
            >
              <DrawingToolIcon />
              <span className="ml-2">{isDrawing ? 'Finish Drawing' : 'Draw Area'}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={clearAll}
              className="w-full justify-start hover:bg-red-50 hover:text-red-600 hover:border-red-300"
            >
              <Trash2 className="w-4 h-4" />
              <span className="ml-2">Clear All</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowHelp(!showHelp)}
              className="w-full justify-start"
            >
              <Info className="w-4 h-4" />
              <span className="ml-2">Help</span>
              {showHelp ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </Button>
          </div>
        </Card>

        {/* Help Panel */}
        {showHelp && (
          <Card className="p-3 bg-white/95 backdrop-blur-sm shadow-lg max-w-xs">
            <h4 className="font-semibold text-green-800 mb-2 text-sm">How to Draw Survey Area</h4>
            <ol className="text-xs space-y-1 text-gray-700">
              <li>1. Click "Draw Area" to start</li>
              <li>2. Click points on map to define boundary</li>
              <li>3. A dashed line follows your cursor</li>
              <li>4. Double-click or right-click to finish</li>
              <li>5. Flight path generates automatically</li>
            </ol>
            <div className="mt-2 pt-2 border-t text-xs text-gray-600">
              <p><strong>Tip:</strong> Like Google Earth, a rubber-band line shows where your next point will connect!</p>
            </div>
            {currentArea && (
              <div className="mt-3 pt-3 border-t bg-green-50 -mx-3 px-3 pb-2">
                <p className="text-xs font-semibold text-green-800">Survey Ready!</p>
                <div className="text-xs text-green-700 mt-1">
                  <p>Area: {currentArea.area}</p>
                  <p>Points: {currentArea.coordinates.length}</p>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Drawing Instructions Overlay */}
      {isDrawing && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-green-700 text-white px-4 py-2 rounded-lg shadow-lg z-[1001] mt-16">
          <p className="text-sm font-medium">
            Click to add points • Dashed line shows next connection • Double-click or right-click to finish
          </p>
        </div>
      )}

      {/* Map Container */}
      <div id="enhanced-satellite-map" className="h-[700px] w-full rounded-lg shadow-2xl" />

      <style jsx global>{`
        .rubber-band-line {
          animation: dash 0.5s linear infinite;
        }
        
        @keyframes dash {
          to {
            stroke-dashoffset: -15;
          }
        }
        
        .point-number {
          z-index: 1000 !important;
        }
        
        #enhanced-satellite-map {
          cursor: default;
        }
        
        #enhanced-satellite-map.drawing {
          cursor: crosshair !important;
        }
      `}</style>
    </div>
  )
}