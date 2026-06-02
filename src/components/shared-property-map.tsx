'use client'

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Layers, X, Maximize2, RotateCcw, Leaf } from 'lucide-react'
import { Slider } from '@/components/ui/slider'

export type LayerType = 'rgb' | 'ndvi' | 'chm'

export interface ShareLayer {
  type: LayerType
  url?: string // signed COG URL (used for client-side rendering when the user adjusts the legend range)
  tilesUrl?: string // pre-rendered XYZ tile template (fast default path)
  bounds: { north: number; south: number; east: number; west: number }
  value_min?: number
  value_max?: number
  plant_count?: number // in-boundary plant count (RGB layer only); shown when RGB is active
}

export interface SharedPropertyData {
  title: string
  client_name?: string | null
  bounds: { north: number; south: number; east: number; west: number }
  layers: ShareLayer[]
}

const MAX_NATIVE_ZOOM = 22 // matches the gdal2tiles pyramid; Leaflet upscales beyond

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
  return { background: '#16a34a' }
}

function bakedRange(layer: ShareLayer): { min: number; max: number } {
  const meta = LAYER_META[layer.type]
  return {
    min: typeof layer.value_min === 'number' ? layer.value_min : meta.defaultMin,
    max: typeof layer.value_max === 'number' ? layer.value_max : meta.defaultMax,
  }
}

function fmtValue(layer: ShareLayer, v: number): string {
  const meta = LAYER_META[layer.type]
  const fixed = layer.type === 'ndvi' ? v.toFixed(2) : v.toFixed(1).replace(/\.0$/, '')
  return meta.unit ? `${fixed} ${meta.unit}` : fixed
}

