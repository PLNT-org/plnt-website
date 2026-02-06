'use client'

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon issue with Leaflet + Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface CanopyHeightMapProps {
  orthomosaic: {
    id: string
    bounds: { north: number; south: number; east: number; west: number }
    webodm_project_id?: string
    webodm_task_id?: string
  }
  colorScale: 'viridis' | 'terrain' | 'rdylgn'
  isDemo?: boolean
}

// Color gradients for different scales
const COLOR_GRADIENTS = {
  viridis: 'linear-gradient(to top, #440154, #3b528b, #21918c, #5ec962, #fde725)',
  terrain: 'linear-gradient(to top, #1a5d1a, #4a7f4a, #8fbc8f, #deb887, #8b4513)',
  rdylgn: 'linear-gradient(to top, #006837, #a6d96a, #ffffbf, #fdae61, #a50026)',
}

export default function CanopyHeightMap({
  orthomosaic,
  colorScale,
  isDemo = false,
}: CanopyHeightMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const chmLayerRef = useRef<L.TileLayer | L.ImageOverlay | null>(null)
  const [showCHM, setShowCHM] = useState(true)
  const [opacity, setOpacity] = useState(0.7)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const { north, south, east, west } = orthomosaic.bounds
    const center: [number, number] = [(north + south) / 2, (east + west) / 2]
    const bounds: L.LatLngBoundsExpression = [[south, west], [north, east]]

    // Initialize map
    const map = L.map(mapContainerRef.current, {
      center,
      zoom: 18,
      maxZoom: 24,
      minZoom: 10,
    })

    // Add satellite base layer
    L.tileLayer(
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      {
        attribution: 'Imagery &copy; Google',
        maxZoom: 24,
      }
    ).addTo(map)

    // Add CHM layer
    if (isDemo) {
      // For demo, create a gradient overlay to simulate CHM
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Create a simulated height map gradient
        const gradient = ctx.createLinearGradient(0, 0, 256, 256)
        if (colorScale === 'viridis') {
          gradient.addColorStop(0, '#440154')
          gradient.addColorStop(0.25, '#3b528b')
          gradient.addColorStop(0.5, '#21918c')
          gradient.addColorStop(0.75, '#5ec962')
          gradient.addColorStop(1, '#fde725')
        } else if (colorScale === 'terrain') {
          gradient.addColorStop(0, '#1a5d1a')
          gradient.addColorStop(0.5, '#8fbc8f')
          gradient.addColorStop(1, '#8b4513')
        } else {
          gradient.addColorStop(0, '#006837')
          gradient.addColorStop(0.5, '#ffffbf')
          gradient.addColorStop(1, '#a50026')
        }
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 256, 256)

        // Add some noise/variation to make it look more realistic
        const imageData = ctx.getImageData(0, 0, 256, 256)
        for (let i = 0; i < imageData.data.length; i += 4) {
          const noise = (Math.random() - 0.5) * 30
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise))
          imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + noise))
          imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + noise))
        }
        ctx.putImageData(imageData, 0, 0)
      }

      const imageOverlay = L.imageOverlay(canvas.toDataURL(), bounds, {
        opacity: opacity,
      })
      imageOverlay.addTo(map)
      chmLayerRef.current = imageOverlay
    } else if (orthomosaic.webodm_project_id && orthomosaic.webodm_task_id) {
      // DSM tiles via server-side proxy
      const dsmTilesUrl = `/api/orthomosaic/dsm-tiles/${orthomosaic.webodm_project_id}/${orthomosaic.webodm_task_id}/{z}/{x}/{y}`

      const tileLayer = L.tileLayer(dsmTilesUrl, {
        maxZoom: 24,
        minZoom: 15,
        opacity: opacity,
        bounds: bounds,
      })
      tileLayer.addTo(map)
      chmLayerRef.current = tileLayer
    }

    // Fit to bounds
    map.fitBounds(bounds)

    // Add scale control
    L.control.scale({ position: 'bottomleft' }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [orthomosaic, isDemo])

  // Update layer when color scale changes (for demo)
  useEffect(() => {
    if (isDemo && mapRef.current && chmLayerRef.current) {
      // Remove old layer
      mapRef.current.removeLayer(chmLayerRef.current)

      // Create new gradient with updated color scale
      const { north, south, east, west } = orthomosaic.bounds
      const bounds: L.LatLngBoundsExpression = [[south, west], [north, east]]

      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const gradient = ctx.createLinearGradient(0, 0, 256, 256)
        if (colorScale === 'viridis') {
          gradient.addColorStop(0, '#440154')
          gradient.addColorStop(0.25, '#3b528b')
          gradient.addColorStop(0.5, '#21918c')
          gradient.addColorStop(0.75, '#5ec962')
          gradient.addColorStop(1, '#fde725')
        } else if (colorScale === 'terrain') {
          gradient.addColorStop(0, '#1a5d1a')
          gradient.addColorStop(0.5, '#8fbc8f')
          gradient.addColorStop(1, '#8b4513')
        } else {
          gradient.addColorStop(0, '#006837')
          gradient.addColorStop(0.5, '#ffffbf')
          gradient.addColorStop(1, '#a50026')
        }
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 256, 256)

        // Add noise
        const imageData = ctx.getImageData(0, 0, 256, 256)
        for (let i = 0; i < imageData.data.length; i += 4) {
          const noise = (Math.random() - 0.5) * 30
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise))
          imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + noise))
          imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + noise))
        }
        ctx.putImageData(imageData, 0, 0)
      }

      const imageOverlay = L.imageOverlay(canvas.toDataURL(), bounds, {
        opacity: opacity,
      })
      imageOverlay.addTo(mapRef.current)
      chmLayerRef.current = imageOverlay
    }
  }, [colorScale, isDemo, orthomosaic.bounds, opacity])

  // Update opacity
  useEffect(() => {
    if (chmLayerRef.current) {
      chmLayerRef.current.setOpacity(showCHM ? opacity : 0)
    }
  }, [opacity, showCHM])

  return (
    <div className="relative">
      <div ref={mapContainerRef} className="h-[500px] w-full rounded-b-lg" />

      {/* Layer Controls */}
      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-3 z-[1000]">
        <div className="text-sm font-medium mb-3">Layers</div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCHM}
              onChange={(e) => setShowCHM(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm">Canopy Height</span>
          </label>
          <div className="space-y-1">
            <label className="text-xs text-gray-600">Opacity</label>
            <input
              type="range"
              min="0"
              max="100"
              value={opacity * 100}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Color Scale Legend */}
      <div className="absolute bottom-8 right-4 bg-white rounded-lg shadow-lg p-3 z-[1000]">
        <div className="text-sm font-medium mb-2">Height (m)</div>
        <div className="flex gap-2">
          <div
            className="w-4 h-24 rounded"
            style={{ background: COLOR_GRADIENTS[colorScale] }}
          />
          <div className="flex flex-col justify-between text-xs text-gray-600">
            <span>5+</span>
            <span>2.5</span>
            <span>0</span>
          </div>
        </div>
      </div>

      {/* Info Badge */}
      {isDemo && (
        <div className="absolute top-4 left-4 bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded z-[1000]">
          Demo visualization
        </div>
      )}
    </div>
  )
}
