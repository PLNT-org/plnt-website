'use client'

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Layers, X, Maximize2 } from 'lucide-react'

export type LayerType = 'rgb' | 'ndvi' | 'chm'

export interface ShareLayer {
  type: LayerType
  url?: string // signed COG URL (client-rendered fallback)
  tilesUrl?: string // pre-rendered XYZ tile template (fast path)
  bounds: { north: number; south: number; east: number; west: number }
  value_min?: number
  value_max?: number
}

const MAX_NATIVE_ZOOM = 22 // matches the gdal2tiles pyramid; Leaflet upscales beyond this

export interface SharedPropertyData {
  title: string
  client_name?: string | null
  bounds: { north: number; south: number; east: number; west: number }
  layers: ShareLayer[]
}

// ColorBrewer RdYlGn (red = low/stressed, green = high/healthy) for NDVI.
const RDYLGN: number[][] = [
  [165, 0, 38], [215, 48, 39], [244, 109, 67], [253, 174, 97], [254, 224, 139],
  [255, 255, 191], [217, 239, 139], [166, 217, 106], [102, 189, 99], [26, 152, 80], [0, 104, 55],
]
// Green -> tan -> brown for canopy height.
const TERRAIN: number[][] = [
  [26, 93, 26], [74, 127, 74], [143, 188, 143], [222, 184, 135], [139, 69, 19],
]

const LAYER_META: Record<LayerType, { label: string; ramp?: number[][]; unit?: string; defaultMin: number; defaultMax: number }> = {
  rgb: { label: 'RGB Orthophoto', defaultMin: 0, defaultMax: 0 },
  ndvi: { label: 'NDVI · Plant Health', ramp: RDYLGN, defaultMin: -0.1, defaultMax: 0.9 },
  chm: { label: 'Canopy Height', ramp: TERRAIN, unit: 'm', defaultMin: 0, defaultMax: 5 },
}

const Z_INDEX: Record<LayerType, number> = { rgb: 400, ndvi: 410, chm: 420 }

