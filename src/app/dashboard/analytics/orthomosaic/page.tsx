'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  MapIcon,
  Layers,
  Tag,
  Download,
  RefreshCw,
  ChevronLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  QrCode,
  Scan,
  Sparkles,
  TreeDeciduous,
  BarChart3,
  Camera,
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'

// Dynamic import for map component (Leaflet requires browser APIs)
const OrthomosaicMap = dynamic(() => import('@/components/orthomosaic-map'), {
  ssr: false,
  loading: () => (
    <div className="h-[600px] bg-gray-100 rounded-lg flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  ),
})

// Demo orthomosaic data
const DEMO_ORTHOMOSAIC = {
  id: 'demo-ortho-1',
  name: 'Demo Orthomosaic - North Field',
  status: 'completed',
  bounds: {
    north: 33.4520,
    south: 33.4480,
    east: -111.9380,
    west: -111.9420,
  },
  resolution_cm: 1.5,
  image_width: 8000,
  image_height: 6000,
  created_at: new Date().toISOString(),
  flight_id: 'demo-flight-1',
  // Use a sample orthomosaic image for demo
  orthomosaic_url: '/demo-orthomosaic.jpg',
}

const DEMO_LABELS = [
  { id: '1', latitude: 33.4505, longitude: -111.9400, source: 'manual', label: 'healthy', notes: 'Good growth', verified: true },
  { id: '2', latitude: 33.4495, longitude: -111.9395, source: 'ai', label: 'stressed', confidence: 0.87, verified: false },
  { id: '3', latitude: 33.4500, longitude: -111.9410, source: 'ai', label: 'healthy', confidence: 0.95, verified: true },
  { id: '4', latitude: 33.4510, longitude: -111.9405, source: 'manual', label: 'plant', notes: 'New seedling', verified: true },
]

interface Orthomosaic {
  id: string
  name: string
  status: string
  bounds: {
    north: number
    south: number
    east: number
    west: number
  } | null
  resolution_cm: number | null
  image_width: number | null
  image_height: number | null
  orthomosaic_url: string | null
  tiles_url?: string | null
  created_at: string
  flight_id: string
  error_message?: string
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
  // Species information from registration
  species_name?: string
  scientific_name?: string
  category?: string
  container_size?: string
  plot_name?: string
  registration_id?: string
}

interface ArUcoStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  markerCount: number
  error?: string
}

