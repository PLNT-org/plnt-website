// components/flight-planner.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EnhancedSatelliteMap } from '@/components/dynamic-map-wrapper'
import { FlightPlannerSidebar } from '@/components/flight-planner-sidebar'
import Link from 'next/link'
import Image from 'next/image'
import { Plus, Loader2, MapPin } from 'lucide-react'

interface Waypoint {
  lat: number
  lng: number
  action: 'fly' | 'photo'
  gimbalPitch?: number
  heading?: number
}

type MissionType = 'orthomosaic' | '3d-model' | '3d-fast' | 'custom'

const MISSION_PRESETS = {
  orthomosaic: {
    name: 'Orthomosaic (2D)',
    description: 'Single-grid pattern for flat imagery and plant counting',
    frontalOverlap: 80,
    sideOverlap: 75,
    gimbalAngles: [-90],
    pattern: 'single-grid' as const,
  },
  '3d-model': {
    name: '3D Model (Height Mapping)',
    description: 'Cross-hatch pattern with oblique angles for DSM/DTM',
    frontalOverlap: 85,
    sideOverlap: 75,
    gimbalAngles: [-90, -45],
    pattern: 'cross-hatch' as const,
  },
  '3d-fast': {
    name: '3D Fast (Height Mapping)',
    description: 'Faster 3D: single-grid nadir + cross-hatch oblique',
    frontalOverlap: 85,
    sideOverlap: 75,
    gimbalAngles: [-90, -45],
    pattern: 'fast-3d' as const,
  },
  custom: {
    name: 'Custom',
    description: 'Configure all parameters manually',
    frontalOverlap: 80,
    sideOverlap: 75,
    gimbalAngles: [-90],
    pattern: 'single-grid' as const,
  },
}

interface MapArea {
  id: number
  points: { x: number; y: number; lat: number; lng: number }[]
  area: string
  coordinates: Waypoint[]
  photoIntervalMeters?: number
  estimatedPhotos?: number
  missionType?: MissionType
  gimbalAngles?: number[]
}

interface Plot {
  id: string
  name: string
  area_acres: number
  boundaries: any
}