function interpolateRamp(stops: number[][], t: number): [number, number, number] {
  const tt = Math.max(0, Math.min(1, t))
  const n = stops.length - 1
  const idx = tt * n
  const i = Math.floor(idx)
  const f = idx - i
  const a = stops[i]
  const b = stops[Math.min(i + 1, n)]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

function rampToGradient(stops: number[][], direction = 'to right'): string {
  const parts = stops.map((c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${Math.round((i / (stops.length - 1)) * 100)}%`)
  return `linear-gradient(${direction}, ${parts.join(', ')})`
}

function swatchStyle(layerType: LayerType) {
  const meta = LAYER_META[layerType]
  if (meta.ramp) return { background: rampToGradient(meta.ramp, 'to right') }
  return { background: '#16a34a' } // RGB swatch — PLNT green
}

function rangeFor(layer: ShareLayer): { min: number; max: number } {
  const meta = LAYER_META[layer.type]
  return {
    min: typeof layer.value_min === 'number' ? layer.value_min : meta.defaultMin,
    max: typeof layer.value_max === 'number' ? layer.value_max : meta.defaultMax,
  }
}

export default function SharedPropertyMap({ data }: { data: SharedPropertyData }) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<Partial<Record<LayerType, L.Layer>>>({})

  const present = data.layers.map((l) => l.type)
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(data.layers.map((l) => [l.type, l.type === 'rgb']))
  )
  const [opacity, setOpacity] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.layers.map((l) => [l.type, l.type === 'rgb' ? 1 : 0.85]))
  )
  const [ready, setReady] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<Record<string, string>>({})
  // Default the layer panel closed on small screens so the map gets full real estate.
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 640px)').matches
  )

  const resetView = () => {
    const map = mapRef.current
    if (!map) return
    const { north, south, east, west } = data.bounds
    map.fitBounds([[south, west], [north, east]])
  }

  // Initialize map + load each COG layer once.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const { north, south, east, west } = data.bounds
    const map = L.map(mapContainerRef.current, {
      center: [(north + south) / 2, (east + west) / 2],
      zoom: 18,
      maxZoom: 24,
      minZoom: 5,
    })

    L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: 'Imagery &copy; Google',
      maxZoom: 24,
    }).addTo(map)

    map.fitBounds([[south, west], [north, east]])
    L.control.scale({ position: 'bottomleft' }).addTo(map)
    mapRef.current = map

    const initialVisible = { ...visible }
    const initialOpacity = { ...opacity }

    const loadLayer = async (layer: ShareLayer) => {
      try {
        // Fast path: pre-rendered XYZ tiles (no reprojection / per-pixel work,
        // alpha handled by the PNGs so nodata edges are transparent).
        if (layer.tilesUrl) {
          const { north, south, east, west } = layer.bounds
          const tileLayer = L.tileLayer(layer.tilesUrl, {
            opacity: initialOpacity[layer.type] ?? 1,
            bounds: [[south, west], [north, east]],
            maxNativeZoom: MAX_NATIVE_ZOOM,
            maxZoom: 24,
            zIndex: Z_INDEX[layer.type],
            crossOrigin: true,
          })
          layersRef.current[layer.type] = tileLayer
          if (initialVisible[layer.type] && mapRef.current) tileLayer.addTo(mapRef.current)
          setReady((prev) => ({ ...prev, [layer.type]: true }))
          return
        }

        const parseGeoRaster = (await import('georaster')).default
        const GeoRasterLayer = (await import('georaster-layer-for-leaflet')).default
        const georaster: any = await parseGeoRaster(layer.url)
        const noData = georaster.noDataValue

        const options: any = {
          georaster,
          opacity: initialOpacity[layer.type] ?? 1,
          resolution: 128,
          zIndex: Z_INDEX[layer.type],
        }

        const meta = LAYER_META[layer.type]
        if (meta.ramp) {
          const { min, max } = rangeFor(layer)
          const span = max - min || 1
          options.pixelValuesToColorFn = (values: number[]) => {
            const v = values[0]
            if (v === null || v === undefined || Number.isNaN(v) || v === noData) return undefined
            const [r, g, b] = interpolateRamp(meta.ramp!, (v - min) / span)
            return `rgb(${r},${g},${b})`
          }
        } else if (georaster.numberOfRasters >= 4) {
          // RGBA COG: treat the 4th band as alpha so nodata edges aren't black.
          options.pixelValuesToColorFn = (values: number[]) => {
            const [r, g, b, a] = values
            if (a === 0) return undefined
            return `rgb(${r},${g},${b})`
          }
        }

        const cogLayer = new GeoRasterLayer(options)
        layersRef.current[layer.type] = cogLayer
        if (initialVisible[layer.type] && mapRef.current) {
          cogLayer.addTo(mapRef.current)
        }
        setReady((prev) => ({ ...prev, [layer.type]: true }))
      } catch (err) {
        console.error(`Failed to load ${layer.type} layer:`, err)
        setError((prev) => ({
          ...prev,
          [layer.type]: err instanceof Error ? err.message : 'Failed to load layer',
        }))
        setReady((prev) => ({ ...prev, [layer.type]: true }))
      }
    }

    data.layers.forEach(loadLayer)

    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toggle layer visibility.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const type of present) {
      const layer = layersRef.current[type]
      if (!layer) continue
      const shouldShow = visible[type]
      if (shouldShow && !map.hasLayer(layer)) layer.addTo(map)
      else if (!shouldShow && map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [visible, ready, present])

  // Update opacity.
  useEffect(() => {
    for (const type of present) {
      const layer = layersRef.current[type] as any
      if (layer && typeof layer.setOpacity === 'function') {
        layer.setOpacity(opacity[type])
      }
    }
  }, [opacity, ready, present])

  const allLoading = data.layers.length > 0 && Object.keys(ready).length < data.layers.length

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />

      {allLoading && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 rounded-full px-4 py-1.5 text-sm text-gray-700 shadow">
          Loading layers…
        </div>
      )}

      {/* Layer controls — collapsible */}
      <div className="absolute top-3 right-3 z-[1000]">
        {panelOpen ? (
          <div className="w-56 rounded-lg bg-white shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">Layers</span>
              <button
                onClick={() => setPanelOpen(false)}
                className="text-gray-400 hover:text-gray-700"
                title="Hide layers"
                aria-label="Hide layers"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-1.5 max-h-[60vh] overflow-y-auto">
              {data.layers.map((layer) => {
                const meta = LAYER_META[layer.type]
                const isOn = !!visible[layer.type]
                return (
                  <div key={layer.type} className="rounded p-1.5 hover:bg-gray-50">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={(e) => setVisible((p) => ({ ...p, [layer.type]: e.target.checked }))}
                        className="rounded border-gray-300"
                      />
                      <span className="h-3 w-3 rounded-sm shrink-0 ring-1 ring-black/10" style={swatchStyle(layer.type)} />
                      <span className="text-sm text-gray-800 flex-1 truncate">{meta.label}</span>
                    </label>
                    {error[layer.type] ? (
                      <p className="text-xs text-red-600 pl-6 pt-1">Could not load this layer.</p>
                    ) : isOn ? (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={(opacity[layer.type] ?? 1) * 100}
                        onChange={(e) => setOpacity((p) => ({ ...p, [layer.type]: Number(e.target.value) / 100 }))}
                        className="w-full h-1.5 mt-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        title="Opacity"
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setPanelOpen(true)}
            className="rounded-lg bg-white shadow-lg px-3 py-2 flex items-center gap-2 text-sm text-gray-900 hover:shadow-md"
            title="Show layers"
            aria-label="Show layers"
          >
            <Layers className="h-4 w-4" />
            Layers
          </button>
        )}
      </div>

      {/* Reset view (above the Leaflet scale bar at bottom-left) */}
      <button
        onClick={resetView}
        className="absolute bottom-9 left-3 z-[1000] rounded-md bg-white shadow p-1.5 text-gray-700 hover:text-gray-900 hover:shadow-md"
        title="Reset view to survey extent"
        aria-label="Reset view to survey extent"
      >
        <Maximize2 className="h-4 w-4" />
      </button>

      {/* Bottom-center legends — one per visible color-ramp layer */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 pointer-events-none max-w-[90vw]">
        {data.layers.map((layer) => {
          const meta = LAYER_META[layer.type]
          if (!meta.ramp || !visible[layer.type]) return null
          const { min, max } = rangeFor(layer)
          const fmt = (v: number) => `${layer.type === 'ndvi' ? v.toFixed(2) : v}${meta.unit ? ` ${meta.unit}` : ''}`
          return (
            <div key={layer.type} className="rounded-lg bg-white/95 backdrop-blur-sm shadow px-3 py-1.5 pointer-events-auto">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5 text-center">{meta.label}</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-700 tabular-nums">{fmt(min)}</span>
                <div className="h-2 w-40 rounded ring-1 ring-black/5" style={{ background: rampToGradient(meta.ramp) }} />
                <span className="text-[11px] text-gray-700 tabular-nums">{fmt(max)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