export default function SharedPropertyMap({ data }: { data: SharedPropertyData }) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  // Tile layers (the fast default path) and lazily-built COG layers (used when
  // the user drags the legend slider away from the baked range).
  const tileLayersRef = useRef<Partial<Record<LayerType, L.Layer>>>({})
  const cogLayersRef = useRef<Partial<Record<LayerType, L.Layer>>>({})
  const parsedRastersRef = useRef<Partial<Record<LayerType, any>>>({})
  const cogRangeRef = useRef<Partial<Record<LayerType, { min: number; max: number }>>>({})

  const present = data.layers.map((l) => l.type)
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(data.layers.map((l) => [l.type, l.type === 'rgb']))
  )
  // null = use baked tile colors. Non-null = recolor live via client-side COG.
  const [customRange, setCustomRange] = useState<Record<string, { min: number; max: number } | null>>(() =>
    Object.fromEntries(data.layers.map((l) => [l.type, null]))
  )
  const [ready, setReady] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<Record<string, string>>({})
  const [cogLoading, setCogLoading] = useState<Record<string, boolean>>({})
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 640px)').matches
  )

  const resetView = () => {
    const map = mapRef.current
    if (!map) return
    const { north, south, east, west } = data.bounds
    map.fitBounds([[south, west], [north, east]])
  }

  // Initialize map and create the tile layer for any layer that has one.
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

    for (const layer of data.layers) {
      if (layer.tilesUrl) {
        const tileLayer = L.tileLayer(layer.tilesUrl, {
          opacity: 1,
          bounds: [
            [layer.bounds.south, layer.bounds.west],
            [layer.bounds.north, layer.bounds.east],
          ],
          maxNativeZoom: MAX_NATIVE_ZOOM,
          maxZoom: 24,
          zIndex: Z_INDEX[layer.type],
          crossOrigin: true,
        })
        tileLayersRef.current[layer.type] = tileLayer
        setReady((prev) => ({ ...prev, [layer.type]: true }))
      }
      // Non-tiled (legacy) layers get built as COGs by the sync effect below.
    }

    return () => {
      map.remove()
      mapRef.current = null
      tileLayersRef.current = {}
      cogLayersRef.current = {}
      parsedRastersRef.current = {}
      cogRangeRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync the map to current state: which layers are visible, and whether each
  // is rendered as tiles (fast default) or as a recolored COG (when the user
  // has dragged the legend slider).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false

    const buildOrUpdateCog = async (layer: ShareLayer, range: { min: number; max: number }) => {
      if (!layer.url) return // no archived COG — can't recolor live
      const type = layer.type

      // Already built with the same range? Just ensure it's on the map.
      const existing = cogLayersRef.current[type]
      const lastRange = cogRangeRef.current[type]
      if (existing && lastRange && lastRange.min === range.min && lastRange.max === range.max) {
        if (!map.hasLayer(existing)) existing.addTo(map)
        return
      }

      setCogLoading((p) => ({ ...p, [type]: true }))
      try {
        if (!parsedRastersRef.current[type]) {
          const parseGeoRaster = (await import('georaster')).default
          parsedRastersRef.current[type] = await parseGeoRaster(layer.url)
        }
        if (cancelled) return

        const GeoRasterLayer = (await import('georaster-layer-for-leaflet')).default
        const gr: any = parsedRastersRef.current[type]
        const noData = gr.noDataValue
        const meta = LAYER_META[type]
        const options: any = {
          georaster: gr,
          opacity: 1,
          resolution: 128,
          zIndex: Z_INDEX[type],
        }
        if (meta.ramp) {
          const span = range.max - range.min || 1
          options.pixelValuesToColorFn = (values: number[]) => {
            const v = values[0]
            if (v === null || v === undefined || Number.isNaN(v) || v === noData) return undefined
            const [r, g, b] = interpolateRamp(meta.ramp!, (v - range.min) / span)
            return `rgb(${r},${g},${b})`
          }
        } else if (gr.numberOfRasters >= 4) {
          options.pixelValuesToColorFn = (values: number[]) => {
            const [r, g, b, a] = values
            if (a === 0) return undefined
            return `rgb(${r},${g},${b})`
          }
        }

        const old = cogLayersRef.current[type]
        if (old && map.hasLayer(old)) map.removeLayer(old)
        const newLayer = new GeoRasterLayer(options)
        if (cancelled) return
        newLayer.addTo(map)
        cogLayersRef.current[type] = newLayer
        cogRangeRef.current[type] = { ...range }
      } catch (err) {
        console.error(`Failed to build COG layer for ${type}:`, err)
        setError((p) => ({ ...p, [type]: err instanceof Error ? err.message : 'Failed to recolor layer' }))
      } finally {
        if (!cancelled) setCogLoading((p) => ({ ...p, [type]: false }))
      }
    }

    for (const layer of data.layers) {
      const type = layer.type
      const tile = tileLayersRef.current[type]
      const cog = cogLayersRef.current[type]
      const isOn = !!visible[type]
      const customized = customRange[type]
      // Use the COG (client-side recolor) when the user has tweaked the range,
      // or when there is no tile pyramid at all (legacy non-tiled share).
      const useCog = isOn && (!!customized || !tile)

      if (!isOn) {
        if (tile && map.hasLayer(tile)) map.removeLayer(tile)
        if (cog && map.hasLayer(cog)) map.removeLayer(cog)
        continue
      }

      if (useCog) {
        if (tile && map.hasLayer(tile)) map.removeLayer(tile)
        const range = customized ?? bakedRange(layer)
        void buildOrUpdateCog(layer, range)
      } else {
        if (cog && map.hasLayer(cog)) map.removeLayer(cog)
        if (tile && !map.hasLayer(tile)) tile.addTo(map)
      }
    }

    return () => {
      cancelled = true
    }
  }, [visible, customRange, ready, data.layers])

  const allLoading = data.layers.length > 0 && Object.keys(ready).length < data.layers.filter((l) => l.tilesUrl).length

  // The plant count is tied to the RGB orthophoto, so it's only meaningful (and
  // only shown) while the RGB layer is the active one.
  const rgbLayer = data.layers.find((l) => l.type === 'rgb')
  const showCount = !!visible['rgb'] && typeof rgbLayer?.plant_count === 'number'

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />

      {showCount && (
        <div className="absolute top-3 left-3 z-[1000] rounded-lg bg-[#0f2e1d]/95 text-white shadow-lg px-3 py-2 flex items-center gap-2">
          <Leaf className="h-4 w-4 text-green-300 shrink-0" />
          <span className="text-sm font-semibold tabular-nums">{rgbLayer!.plant_count!.toLocaleString()}</span>
          <span className="text-xs text-green-200/80">plants counted</span>
        </div>
      )}

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
                    {error[layer.type] && (
                      <p className="text-xs text-red-600 pl-6 pt-1">Could not load this layer.</p>
                    )}
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

      {/* Reset view — above the Leaflet scale bar */}
      <button
        onClick={resetView}
        className="absolute bottom-9 left-3 z-[1000] rounded-md bg-white shadow p-1.5 text-gray-700 hover:text-gray-900 hover:shadow-md"
        title="Reset view to survey extent"
        aria-label="Reset view to survey extent"
      >
        <Maximize2 className="h-4 w-4" />
      </button>

      {/* Bottom-center legend + interactive range slider per visible ramp layer */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 max-w-[90vw]">
        {data.layers.map((layer) => {
          const meta = LAYER_META[layer.type]
          if (!meta.ramp || !visible[layer.type]) return null
          const baked = bakedRange(layer)
          const current = customRange[layer.type] ?? baked
          const isCustom = !!customRange[layer.type]
          const canLiveRecolor = !!layer.url // need an archived COG to recolor

          return (
            <div key={layer.type} className="rounded-lg bg-white/95 backdrop-blur-sm shadow px-3 py-2 w-[280px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">{meta.label}</span>
                <div className="flex items-center gap-1">
                  {cogLoading[layer.type] && <span className="text-[10px] text-gray-400">recoloring…</span>}
                  {isCustom && (
                    <button
                      onClick={() => setCustomRange((p) => ({ ...p, [layer.type]: null }))}
                      className="text-gray-400 hover:text-gray-700"
                      title="Reset to default range"
                      aria-label="Reset to default range"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-700 tabular-nums w-12 text-right">{fmtValue(layer, current.min)}</span>
                <div className="h-2 flex-1 rounded ring-1 ring-black/5" style={{ background: rampToGradient(meta.ramp) }} />
                <span className="text-[11px] text-gray-700 tabular-nums w-12">{fmtValue(layer, current.max)}</span>
              </div>

              {canLiveRecolor ? (
                <div className="pt-2 px-1">
                  {layer.type === 'ndvi' ? (
                    <Slider
                      min={-1}
                      max={1}
                      step={0.05}
                      minStepsBetweenThumbs={1}
                      value={[current.min, current.max]}
                      onValueChange={([min, max]) =>
                        setCustomRange((p) => ({ ...p, [layer.type]: { min, max } }))
                      }
                    />
                  ) : (
                    <Slider
                      min={0.5}
                      max={5}
                      step={0.25}
                      value={[current.max]}
                      onValueChange={([max]) =>
                        setCustomRange((p) => ({ ...p, [layer.type]: { min: 0, max } }))
                      }
                    />
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