export default function FlightPlannerInterface() {
  const { user, isDemo } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const plotId = searchParams.get('plot')
  const editId = searchParams.get('edit')

  // Form state
  const [name, setName] = useState('')
  const [selectedPlot, setSelectedPlot] = useState(plotId || 'custom')
  const [plots, setPlots] = useState<Plot[]>([])
  const [droneModel, setDroneModel] = useState('DJI Mavic 3')
  const [altitude, setAltitude] = useState('100')
  const [speed, setSpeed] = useState('16')
  const [overlap, setOverlap] = useState('80')
  const [plantType, setPlantType] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [mapArea, setMapArea] = useState<MapArea | null>(null)
  const [missionType, setMissionType] = useState<MissionType>('orthomosaic')

  // UI state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [currentPlotBoundary, setCurrentPlotBoundary] = useState<{ lat: number; lng: number }[] | undefined>(undefined)

  // Handle plot selection changes
  useEffect(() => {
    if (selectedPlot && selectedPlot !== 'custom') {
      const selected = plots.find(p => p.id === selectedPlot)

      if (selected?.boundaries) {
        let boundary: { lat: number; lng: number }[] = []

        if (selected.boundaries.type === 'Polygon' && selected.boundaries.coordinates?.[0]) {
          boundary = selected.boundaries.coordinates[0].map((coord: number[]) => ({
            lat: coord[1],
            lng: coord[0]
          }))
        } else if (selected.boundaries.coordinates && Array.isArray(selected.boundaries.coordinates[0])) {
          boundary = selected.boundaries.coordinates[0].map((coord: number[]) => ({
            lat: coord[1],
            lng: coord[0]
          }))
        } else if (Array.isArray(selected.boundaries)) {
          boundary = selected.boundaries.map((coord: any) => ({
            lat: coord.lat || coord[1],
            lng: coord.lng || coord[0]
          }))
        }

        if (boundary.length > 0) {
          setCurrentPlotBoundary(boundary)
          const area = calculatePlotArea(boundary)
          const { coordinates, photoIntervalMeters, estimatedPhotos } = generateFlightPath(boundary)

          const newMapArea = {
            id: Date.now(),
            points: boundary.map((coord: { lat: number; lng: number }) => ({
              x: coord.lng,
              y: coord.lat,
              lat: coord.lat,
              lng: coord.lng
            })),
            area: `${area.toFixed(2)} acres`,
            coordinates,
            photoIntervalMeters,
            estimatedPhotos,
            missionType,
            gimbalAngles: MISSION_PRESETS[missionType].gimbalAngles
          }

          setMapArea(newMapArea)
        }
      }
    } else {
      setCurrentPlotBoundary(undefined)
    }
  }, [selectedPlot, plots, altitude, overlap, missionType])

  const calculatePlotArea = (coords: { lat: number; lng: number }[]): number => {
    let area = 0
    const numPoints = coords.length

    for (let i = 0; i < numPoints; i++) {
      const j = (i + 1) % numPoints
      const lat1 = coords[i].lat * Math.PI / 180
      const lat2 = coords[j].lat * Math.PI / 180
      const lng1 = coords[i].lng * Math.PI / 180
      const lng2 = coords[j].lng * Math.PI / 180

      area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2))
    }

    area = Math.abs(area * 6378137 * 6378137 / 2)
    return area / 4046.86
  }

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

  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const generateCameraTriggerWaypoints = (
    startLat: number, startLng: number,
    endLat: number, endLng: number,
    photoIntervalMeters: number
  ): Waypoint[] => {
    const waypoints: Waypoint[] = []
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
        // Account for longitude scaling at this latitude
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
    // Account for longitude scaling at this latitude
    const lngScale = Math.cos(center.lat * Math.PI / 180)

    // Translate to origin and scale
    const dx = (point.lng - center.lng) * lngScale
    const dy = point.lat - center.lat

    // Rotate
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotatedX = dx * cos - dy * sin
    const rotatedY = dx * sin + dy * cos

    // Translate back and unscale
    return {
      lat: rotatedY + center.lat,
      lng: rotatedX / lngScale + center.lng
    }
  }

  const generateOptimizedFlightPath = (boundary: { lat: number; lng: number }[]): { coordinates: Waypoint[], photoIntervalMeters: number, estimatedPhotos: number } => {
    // Calculate center of polygon
    const centerLat = boundary.reduce((sum, p) => sum + p.lat, 0) / boundary.length
    const centerLng = boundary.reduce((sum, p) => sum + p.lng, 0) / boundary.length
    const center = { lat: centerLat, lng: centerLng }

    // Find optimal flight angle (parallel to longest edge)
    const flightAngle = findOptimalFlightAngle(boundary)

    // Rotate boundary to align with axes (for easier grid generation)
    const rotatedBoundary = boundary.map(p => rotatePoint(p, center, -flightAngle))

    // Get bounds of rotated polygon
    const rotatedLats = rotatedBoundary.map(p => p.lat)
    const rotatedLngs = rotatedBoundary.map(p => p.lng)
    const north = Math.max(...rotatedLats)
    const south = Math.min(...rotatedLats)
    const east = Math.max(...rotatedLngs)
    const west = Math.min(...rotatedLngs)

    const altitudeFt = parseInt(altitude) || 100
    const altitudeM = altitudeFt * 0.3048
    const horizontalFOV = 84
    const verticalFOV = 55
    const overlapPercent = parseInt(overlap) || 80

    const coverageWidth = 2 * altitudeM * Math.tan((horizontalFOV / 2) * Math.PI / 180)
    const lineSpacing = coverageWidth * (1 - overlapPercent / 100)
    const forwardCoverage = 2 * altitudeM * Math.tan((verticalFOV / 2) * Math.PI / 180)
    const photoIntervalMeters = forwardCoverage * (1 - overlapPercent / 100)
    const lineSpacingDeg = lineSpacing / 111320

    const allWaypoints: Waypoint[] = []
    let currentLat = south
    let lineNumber = 0

    // Generate grid in rotated coordinate system
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
    const filteredWaypoints = boundary.length >= 3
      ? rotatedWaypoints.filter(wp => isPointInPolygon(wp, boundary))
      : rotatedWaypoints

    return {
      coordinates: filteredWaypoints,
      photoIntervalMeters,
      estimatedPhotos: filteredWaypoints.length
    }
  }

  const generateCrossHatchFlightPath = (
    boundary: { lat: number; lng: number }[],
    gimbalAngles: number[] = [-90, -45]
  ): { coordinates: Waypoint[], photoIntervalMeters: number, estimatedPhotos: number } => {
    // Calculate center of polygon
    const centerLat = boundary.reduce((sum, p) => sum + p.lat, 0) / boundary.length
    const centerLng = boundary.reduce((sum, p) => sum + p.lng, 0) / boundary.length
    const center = { lat: centerLat, lng: centerLng }

    // Find optimal flight angle (parallel to longest edge)
    const flightAngle = findOptimalFlightAngle(boundary)

    // Rotate boundary to align with axes
    const rotatedBoundary = boundary.map(p => rotatePoint(p, center, -flightAngle))

    // Get bounds of rotated polygon
    const rotatedLats = rotatedBoundary.map(p => p.lat)
    const rotatedLngs = rotatedBoundary.map(p => p.lng)
    const north = Math.max(...rotatedLats)
    const south = Math.min(...rotatedLats)
    const east = Math.max(...rotatedLngs)
    const west = Math.min(...rotatedLngs)

    const altitudeFt = parseInt(altitude) || 100
    const altitudeM = altitudeFt * 0.3048
    const horizontalFOV = 84
    const verticalFOV = 55
    const frontalOverlap = MISSION_PRESETS['3d-model'].frontalOverlap
    const sideOverlap = MISSION_PRESETS['3d-model'].sideOverlap

    const coverageWidth = 2 * altitudeM * Math.tan((horizontalFOV / 2) * Math.PI / 180)
    const lineSpacing = coverageWidth * (1 - sideOverlap / 100)
    const forwardCoverage = 2 * altitudeM * Math.tan((verticalFOV / 2) * Math.PI / 180)
    const photoIntervalMeters = forwardCoverage * (1 - frontalOverlap / 100)
    const lineSpacingDeg = lineSpacing / 111320
    const lngSpacingDeg = lineSpacing / (111320 * Math.cos(centerLat * Math.PI / 180))

    const allWaypoints: Waypoint[] = []

    // Calculate heading offset based on flight angle (convert radians to degrees)
    const headingOffset = flightAngle * 180 / Math.PI

    const generateLineWaypoints = (
      startLat: number, startLng: number,
      endLat: number, endLng: number,
      gimbalPitch: number,
      baseDirection: 'primary' | 'primary-reverse' | 'perpendicular' | 'perpendicular-reverse'
    ): Waypoint[] => {
      let heading = 0
      if (gimbalPitch > -90) {
        // For oblique shots, heading follows flight direction (rotated)
        switch (baseDirection) {
          case 'primary': heading = 90 + headingOffset; break
          case 'primary-reverse': heading = 270 + headingOffset; break
          case 'perpendicular': heading = 0 + headingOffset; break
          case 'perpendicular-reverse': heading = 180 + headingOffset; break
        }
        // Normalize heading to 0-360
        heading = ((heading % 360) + 360) % 360
      }

      return generateCameraTriggerWaypoints(
        startLat, startLng, endLat, endLng, photoIntervalMeters
      ).map(wp => ({ ...wp, gimbalPitch, heading }))
    }

    gimbalAngles.forEach((gimbalPitch) => {
      // Primary direction (along longest edge)
      let currentLat = south
      let lineNumber = 0

      while (currentLat <= north) {
        const goingEast = lineNumber % 2 === 0
        const lineStart = goingEast
          ? { lat: currentLat, lng: west }
          : { lat: currentLat, lng: east }
        const lineEnd = goingEast
          ? { lat: currentLat, lng: east }
          : { lat: currentLat, lng: west }

        const lineWaypoints = generateLineWaypoints(
          lineStart.lat, lineStart.lng,
          lineEnd.lat, lineEnd.lng,
          gimbalPitch,
          goingEast ? 'primary' : 'primary-reverse'
        )

        allWaypoints.push(...lineWaypoints)
        currentLat += lineSpacingDeg
        lineNumber++
      }

      // Perpendicular direction
      let currentLng = west
      lineNumber = 0

      while (currentLng <= east) {
        const goingNorth = lineNumber % 2 === 0
        const lineStart = goingNorth
          ? { lat: south, lng: currentLng }
          : { lat: north, lng: currentLng }
        const lineEnd = goingNorth
          ? { lat: north, lng: currentLng }
          : { lat: south, lng: currentLng }

        const lineWaypoints = generateLineWaypoints(
          lineStart.lat, lineStart.lng,
          lineEnd.lat, lineEnd.lng,
          gimbalPitch,
          goingNorth ? 'perpendicular' : 'perpendicular-reverse'
        )

        allWaypoints.push(...lineWaypoints)
        currentLng += lngSpacingDeg
        lineNumber++
      }
    })

    // Rotate waypoints back to original coordinate system
    const rotatedWaypoints = allWaypoints.map(wp => {
      const rotatedBack = rotatePoint(wp, center, flightAngle)
      return { ...wp, lat: rotatedBack.lat, lng: rotatedBack.lng }
    })

    // Filter to only include points inside the original polygon
    const filteredWaypoints = boundary.length >= 3
      ? rotatedWaypoints.filter(wp => isPointInPolygon(wp, boundary))
      : rotatedWaypoints

    return {
      coordinates: filteredWaypoints,
      photoIntervalMeters,
      estimatedPhotos: filteredWaypoints.length
    }
  }

  const generateFast3DFlightPath = (
    boundary: { lat: number; lng: number }[]
  ): { coordinates: Waypoint[], photoIntervalMeters: number, estimatedPhotos: number } => {
    // Calculate center of polygon
    const centerLat = boundary.reduce((sum, p) => sum + p.lat, 0) / boundary.length
    const centerLng = boundary.reduce((sum, p) => sum + p.lng, 0) / boundary.length
    const center = { lat: centerLat, lng: centerLng }

    // Find optimal flight angle (parallel to longest edge)
    const flightAngle = findOptimalFlightAngle(boundary)

    // Rotate boundary to align with axes
    const rotatedBoundary = boundary.map(p => rotatePoint(p, center, -flightAngle))

    // Get bounds of rotated polygon
    const rotatedLats = rotatedBoundary.map(p => p.lat)
    const rotatedLngs = rotatedBoundary.map(p => p.lng)
    const north = Math.max(...rotatedLats)
    const south = Math.min(...rotatedLats)
    const east = Math.max(...rotatedLngs)
    const west = Math.min(...rotatedLngs)

    const altitudeFt = parseInt(altitude) || 100
    const altitudeM = altitudeFt * 0.3048
    const horizontalFOV = 84
    const verticalFOV = 55
    const frontalOverlap = MISSION_PRESETS['3d-fast'].frontalOverlap
    const sideOverlap = MISSION_PRESETS['3d-fast'].sideOverlap

    const coverageWidth = 2 * altitudeM * Math.tan((horizontalFOV / 2) * Math.PI / 180)
    const lineSpacing = coverageWidth * (1 - sideOverlap / 100)
    const forwardCoverage = 2 * altitudeM * Math.tan((verticalFOV / 2) * Math.PI / 180)
    const photoIntervalMeters = forwardCoverage * (1 - frontalOverlap / 100)
    const lineSpacingDeg = lineSpacing / 111320
    const lngSpacingDeg = lineSpacing / (111320 * Math.cos(centerLat * Math.PI / 180))

    const allWaypoints: Waypoint[] = []

    // Calculate heading offset based on flight angle (convert radians to degrees)
    const headingOffset = flightAngle * 180 / Math.PI

    const generateLineWaypoints = (
      startLat: number, startLng: number,
      endLat: number, endLng: number,
      gimbalPitch: number,
      baseDirection: 'primary' | 'primary-reverse' | 'perpendicular' | 'perpendicular-reverse'
    ): Waypoint[] => {
      let heading = 0
      if (gimbalPitch > -90) {
        switch (baseDirection) {
          case 'primary': heading = 90 + headingOffset; break
          case 'primary-reverse': heading = 270 + headingOffset; break
          case 'perpendicular': heading = 0 + headingOffset; break
          case 'perpendicular-reverse': heading = 180 + headingOffset; break
        }
        heading = ((heading % 360) + 360) % 360
      }
      return generateCameraTriggerWaypoints(
        startLat, startLng, endLat, endLng, photoIntervalMeters
      ).map(wp => ({ ...wp, gimbalPitch, heading }))
    }

    // PASS 1: Nadir single-grid (primary direction)
    let currentLat = south
    let lineNumber = 0
    while (currentLat <= north) {
      const goingEast = lineNumber % 2 === 0
      const lineStart = goingEast ? { lat: currentLat, lng: west } : { lat: currentLat, lng: east }
      const lineEnd = goingEast ? { lat: currentLat, lng: east } : { lat: currentLat, lng: west }

      const lineWaypoints = generateLineWaypoints(
        lineStart.lat, lineStart.lng, lineEnd.lat, lineEnd.lng,
        -90, goingEast ? 'primary' : 'primary-reverse'
      )
      allWaypoints.push(...lineWaypoints)
      currentLat += lineSpacingDeg
      lineNumber++
    }

    // PASS 2: Oblique primary direction lines
    currentLat = south
    lineNumber = 0
    while (currentLat <= north) {
      const goingEast = lineNumber % 2 === 0
      const lineStart = goingEast ? { lat: currentLat, lng: west } : { lat: currentLat, lng: east }
      const lineEnd = goingEast ? { lat: currentLat, lng: east } : { lat: currentLat, lng: west }

      const lineWaypoints = generateLineWaypoints(
        lineStart.lat, lineStart.lng, lineEnd.lat, lineEnd.lng,
        -45, goingEast ? 'primary' : 'primary-reverse'
      )
      allWaypoints.push(...lineWaypoints)
      currentLat += lineSpacingDeg
      lineNumber++
    }

    // PASS 3: Oblique perpendicular lines
    let currentLng = west
    lineNumber = 0
    while (currentLng <= east) {
      const goingNorth = lineNumber % 2 === 0
      const lineStart = goingNorth ? { lat: south, lng: currentLng } : { lat: north, lng: currentLng }
      const lineEnd = goingNorth ? { lat: north, lng: currentLng } : { lat: south, lng: currentLng }

      const lineWaypoints = generateLineWaypoints(
        lineStart.lat, lineStart.lng, lineEnd.lat, lineEnd.lng,
        -45, goingNorth ? 'perpendicular' : 'perpendicular-reverse'
      )
      allWaypoints.push(...lineWaypoints)
      currentLng += lngSpacingDeg
      lineNumber++
    }

    // Rotate waypoints back to original coordinate system
    const rotatedWaypoints = allWaypoints.map(wp => {
      const rotatedBack = rotatePoint(wp, center, flightAngle)
      return { ...wp, lat: rotatedBack.lat, lng: rotatedBack.lng }
    })

    // Filter to only include points inside the original polygon
    const filteredWaypoints = boundary.length >= 3
      ? rotatedWaypoints.filter(wp => isPointInPolygon(wp, boundary))
      : rotatedWaypoints

    return {
      coordinates: filteredWaypoints,
      photoIntervalMeters,
      estimatedPhotos: filteredWaypoints.length
    }
  }

  const generateFlightPath = (boundary: { lat: number; lng: number }[]): { coordinates: Waypoint[], photoIntervalMeters: number, estimatedPhotos: number } => {
    if (missionType === '3d-model') {
      return generateCrossHatchFlightPath(boundary, MISSION_PRESETS['3d-model'].gimbalAngles)
    }
    if (missionType === '3d-fast') {
      return generateFast3DFlightPath(boundary)
    }
    const result = generateOptimizedFlightPath(boundary)
    result.coordinates = result.coordinates.map(wp => ({ ...wp, gimbalPitch: -90 }))
    return result
  }

  const handleAreaDrawn = useCallback((drawnArea: MapArea) => {
    const boundary = drawnArea.points.map(p => ({ lat: p.lat, lng: p.lng }))

    if (boundary.length < 3) {
      setMapArea(drawnArea)
      return
    }

    const { coordinates, photoIntervalMeters, estimatedPhotos } = generateFlightPath(boundary)

    const newMapArea: MapArea = {
      ...drawnArea,
      coordinates,
      photoIntervalMeters,
      estimatedPhotos,
      missionType,
      gimbalAngles: MISSION_PRESETS[missionType].gimbalAngles
    }

    setMapArea(newMapArea)
  }, [missionType, altitude, overlap])

  // Regenerate flight path when mission type changes
  useEffect(() => {
    if (mapArea && mapArea.points && mapArea.points.length >= 3 && (!selectedPlot || selectedPlot === 'custom')) {
      if (mapArea.missionType !== missionType) {
        const boundary = mapArea.points.map(p => ({ lat: p.lat, lng: p.lng }))
        const { coordinates, photoIntervalMeters, estimatedPhotos } = generateFlightPath(boundary)

        setMapArea(prev => prev ? {
          ...prev,
          coordinates,
          photoIntervalMeters,
          estimatedPhotos,
          missionType,
          gimbalAngles: MISSION_PRESETS[missionType].gimbalAngles
        } : null)
      }
    }
  }, [missionType])

  useEffect(() => {
    if (isDemo) {
      const demoPlots = [
        {
          id: '1',
          name: 'North Field A',
          area_acres: 2.5,
          boundaries: {
            coordinates: [[
              [-118.2439, 34.0524],
              [-118.2436, 34.0524],
              [-118.2436, 34.0522],
              [-118.2439, 34.0522],
              [-118.2439, 34.0524]
            ]]
          }
        },
        {
          id: '2',
          name: 'Greenhouse Block B',
          area_acres: 1.8,
          boundaries: {
            coordinates: [[
              [-118.2435, 34.0521],
              [-118.2433, 34.0521],
              [-118.2433, 34.0519],
              [-118.2435, 34.0519],
              [-118.2435, 34.0521]
            ]]
          }
        },
        {
          id: '3',
          name: 'South Nursery',
          area_acres: 3.2,
          boundaries: {
            coordinates: [[
              [-118.2440, 34.0519],
              [-118.2437, 34.0519],
              [-118.2437, 34.0516],
              [-118.2440, 34.0516],
              [-118.2440, 34.0519]
            ]]
          }
        },
      ]
      setPlots(demoPlots)
      setLoading(false)

      if (editId) {
        setName('Weekly Survey - North Field')
        setSelectedPlot('1')
        setDroneModel('DJI Mavic 3')
        setAltitude('100')
        setSpeed('16')
        setOverlap('80')
        setScheduledDate('2024-01-25')
      }
    } else {
      fetchData()
    }
  }, [isDemo, editId])

  const fetchData = async () => {
    if (!user) return

    try {
      const { data: plotsData, error: plotsError } = await supabase
        .from('plots')
        .select('*')
        .eq('user_id', user.id)

      if (plotsError) throw plotsError
      setPlots(plotsData || [])

      if (editId) {
        const { data: flightPlan, error: fpError } = await supabase
          .from('flight_plans')
          .select('*')
          .eq('id', editId)
          .eq('user_id', user.id)
          .single()

        if (fpError) throw fpError

        if (flightPlan) {
          setName(flightPlan.name)
          setSelectedPlot(flightPlan.plot_id || 'custom')
          setDroneModel(flightPlan.drone_model)
          setAltitude(Math.round(flightPlan.altitude_m * 3.28084).toString())
          setSpeed(Math.round(flightPlan.speed_ms * 3.28084 * 10) / 10 + '')
          setOverlap(flightPlan.overlap_percent.toString())
          if (flightPlan.scheduled_for) {
            const date = new Date(flightPlan.scheduled_for)
            setScheduledDate(date.toISOString().slice(0, 16))
          }
          if (flightPlan.waypoints) {
            setMapArea({
              id: Date.now(),
              points: [],
              area: 'Existing flight plan',
              coordinates: flightPlan.waypoints.coordinates.map((coord: number[]) => ({
                lat: coord[1],
                lng: coord[0]
              }))
            })
          }
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!name) {
      setError('Please provide a flight plan name')
      return
    }

    if (selectedPlot === 'custom' && !mapArea) {
      setError('Please draw a survey area on the map')
      return
    }

    if (selectedPlot !== 'custom' && !selectedPlot) {
      setError('Please select a plot or choose custom area')
      return
    }

    if (isDemo) {
      alert('Flight plan saved successfully! (Demo mode)')
      router.push('/dashboard?tab=flights')
      return
    }

    setSaving(true)
    setError('')

    try {
      const altitudeFt = parseInt(altitude) || 100
      const speedFtS = parseFloat(speed) || 16

      const flightPlanData = {
        user_id: user!.id,
        plot_id: selectedPlot === 'custom' ? null : selectedPlot,
        name,
        drone_model: droneModel,
        altitude_m: Math.round(altitudeFt * 0.3048),
        speed_ms: Math.round(speedFtS * 0.3048 * 10) / 10,
        overlap_percent: parseInt(overlap),
        waypoints: mapArea ? {
          type: 'LineString',
          coordinates: mapArea.coordinates.map((coord: Waypoint) => [coord.lng, coord.lat]),
          actions: mapArea.coordinates.map((coord: Waypoint) => coord.action),
          gimbalPitches: mapArea.coordinates.map((coord: Waypoint) => coord.gimbalPitch || -90),
          headings: mapArea.coordinates.map((coord: Waypoint) => coord.heading || 0),
          photoIntervalMeters: mapArea.photoIntervalMeters,
          estimatedPhotos: mapArea.estimatedPhotos,
          missionType: mapArea.missionType || 'orthomosaic'
        } : null,
        mission_type: missionType,
        estimated_duration_min: Math.round((mapArea?.coordinates.length || 0) * 0.3) || 15,
        scheduled_for: scheduledDate || new Date().toISOString(),
      }

      let dbError

      if (editId) {
        const { error } = await supabase
          .from('flight_plans')
          .update(flightPlanData)
          .eq('id', editId)
          .eq('user_id', user!.id)
        dbError = error
      } else {
        const { error } = await supabase
          .from('flight_plans')
          .insert(flightPlanData)
          .select()
          .single()
        dbError = error
      }

      if (dbError) throw dbError

      router.push('/dashboard?tab=flights')
    } catch (err: any) {
      setError(err.message || 'Failed to save flight plan')
    } finally {
      setSaving(false)
    }
  }

  // Get center for map
  const getMapCenter = (): [number, number] | undefined => {
    if (currentPlotBoundary && currentPlotBoundary.length > 0) {
      return [currentPlotBoundary[0].lat, currentPlotBoundary[0].lng]
    }
    return undefined
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    )
  }

  const selectedPlotData = plots.find(p => p.id === selectedPlot)

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b bg-white">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard">
              <Image
                src="/images/plnt-logo.svg"
                alt="PLNT Logo"
                width={120}
                height={40}
                className="h-10 w-auto"
                priority
              />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {editId ? 'Edit' : 'Create'} Flight Plan
              </h1>
              <p className="text-gray-600">Configure your drone survey mission</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDemo && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                Demo Mode
              </Badge>
            )}
            {!sidebarOpen && (
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => setSidebarOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Configure
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Map */}
        <div className="h-full">
          {(!selectedPlot || selectedPlot === 'custom') ? (
            <EnhancedSatelliteMap
              onAreaDrawn={handleAreaDrawn}
              altitude={Math.round((parseInt(altitude) || 100) * 0.3048)}
            />
          ) : (
            <div className="h-full relative">
              <EnhancedSatelliteMap
                onAreaDrawn={handleAreaDrawn}
                defaultCenter={getMapCenter()}
                existingBoundary={currentPlotBoundary}
                altitude={Math.round((parseInt(altitude) || 100) * 0.3048)}
              />
              {/* Plot info overlay */}
              {selectedPlotData && (
                <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs">
                  <div className="flex items-center space-x-2">
                    <MapPin className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {selectedPlotData.name}
                      </p>
                      <p className="text-xs text-gray-600">
                        Flight path auto-generated | {selectedPlotData.area_acres} acres
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <FlightPlannerSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isEditing={!!editId}
          name={name}
          setName={setName}
          missionType={missionType}
          setMissionType={setMissionType}
          droneModel={droneModel}
          setDroneModel={setDroneModel}
          altitude={altitude}
          setAltitude={setAltitude}
          speed={speed}
          setSpeed={setSpeed}
          overlap={overlap}
          setOverlap={setOverlap}
          scheduledDate={scheduledDate}
          setScheduledDate={setScheduledDate}
          mapArea={mapArea}
          onSave={handleSave}
          saving={saving}
          error={error}
        />
      </div>
    </div>
  )
}