export default function OrthomosaicViewerPage() {
  const { user, session, isDemo, loading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  const orthomosaicId = searchParams.get('id')

  const [orthomosaics, setOrthomosaics] = useState<Orthomosaic[]>([])
  const [selectedOrthomosaic, setSelectedOrthomosaic] = useState<Orthomosaic | null>(null)

  // Reload orthomosaics list and update selected ortho
  const reloadOrthomosaic = async (id: string) => {
    const response = await fetch('/api/orthomosaic/list', { cache: 'no-store' })
    if (!response.ok) return null
    const { orthomosaics: data } = await response.json()
    // Refresh the full list so new orthos appear in the dropdown
    if (data) setOrthomosaics(data)
    const updated = data?.find((o: Orthomosaic) => o.id === id)
    if (updated) {
      setSelectedOrthomosaic(updated)
    }
    return updated
  }
  const [labels, setLabels] = useState<PlantLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [labelsLoading, setLabelsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [labelMode, setLabelMode] = useState(false)
  const [selectedLabelType, setSelectedLabelType] = useState('plant')
  const [processingStatus, setProcessingStatus] = useState<any>(null)
  const [arucoMarkers, setArucoMarkers] = useState<ArUcoMarker[]>([])
  const [arucoStatus, setArucoStatus] = useState<ArUcoStatus | null>(null)
  const [arucoDetecting, setArucoDetecting] = useState(false)

  // Plant detection state
  const [plantDetecting, setPlantDetecting] = useState(false)
  const [plantDetectionResult, setPlantDetectionResult] = useState<{
    totalDetections: number
    savedCount?: number
    classCounts: Record<string, number>
    averageConfidence: number
  } | null>(null)
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5)
  const [detectionProgress, setDetectionProgress] = useState<{
    processedTiles: number
    totalTiles: number
    detectionsCount: number
    phase: string
  } | null>(null)

  // Raw image detection state
  const [rawDetecting, setRawDetecting] = useState(false)
  const [rawDetectionProgress, setRawDetectionProgress] = useState<{
    imageIndex: number
    totalImages: number
    imageName: string
    phase: string
    detectionsInImage?: number
    totalDetections?: number
  } | null>(null)
  const [showDetectionSettings, setShowDetectionSettings] = useState(false)
  const [plotAggregation, setPlotAggregation] = useState<{
    plotCounts: Array<{
      plotId: string
      plotName: string
      speciesName?: string
      totalCount: number
      verifiedCount: number
      boundaries?: any
    }>
    speciesSummary: Array<{ name: string; count: number }>
    unassignedCount: number
  } | null>(null)
  const [showAggregation, setShowAggregation] = useState(false)

  const [extractingBounds, setExtractingBounds] = useState(false)

  // Plots state for map visualization
  const [plots, setPlots] = useState<Array<{
    id: string
    name: string
    boundaries: any
    species_name?: string
    plant_count?: number
  }>>([])
  const [plotsLoading, setPlotsLoading] = useState(false)

  // Load orthomosaics
  useEffect(() => {
    async function loadOrthomosaics() {
      if (isDemo) {
        setOrthomosaics([DEMO_ORTHOMOSAIC as Orthomosaic])
        setSelectedOrthomosaic(DEMO_ORTHOMOSAIC as Orthomosaic)
        setLabels(DEMO_LABELS as PlantLabel[])
        setLoading(false)
        return
      }

      try {
        setError(null)

        // Fetch orthomosaics via API (uses service role — no auth needed)
        const response = await fetch('/api/orthomosaic/list', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('Failed to fetch orthomosaics')
        }
        const { orthomosaics: data } = await response.json()

        setOrthomosaics(data || [])

        // Auto-select if ID provided or select first one
        if (orthomosaicId && data) {
          const found = data.find(o => o.id === orthomosaicId)
          if (found) setSelectedOrthomosaic(found)
        } else if (data && data.length > 0) {
          setSelectedOrthomosaic(data[0])
        }
      } catch (err) {
        console.error('Error loading orthomosaics:', err)
        setError('Failed to load orthomosaics')
      } finally {
        setLoading(false)
      }
    }

    loadOrthomosaics()
  }, [isDemo, orthomosaicId])

  // Load labels when orthomosaic is selected
  useEffect(() => {
    async function loadLabels() {
      if (!selectedOrthomosaic || isDemo) return

      setLabelsLoading(true)
      try {
        const response = await fetch(
          `/api/plant-labels?orthomosaicId=${selectedOrthomosaic.id}`
        )
        const data = await response.json()
        if (data.labels) {
          setLabels(data.labels)
        }
      } catch (err) {
        console.error('Error loading labels:', err)
      } finally {
        setLabelsLoading(false)
      }
    }

    loadLabels()
  }, [selectedOrthomosaic, isDemo])

  // Load ArUco markers and status when orthomosaic is selected
  useEffect(() => {
    async function loadArucoData() {
      if (!selectedOrthomosaic || isDemo) return

      try {
        // Get ArUco status
        const statusResponse = await fetch(
          `/api/aruco/status?orthomosaicId=${selectedOrthomosaic.id}`
        )
        const statusData = await statusResponse.json()
        setArucoStatus(statusData)

        // Get markers if detection is completed
        if (statusData.status === 'completed') {
          const markersResponse = await fetch(
            `/api/aruco/markers?orthomosaicId=${selectedOrthomosaic.id}`
          )
          const markersData = await markersResponse.json()
          if (markersData.markers && markersData.markers.length > 0) {
            // Fetch species registrations for these markers
            const markerIds = markersData.markers.map((m: ArUcoMarker) => m.marker_id)
            const registrationsResponse = await fetch('/api/marker-registrations/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ markerIds, userId: user?.id }),
            })
            const registrationsData = await registrationsResponse.json()
            const registrations = registrationsData.registrations || {}

            // Merge species info into markers
            const markersWithSpecies = markersData.markers.map((marker: ArUcoMarker) => {
              const reg = registrations[marker.marker_id]
              if (reg) {
                return {
                  ...marker,
                  species_name: reg.species_name,
                  scientific_name: reg.scientific_name,
                  category: reg.category,
                  container_size: reg.container_size,
                  plot_name: reg.plot_name,
                  registration_id: reg.registration_id,
                }
              }
              return marker
            })

            setArucoMarkers(markersWithSpecies)
          } else {
            setArucoMarkers(markersData.markers || [])
          }
        }
      } catch (err) {
        console.error('Error loading ArUco data:', err)
      }
    }

    loadArucoData()
  }, [selectedOrthomosaic, isDemo, user])

  // Poll for processing status if orthomosaic is pending/processing/syncing
  useEffect(() => {
    if (!selectedOrthomosaic) return
    if (selectedOrthomosaic.status !== 'pending' && selectedOrthomosaic.status !== 'processing' && selectedOrthomosaic.status !== 'syncing') return
    if (isDemo) return

    let syncing = false

    const pollStatus = async () => {
      try {
        // If pending (images still uploading to Lightning), just check DB for status change
        if (selectedOrthomosaic.status === 'pending') {
          const updated = await reloadOrthomosaic(selectedOrthomosaic.id)
          if (updated?.status === 'processing' || updated?.status === 'failed') return
          return
        }

        // If already syncing (downloading orthophoto), just check for completion
        if (selectedOrthomosaic.status === 'syncing' || syncing) {
          const updated = await reloadOrthomosaic(selectedOrthomosaic.id)
          if (updated?.status === 'completed') return
          return
        }

        const response = await fetch(
          `/api/webodm/task-status?orthomosaicId=${selectedOrthomosaic.id}`
        )
        const data = await response.json()
        setProcessingStatus(data)

        if (data.needsSync && !syncing) {
          // Lightning task is done — trigger the sync route to download the orthophoto.
          // This runs in the background; we keep polling the DB until status flips.
          syncing = true
          setProcessingStatus((prev: any) => ({
            ...prev,
            statusLabel: 'Downloading orthophoto...',
          }))

          fetch('/api/lightning/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orthomosaicId: selectedOrthomosaic.id }),
          })
            .then(async (syncRes) => {
              const syncData = await syncRes.json()
              if (syncData.success) {
                await reloadOrthomosaic(selectedOrthomosaic.id)
              }
            })
            .catch((err) => console.error('Sync error:', err))
            .finally(() => { syncing = false })
        } else if (data.isComplete && !data.needsSync) {
          // Non-Lightning task completed directly
          await reloadOrthomosaic(selectedOrthomosaic.id)
        }
      } catch (err) {
        console.error('Error polling status:', err)
      }
    }

    pollStatus()
    const interval = setInterval(pollStatus, 5000)
    return () => clearInterval(interval)
  }, [selectedOrthomosaic, isDemo])

  // Auto-generate tiles when an ortho completes and doesn't have them yet
  const [generatingTiles, setGeneratingTiles] = useState(false)

  useEffect(() => {
    if (!selectedOrthomosaic) return
    if (isDemo) return
    if (selectedOrthomosaic.status !== 'completed') return
    if (selectedOrthomosaic.tiles_url) return // Already has tiles
    if (!selectedOrthomosaic.orthomosaic_url) return
    if (!selectedOrthomosaic.bounds) return
    if (generatingTiles) return

    // Auto-trigger tile generation
    setGeneratingTiles(true)
    console.log('[Tiles] Auto-generating tiles for', selectedOrthomosaic.id)

    fetch('/api/orthomosaic/generate-tiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orthomosaicId: selectedOrthomosaic.id }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (data.success) {
          console.log(`[Tiles] Generated ${data.totalTiles} tiles`)
          await reloadOrthomosaic(selectedOrthomosaic.id)
        } else {
          console.error('[Tiles] Generation failed:', data.error)
        }
      })
      .catch((err) => console.error('[Tiles] Error:', err))
      .finally(() => setGeneratingTiles(false))
  }, [selectedOrthomosaic, isDemo, generatingTiles])

  // Handle adding a new label
  const handleAddLabel = async (lat: number, lng: number, pixelX?: number, pixelY?: number) => {
    if (!selectedOrthomosaic) return

    if (isDemo) {
      const newLabel: PlantLabel = {
        id: `demo-${Date.now()}`,
        latitude: lat,
        longitude: lng,
        pixel_x: pixelX,
        pixel_y: pixelY,
        source: 'manual',
        label: selectedLabelType,
        verified: true,
      }
      setLabels(prev => [...prev, newLabel])
      return
    }

    try {
      const response = await fetch('/api/plant-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orthomosaicId: selectedOrthomosaic.id,
          userId: user?.id,
          latitude: lat,
          longitude: lng,
          pixelX,
          pixelY,
          label: selectedLabelType,
        }),
      })

      const data = await response.json()
      if (data.label) {
        setLabels(prev => [...prev, data.label])
      }
    } catch (err) {
      console.error('Error adding label:', err)
    }
  }

  // Handle deleting a label
  const handleDeleteLabel = async (labelId: string) => {
    if (isDemo) {
      setLabels(prev => prev.filter(l => l.id !== labelId))
      return
    }

    try {
      await fetch(`/api/plant-labels?id=${labelId}`, { method: 'DELETE' })
      setLabels(prev => prev.filter(l => l.id !== labelId))
    } catch (err) {
      console.error('Error deleting label:', err)
    }
  }

  // Handle verifying a label
  const handleVerifyLabel = async (labelId: string, verified: boolean) => {
    if (isDemo) {
      setLabels(prev =>
        prev.map(l => l.id === labelId ? { ...l, verified } : l)
      )
      return
    }

    try {
      await fetch('/api/plant-labels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: labelId, verified, verifiedBy: user?.id }),
      })
      setLabels(prev =>
        prev.map(l => l.id === labelId ? { ...l, verified } : l)
      )
    } catch (err) {
      console.error('Error verifying label:', err)
    }
  }

  // Handle ArUco detection
  const handleDetectAruco = async () => {
    if (!selectedOrthomosaic || isDemo) return

    setArucoDetecting(true)
    setArucoStatus({ status: 'processing', markerCount: 0 })

    try {
      const response = await fetch('/api/aruco/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orthomosaicId: selectedOrthomosaic.id }),
      })

      const data = await response.json()

      if (data.success) {
        setArucoStatus({
          status: 'completed',
          markerCount: data.markerCount,
        })
        // Reload markers with species info
        const markersResponse = await fetch(
          `/api/aruco/markers?orthomosaicId=${selectedOrthomosaic.id}`
        )
        const markersData = await markersResponse.json()
        if (markersData.markers && markersData.markers.length > 0) {
          // Fetch species registrations for these markers
          const markerIds = markersData.markers.map((m: ArUcoMarker) => m.marker_id)
          const registrationsResponse = await fetch('/api/marker-registrations/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markerIds, userId: user?.id }),
          })
          const registrationsData = await registrationsResponse.json()
          const registrations = registrationsData.registrations || {}

          // Merge species info into markers
          const markersWithSpecies = markersData.markers.map((marker: ArUcoMarker) => {
            const reg = registrations[marker.marker_id]
            if (reg) {
              return {
                ...marker,
                species_name: reg.species_name,
                scientific_name: reg.scientific_name,
                category: reg.category,
                container_size: reg.container_size,
                plot_name: reg.plot_name,
                registration_id: reg.registration_id,
              }
            }
            return marker
          })

          setArucoMarkers(markersWithSpecies)
        } else {
          setArucoMarkers(markersData.markers || [])
        }
      } else {
        setArucoStatus({
          status: 'failed',
          markerCount: 0,
          error: data.error || 'Detection failed',
        })
      }
    } catch (err) {
      console.error('Error detecting ArUco markers:', err)
      setArucoStatus({
        status: 'failed',
        markerCount: 0,
        error: err instanceof Error ? err.message : 'Detection failed',
      })
    } finally {
      setArucoDetecting(false)
    }
  }

  // Handle plant detection with YOLOv11 (reads streaming NDJSON progress)
  const handlePlantDetection = async () => {
    if (!selectedOrthomosaic || isDemo) return

    setPlantDetecting(true)
    setPlantDetectionResult(null)
    setDetectionProgress(null)
    setPlotAggregation(null)

    try {
      const response = await fetch('/api/plant-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orthomosaicId: selectedOrthomosaic.id,
          userId: user?.id,
          confidence_threshold: confidenceThreshold,
          prompt: 'individual plant',
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Detection failed:', errorData.error)
        alert(errorData.error || 'Plant detection failed')
        return
      }

      // Read NDJSON stream line-by-line
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: Record<string, unknown> | null = null

      const processLine = (line: string) => {
        if (!line.trim()) return
        try {
          const event = JSON.parse(line)

          if (event.type === 'progress') {
            setDetectionProgress({
              processedTiles: event.processedTiles,
              totalTiles: event.totalTiles,
              detectionsCount: event.detectionsCount,
              phase: event.phase,
            })
          } else if (event.type === 'result') {
            finalResult = event
          } else if (event.type === 'error') {
            console.error('Detection error:', event.error)
            alert(event.error || 'Plant detection failed')
          }
        } catch {
          // Skip malformed lines
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          processLine(line)
        }
      }

      // Flush any remaining data in the buffer (the final "result" event)
      buffer += decoder.decode() // flush TextDecoder
      if (buffer.trim()) {
        processLine(buffer)
      }

      console.log('[Detection] Stream complete. finalResult:', finalResult)

      if (finalResult && finalResult.success) {
        setPlantDetectionResult({
          totalDetections: finalResult.totalDetections as number,
          savedCount: finalResult.savedCount as number,
          classCounts: finalResult.classCounts as Record<string, number>,
          averageConfidence: finalResult.averageConfidence as number,
        })

        if ((finalResult.totalDetections as number) === 0) {
          alert('No plants detected. Try lowering the confidence threshold in Settings.')
        }

        // Reload labels to include new AI detections
        const labelsResponse = await fetch(
          `/api/plant-labels?orthomosaicId=${selectedOrthomosaic.id}`
        )
        const labelsData = await labelsResponse.json()
        if (labelsData.labels) {
          setLabels(labelsData.labels)
        }

        // Automatically aggregate by plot
        await handleAggregateByPlot()
      } else if (!finalResult) {
        console.error('[Detection] No result event received from stream')
        alert('Plant detection completed but no results were received. Check Vercel logs.')
      }
    } catch (err) {
      console.error('Error running plant detection:', err)
      alert('Failed to run plant detection. Check console for details.')
    } finally {
      setPlantDetecting(false)
      setDetectionProgress(null)
    }
  }

  // Handle raw image detection (runs YOLOv11 on original drone photos)
  // Processes in batches to avoid Vercel's 300s timeout
  const handleRawImageDetection = async () => {
    if (!selectedOrthomosaic || isDemo) return

    setRawDetecting(true)
    setPlantDetectionResult(null)
    setRawDetectionProgress(null)
    setPlotAggregation(null)

    const BATCH_SIZE = 5
    let currentStartIndex = 0
    let allDone = false

    try {
      while (!allDone) {
        console.log(`[RawDetection] Starting batch at index ${currentStartIndex}`)

        const response = await fetch('/api/flight-detection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orthomosaicId: selectedOrthomosaic.id,
            userId: user?.id,
            confidence_threshold: confidenceThreshold,
            startIndex: currentStartIndex,
            batchSize: BATCH_SIZE,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          console.error('Raw detection failed:', errorData.error)
          alert(errorData.error || 'Raw image detection failed')
          return
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let finalResult: Record<string, unknown> | null = null

        const processLine = (line: string) => {
          if (!line.trim()) return
          try {
            const event = JSON.parse(line)

            if (event.type === 'imageProgress') {
              setRawDetectionProgress({
                imageIndex: event.imageIndex,
                totalImages: event.totalImages,
                imageName: event.imageName,
                phase: event.phase,
                detectionsInImage: event.detectionsInImage,
                totalDetections: event.totalDetections,
              })
            } else if (event.type === 'result') {
              finalResult = event
            } else if (event.type === 'error') {
              console.error('Raw detection error:', event.error)
              alert(event.error || 'Raw image detection failed')
            }
          } catch {
            // Skip malformed lines
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            processLine(line)
          }
        }

        buffer += decoder.decode()
        if (buffer.trim()) processLine(buffer)

        if (finalResult && finalResult.success) {
          if (finalResult.isLastBatch) {
            allDone = true
          } else if (finalResult.nextStartIndex) {
            currentStartIndex = finalResult.nextStartIndex as number
            console.log(`[RawDetection] Batch complete, continuing at index ${currentStartIndex}`)
          } else {
            allDone = true
          }

          // Update result display after each batch
          setPlantDetectionResult({
            totalDetections: finalResult.totalDetections as number,
            savedCount: finalResult.savedCount as number,
            classCounts: {},
            averageConfidence: 0,
          })
        } else {
          // No result or error — stop retrying
          allDone = true
        }
      }

      // All batches complete — reload labels
      const labelsResponse = await fetch(`/api/plant-labels?orthomosaicId=${selectedOrthomosaic.id}`)
      const labelsData = await labelsResponse.json()
      if (labelsData.labels) {
        setLabels(labelsData.labels)
      }

      await handleAggregateByPlot()
    } catch (err) {
      console.error('Error running raw image detection:', err)
      alert('Failed to run raw image detection. Check console for details.')
    } finally {
      setRawDetecting(false)
      setRawDetectionProgress(null)
    }
  }

  // Aggregate plant counts by plot
  const handleAggregateByPlot = async () => {
    if (!selectedOrthomosaic) return

    try {
      const response = await fetch('/api/plant-detection/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orthomosaicId: selectedOrthomosaic.id,
          userId: user?.id,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setPlotAggregation({
          plotCounts: data.plotCounts,
          speciesSummary: data.speciesSummary,
          unassignedCount: data.unassignedCount,
        })
        setShowAggregation(true)

        // Update plots for map visualization
        if (data.plotCounts && data.plotCounts.length > 0) {
          setPlots(data.plotCounts.map((pc: any) => ({
            id: pc.plotId,
            name: pc.plotName,
            boundaries: pc.boundaries,
            species_name: pc.speciesName,
            plant_count: pc.totalCount,
          })))
        }
      }
    } catch (err) {
      console.error('Error aggregating by plot:', err)
    }
  }

  // Auto-extract bounds for completed orthomosaics that are missing them
  // or have invalid UTM bounds (coordinates in meters instead of lat/lng degrees)
  // Skip if the orthophoto URL points to Lightning (ephemeral) or has a known download error
  useEffect(() => {
    if (!selectedOrthomosaic || isDemo) return
    if (selectedOrthomosaic.status !== 'completed') return
    if (!selectedOrthomosaic.orthomosaic_url) return
    if (extractingBounds) return
    // Don't retry on orthomosaics with dead URLs (Lightning cleanup, failed downloads)
    if (selectedOrthomosaic.error_message?.includes('404') || selectedOrthomosaic.error_message?.includes('Failed to download')) return
    // Don't try Lightning URLs — they expire quickly
    if (selectedOrthomosaic.orthomosaic_url.includes('spark1.webodm.net')) return

    // Check if bounds need extraction or re-extraction
    const needsBounds = !selectedOrthomosaic.bounds
    const hasUtmBounds = selectedOrthomosaic.bounds && (
      Math.abs(selectedOrthomosaic.bounds.west) > 180 ||
      Math.abs(selectedOrthomosaic.bounds.south) > 90
    )
    // Re-extract if URL is .tif or .jpg (needs WebP with transparency)
    const needsWebpConversion = selectedOrthomosaic.orthomosaic_url.endsWith('.tif')
      || selectedOrthomosaic.orthomosaic_url.endsWith('.jpg')
    if (!needsBounds && !hasUtmBounds && !needsWebpConversion) return

    const extractBounds = async () => {
      setExtractingBounds(true)
      try {
        const reason = hasUtmBounds ? 'UTM bounds' : needsWebpConversion ? 'WebP conversion' : 'missing bounds'
        console.log(`Auto-extracting (${reason}) for orthomosaic:`, selectedOrthomosaic.id)
        const res = await fetch('/api/orthomosaic/extract-bounds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orthomosaicId: selectedOrthomosaic.id, force: hasUtmBounds || needsWebpConversion }),
        })
        const data = await res.json()
        if (data.success && data.bounds) {
          await reloadOrthomosaic(selectedOrthomosaic.id)
        }
      } catch (err) {
        console.error('Auto-extract bounds error:', err)
      } finally {
        setExtractingBounds(false)
      }
    }

    extractBounds()
  }, [selectedOrthomosaic, isDemo])

  // Check for existing detections when orthomosaic changes
  useEffect(() => {
    async function checkExistingDetections() {
      if (!selectedOrthomosaic || isDemo) return

      try {
        const response = await fetch(
          `/api/plant-detection?orthomosaicId=${selectedOrthomosaic.id}`
        )
        const data = await response.json()

        if (data.hasDetections) {
          setPlantDetectionResult({
            totalDetections: data.totalDetections,
            classCounts: data.classCounts,
            averageConfidence: data.averageConfidence,
          })
          // Also load aggregation
          handleAggregateByPlot()
        }
      } catch (err) {
        console.error('Error checking existing detections:', err)
      }
    }

    checkExistingDetections()
  }, [selectedOrthomosaic, isDemo])

  // Handle verifying an ArUco marker
  const handleVerifyArucoMarker = async (markerId: string, verified: boolean) => {
    if (isDemo) return

    try {
      await fetch(`/api/aruco/markers/${markerId}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified }),
      })
      setArucoMarkers(prev =>
        prev.map(m => m.id === markerId ? { ...m, verified } : m)
      )
    } catch (err) {
      console.error('Error verifying ArUco marker:', err)
    }
  }

  // Export labels as CSV
  const exportLabelsCSV = () => {
    const headers = ['id', 'latitude', 'longitude', 'source', 'label', 'confidence', 'verified', 'notes']
    const rows = labels.map(l => [
      l.id,
      l.latitude,
      l.longitude,
      l.source,
      l.label,
      l.confidence || '',
      l.verified,
      l.notes || '',
    ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plant-labels-${selectedOrthomosaic?.name || 'export'}.csv`
    a.click()
  }

  // Export labels as GeoJSON
  const exportLabelsGeoJSON = () => {
    const geojson = {
      type: 'FeatureCollection',
      features: labels.map(l => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [l.longitude, l.latitude],
        },
        properties: {
          id: l.id,
          source: l.source,
          label: l.label,
          confidence: l.confidence,
          verified: l.verified,
          notes: l.notes,
        },
      })),
    }

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plant-labels-${selectedOrthomosaic?.name || 'export'}.geojson`
    a.click()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
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
                <h1 className="text-2xl font-bold text-gray-900">Orthomosaic Viewer</h1>
                <p className="text-gray-600">View orthomosaics and label plants with GPS coordinates</p>
              </div>
            </div>
            {isDemo && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                Demo Mode
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6">

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Orthomosaic Selector */}
      {orthomosaics.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Select Orthomosaic</CardTitle>
              {selectedOrthomosaic && (
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedOrthomosaic.status} />
                  {selectedOrthomosaic.resolution_cm && (
                    <Badge variant="outline">
                      {selectedOrthomosaic.resolution_cm.toFixed(1)} cm/px
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedOrthomosaic?.id || ''}
              onValueChange={(id) => {
                const ortho = orthomosaics.find(o => o.id === id)
                if (ortho) setSelectedOrthomosaic(ortho)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an orthomosaic" />
              </SelectTrigger>
              <SelectContent>
                {orthomosaics.map((ortho) => (
                  <SelectItem key={ortho.id} value={ortho.id}>
                    <div className="flex items-center gap-2">
                      <span className="truncate">{ortho.name}</span>
                      <StatusBadge status={ortho.status} small />
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(ortho.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {/* Processing Status */}
      {(selectedOrthomosaic?.status === 'processing' || selectedOrthomosaic?.status === 'syncing') && processingStatus && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <div className="flex-1">
                <div className="font-medium text-blue-900">Processing Orthomosaic</div>
                <div className="text-sm text-blue-700">
                  {processingStatus.statusLabel} - {Math.round(processingStatus.progress || 0)}%
                </div>
              </div>
              <div className="text-sm text-blue-600">
                {processingStatus.imagesCount} images
              </div>
            </div>
            <div className="mt-3 h-2 bg-blue-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-500"
                style={{ width: `${processingStatus.progress || 0}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed but no bounds */}
      {selectedOrthomosaic && selectedOrthomosaic.status === 'completed' && !selectedOrthomosaic.bounds && (
        (selectedOrthomosaic.error_message?.includes('404') || selectedOrthomosaic.error_message?.includes('Failed to download') || selectedOrthomosaic.orthomosaic_url?.includes('spark1.webodm.net')) ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <AlertCircle className="h-6 w-6 text-amber-600" />
                <div className="flex-1">
                  <div className="font-medium text-amber-900">Orthophoto Unavailable</div>
                  <div className="text-sm text-amber-700">
                    The orthophoto file has expired on the processing server. Please reprocess this orthomosaic to view it on the map.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                <div className="flex-1">
                  <div className="font-medium text-blue-900">Extracting Map Bounds</div>
                  <div className="text-sm text-blue-700">
                    Reading geo data from the orthophoto to enable the interactive map...
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* Main Content — map view (requires bounds) */}
      {selectedOrthomosaic && selectedOrthomosaic.status === 'completed' && selectedOrthomosaic.bounds && (
        <>
          {/* Controls */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <Button
                    variant={labelMode ? 'default' : 'outline'}
                    onClick={() => setLabelMode(!labelMode)}
                    className={labelMode ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    <Tag className="h-4 w-4 mr-2" />
                    {labelMode ? 'Labeling Mode ON' : 'Enable Labeling'}
                  </Button>

                  {labelMode && (
                    <Select value={selectedLabelType} onValueChange={setSelectedLabelType}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plant">Plant</SelectItem>
                        <SelectItem value="healthy">Healthy</SelectItem>
                        <SelectItem value="stressed">Stressed</SelectItem>
                        <SelectItem value="dead">Dead</SelectItem>
                        <SelectItem value="weed">Weed</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {labels.length} labels ({labels.filter(l => l.source === 'manual').length} manual, {labels.filter(l => l.source === 'ai').length} AI)
                  </Badge>

                  <Button variant="outline" size="sm" onClick={exportLabelsCSV}>
                    <Download className="h-4 w-4 mr-1" />
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportLabelsGeoJSON}>
                    <Download className="h-4 w-4 mr-1" />
                    GeoJSON
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ArUco Detection */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-5 w-5 text-gray-600" />
                    <span className="font-medium">ArUco Markers</span>
                  </div>

                  <Button
                    variant="outline"
                    onClick={handleDetectAruco}
                    disabled={arucoDetecting || arucoStatus?.status === 'processing'}
                  >
                    {arucoDetecting || arucoStatus?.status === 'processing' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Detecting...
                      </>
                    ) : (
                      <>
                        <Scan className="h-4 w-4 mr-2" />
                        {arucoStatus?.status === 'completed' ? 'Re-detect Markers' : 'Detect ArUco Markers'}
                      </>
                    )}
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  {arucoStatus?.status === 'completed' && (
                    <Badge variant="secondary" className="bg-green-100 text-green-700">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {arucoStatus.markerCount} markers found
                    </Badge>
                  )}
                  {arucoStatus?.status === 'failed' && (
                    <Badge variant="secondary" className="bg-red-100 text-red-700">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Detection failed
                    </Badge>
                  )}
                  {arucoStatus?.status === 'pending' && (
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                      Not detected yet
                    </Badge>
                  )}
                  {arucoMarkers.length > 0 && (
                    <Badge variant="outline">
                      {arucoMarkers.filter(m => m.verified).length}/{arucoMarkers.length} verified
                    </Badge>
                  )}
                </div>
              </div>

              {arucoStatus?.status === 'failed' && arucoStatus.error && (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{arucoStatus.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Plant Detection with SAM3 */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <TreeDeciduous className="h-5 w-5 text-green-600" />
                    <span className="font-medium">AI Plant Detection</span>
                  </div>

                  <Button
                    variant="default"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={handlePlantDetection}
                    disabled={plantDetecting || rawDetecting}
                  >
                    {plantDetecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Detecting Plants...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {plantDetectionResult ? 'Re-run Detection' : 'Count Plants'}
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    className="border-blue-300 text-blue-700 hover:bg-blue-50"
                    onClick={handleRawImageDetection}
                    disabled={rawDetecting || plantDetecting}
                  >
                    {rawDetecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing Raw Images...
                      </>
                    ) : (
                      <>
                        <Camera className="h-4 w-4 mr-2" />
                        Detect from Raw Images
                      </>
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDetectionSettings(!showDetectionSettings)}
                  >
                    Settings
                  </Button>

                  {plantDetectionResult && (
                    <Button
                      variant="outline"
                      onClick={() => setShowAggregation(!showAggregation)}
                    >
                      <BarChart3 className="h-4 w-4 mr-2" />
                      {showAggregation ? 'Hide' : 'Show'} By Plot
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {plantDetectionResult && (
                    <>
                      <Badge className="bg-green-100 text-green-700">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {plantDetectionResult.savedCount ?? plantDetectionResult.totalDetections} plants saved
                      </Badge>
                      {plantDetectionResult.savedCount !== undefined &&
                       plantDetectionResult.savedCount < plantDetectionResult.totalDetections && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                          {plantDetectionResult.totalDetections - plantDetectionResult.savedCount} failed to save
                        </Badge>
                      )}
                      <Badge variant="outline">
                        {(plantDetectionResult.averageConfidence * 100).toFixed(0)}% avg confidence
                      </Badge>
                    </>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {plantDetecting && detectionProgress && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                      <span className="text-sm font-medium text-green-800">
                        {detectionProgress.phase === 'extracting' && 'Extracting tiles...'}
                        {detectionProgress.phase === 'tiling' && 'Running inference...'}
                        {detectionProgress.phase === 'nms' && 'Removing duplicates...'}
                        {detectionProgress.phase === 'saving' && 'Saving to database...'}
                      </span>
                    </div>
                    <div className="text-sm text-green-700 font-mono">
                      {detectionProgress.processedTiles}/{detectionProgress.totalTiles} tiles
                      {detectionProgress.detectionsCount > 0 && (
                        <span className="ml-2">({detectionProgress.detectionsCount} plants found)</span>
                      )}
                    </div>
                  </div>
                  <div className="h-3 bg-green-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-600 rounded-full transition-all duration-300"
                      style={{
                        width: `${detectionProgress.totalTiles > 0
                          ? Math.round((detectionProgress.processedTiles / detectionProgress.totalTiles) * 100)
                          : 0}%`
                      }}
                    />
                  </div>
                  <div className="text-xs text-green-600 mt-1 text-right">
                    {detectionProgress.totalTiles > 0
                      ? Math.round((detectionProgress.processedTiles / detectionProgress.totalTiles) * 100)
                      : 0}%
                  </div>
                </div>
              )}

              {/* Raw Image Detection Progress */}
              {rawDetecting && rawDetectionProgress && (
                <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      <span className="text-sm font-medium text-blue-800">
                        {rawDetectionProgress.phase === 'downloading' && `Downloading ${rawDetectionProgress.imageName}...`}
                        {rawDetectionProgress.phase === 'decoding' && `Decoding ${rawDetectionProgress.imageName}...`}
                        {rawDetectionProgress.phase === 'inferring' && `Running inference on ${rawDetectionProgress.imageName}...`}
                        {rawDetectionProgress.phase === 'done' && `Completed ${rawDetectionProgress.imageName}`}
                      </span>
                    </div>
                    <div className="text-sm text-blue-700 font-mono">
                      Image {rawDetectionProgress.imageIndex + 1}/{rawDetectionProgress.totalImages}
                      {rawDetectionProgress.totalDetections !== undefined && (
                        <span className="ml-2">({rawDetectionProgress.totalDetections} plants total)</span>
                      )}
                    </div>
                  </div>
                  <div className="h-3 bg-blue-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-300"
                      style={{
                        width: `${rawDetectionProgress.totalImages > 0
                          ? Math.round(((rawDetectionProgress.imageIndex + (rawDetectionProgress.phase === 'done' ? 1 : 0.5)) / rawDetectionProgress.totalImages) * 100)
                          : 0}%`
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-blue-600 mt-1">
                    <span>
                      {rawDetectionProgress.detectionsInImage !== undefined
                        ? `${rawDetectionProgress.detectionsInImage} plants in this image`
                        : 'Processing...'}
                    </span>
                    <span>
                      {rawDetectionProgress.totalImages > 0
                        ? Math.round(((rawDetectionProgress.imageIndex + (rawDetectionProgress.phase === 'done' ? 1 : 0.5)) / rawDetectionProgress.totalImages) * 100)
                        : 0}%
                    </span>
                  </div>
                </div>
              )}

              {/* Detection Settings */}
              {showDetectionSettings && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                  <h4 className="font-medium mb-3">Detection Settings</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-gray-600 block mb-1">
                        Confidence Threshold: {(confidenceThreshold * 100).toFixed(0)}%
                      </label>
                      <input
                        type="range"
                        min="0.05"
                        max="0.5"
                        step="0.05"
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                        className="w-full max-w-xs"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Higher = fewer but more confident detections
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-600 block mb-1">Detection Prompt:</label>
                      <p className="text-sm font-mono bg-white px-2 py-1 rounded border inline-block">
                        individual plant
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        YOLOv11 object detection — custom-trained plant model
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Detection class breakdown */}
              {plantDetectionResult && plantDetectionResult.classCounts && Object.keys(plantDetectionResult.classCounts).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(plantDetectionResult.classCounts).map(([className, count]) => (
                    <Badge key={className} variant="secondary">
                      {className}: {count}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Plot aggregation results */}
              {showAggregation && plotAggregation && (
                <div className="mt-4 border-t pt-4">
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Plant Counts by Plot
                  </h4>

                  {plotAggregation.speciesSummary?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 mb-2">Species Summary:</p>
                      <div className="flex flex-wrap gap-2">
                        {plotAggregation.speciesSummary.map(species => (
                          <Badge key={species.name} className="bg-blue-100 text-blue-700">
                            {species.name}: {species.count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {plotAggregation.plotCounts.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-3">Plot</th>
                            <th className="text-left py-2 px-3">Species</th>
                            <th className="text-right py-2 px-3">Count</th>
                            <th className="text-right py-2 px-3">Verified</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plotAggregation.plotCounts.map(plot => (
                            <tr key={plot.plotId} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-3 font-medium">{plot.plotName}</td>
                              <td className="py-2 px-3 text-gray-600">{plot.speciesName || '-'}</td>
                              <td className="py-2 px-3 text-right font-mono">{plot.totalCount}</td>
                              <td className="py-2 px-3 text-right font-mono text-green-600">
                                {plot.verifiedCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="font-medium">
                            <td className="py-2 px-3">Total in plots</td>
                            <td></td>
                            <td className="py-2 px-3 text-right font-mono">
                              {plotAggregation.plotCounts.reduce((sum, p) => sum + p.totalCount, 0)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-green-600">
                              {plotAggregation.plotCounts.reduce((sum, p) => sum + p.verifiedCount, 0)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No plants assigned to plots yet.</p>
                  )}

                  {plotAggregation.unassignedCount > 0 && (
                    <p className="text-sm text-amber-600 mt-3">
                      {plotAggregation.unassignedCount} plants detected outside of plot boundaries
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Map */}
          <Card>
            <CardContent className="p-0 overflow-hidden rounded-lg">
              <OrthomosaicMap
                orthomosaic={selectedOrthomosaic}
                labels={labels}
                labelMode={labelMode}
                selectedLabelType={selectedLabelType}
                onAddLabel={handleAddLabel}
                onDeleteLabel={handleDeleteLabel}
                onVerifyLabel={handleVerifyLabel}
                arucoMarkers={arucoMarkers}
                onVerifyArucoMarker={handleVerifyArucoMarker}
                plots={plots}
              />
            </CardContent>
          </Card>

          {/* Labels Table */}
          {labels.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Plant Labels</CardTitle>
                <CardDescription>
                  Click on a label to view on map. AI labels can be verified or rejected.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3">Source</th>
                        <th className="text-left py-2 px-3">Label</th>
                        <th className="text-left py-2 px-3">Latitude</th>
                        <th className="text-left py-2 px-3">Longitude</th>
                        <th className="text-left py-2 px-3">Confidence</th>
                        <th className="text-left py-2 px-3">Status</th>
                        <th className="text-left py-2 px-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labels.slice(0, 50).map((label) => (
                        <tr key={label.id} className="border-b hover:bg-gray-50">
                          <td className="py-2 px-3">
                            <Badge variant={label.source === 'ai' ? 'secondary' : 'outline'}>
                              {label.source}
                            </Badge>
                          </td>
                          <td className="py-2 px-3">
                            <LabelBadge label={label.label} />
                          </td>
                          <td className="py-2 px-3 font-mono text-xs">
                            {label.latitude.toFixed(6)}
                          </td>
                          <td className="py-2 px-3 font-mono text-xs">
                            {label.longitude.toFixed(6)}
                          </td>
                          <td className="py-2 px-3">
                            {label.confidence ? `${(label.confidence * 100).toFixed(0)}%` : '-'}
                          </td>
                          <td className="py-2 px-3">
                            {label.verified ? (
                              <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4" /> Verified
                              </span>
                            ) : (
                              <span className="text-amber-600 flex items-center gap-1">
                                <Clock className="h-4 w-4" /> Pending
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1">
                              {!label.verified && label.source === 'ai' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleVerifyLabel(label.id, true)}
                                  className="text-green-600 hover:text-green-700"
                                >
                                  Verify
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteLabel(label.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {labels.length > 50 && (
                    <div className="text-center py-3 text-gray-500 text-sm">
                      Showing 50 of {labels.length} labels. Export to view all.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* No orthomosaics */}
      {orthomosaics.length === 0 && !loading && (
        <Card className="py-12">
          <CardContent className="text-center">
            <Layers className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium mb-2">No Orthomosaics Yet</h3>
            <p className="text-gray-600 mb-4">
              Upload drone images and create an orthomosaic to get started.
            </p>
            <Link href="/dashboard/upload">
              <Button>Go to Upload</Button>
            </Link>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  )
}

// Helper components
function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const variants: Record<string, { className: string; label: string }> = {
    pending: { className: 'bg-gray-100 text-gray-700', label: 'Pending' },
    processing: { className: 'bg-blue-100 text-blue-700', label: 'Processing' },
    completed: { className: 'bg-green-100 text-green-700', label: 'Completed' },
    failed: { className: 'bg-red-100 text-red-700', label: 'Failed' },
  }
  const v = variants[status] || variants.pending
  return (
    <Badge className={`${v.className} ${small ? 'text-xs' : ''}`}>
      {v.label}
    </Badge>
  )
}

function LabelBadge({ label }: { label: string }) {
  const colors: Record<string, string> = {
    plant: 'bg-gray-100 text-gray-700',
    healthy: 'bg-green-100 text-green-700',
    stressed: 'bg-amber-100 text-amber-700',
    dead: 'bg-red-100 text-red-700',
    weed: 'bg-purple-100 text-purple-700',
  }
  return (
    <Badge className={colors[label] || colors.plant}>
      {label}
    </Badge>
  )
}
