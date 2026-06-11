'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Layers, X, Maximize2, RotateCcw, Leaf, Pencil, Trash2, Check } from 'lucide-react'
import { Slider } from '@/components/ui/slider'

export type LayerType = 'rgb' | 'ndvi' | 'chm'

interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

// A viewer-drawn boundary plot, tagged via the Block/Size/Species annotation layers.
export interface SharePlot {
  id: string
  boundary: GeoJSONPolygon
  areaAcres?: number | null
  block?: number | null // block / bed / plot #
  size?: number | null // container size (gallons)
  species?: string | null
  readinessDate?: string | null // yyyy-mm-dd
}

// The three annotation layers the viewer can toggle on to draw + tag plots.
type AnnotKey = 'block' | 'size' | 'species'
const ANNOT_META: Record<AnnotKey, { label: string; hint: string }> = {
  block: { label: 'Block', hint: 'Block / bed / plot number' },
  size: { label: 'Size', hint: 'Container size (gallons)' },
  species: { label: 'Species', hint: 'Species name + readiness date' },
}

export interface ShareLayer {
  type: LayerType
  url?: string // signed COG URL (used for client-side rendering when the user adjusts the legend range)
  tilesUrl?: string // pre-rendered XYZ tile template (fast default path)
  bounds: { north: number; south: number; east: number; west: number }
  value_min?: number
  value_max?: number
  plant_count?: number // in-boundary plant count (RGB layer only); shown when RGB is active
  pointsUrl?: string // signed URL to points.json ([[lat,lng],...]); per-plant dots, RGB only
}

export interface ShareLocation {
  token: string
  title: string
  client_name?: string | null
}

export interface SharedPropertyData {
  title: string
  client_name?: string | null
  bounds: { north: number; south: number; east: number; west: number }
  layers: ShareLayer[]
  accessToken?: string // gates the plots API (draw/save boundary plots)
  locations?: ShareLocation[] // other locations this viewer's email can open
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

// Stable color from a string — used to color plots by block when that layer is on.
const PLOT_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
]
function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return PLOT_PALETTE[Math.abs(hash) % PLOT_PALETTE.length]
}

// Polygon area in acres (Shoelace with spherical correction).
function plotAreaAcres(latlngs: L.LatLng[]): number {
  if (latlngs.length < 3) return 0
  const earthRadius = 6371000
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
  return Math.round(area * 0.000247105 * 100) / 100
}

const DEFAULT_PLOT_COLOR = '#10b981'

// Color a plot by block (when the Block layer is on and a block is set), else green.
function plotColor(plot: SharePlot, annot: Record<AnnotKey, boolean>): string {
  if (annot.block && plot.block != null) return stringToColor(`block-${plot.block}`)
  return DEFAULT_PLOT_COLOR
}

function fmtReadiness(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// The label parts currently shown for a plot — one per annotation layer that is
// toggled on AND has a value. Block + size share a boundary (a block is one
// container size), so when both are on they read together, e.g.
// "Block 1 | 10-gallon". A plot's boundary is shown only when this is non-empty,
// so toggling a layer off hides the boundaries that depended on it.
function activePlotParts(plot: SharePlot, annot: Record<AnnotKey, boolean>): string[] {
  const parts: string[] = []
  if (annot.block && plot.block != null) {
    parts.push(`Block ${plot.block}`)
    // Size is a sub-layer of block — it only appears alongside it.
    if (annot.size && plot.size != null) parts.push(`${plot.size}-gallon`)
  }
  if (annot.species && plot.species) parts.push(plot.species)
  return parts
}

// Full popup HTML for a plot — every active toggle's field.
function plotPopupHtml(plot: SharePlot, annot: Record<AnnotKey, boolean>): string {
  const rows: string[] = []
  if (annot.block && plot.block != null) {
    rows.push(`<div><strong>Block:</strong> ${plot.block}</div>`)
    if (annot.size && plot.size != null) rows.push(`<div><strong>Size:</strong> ${plot.size}-gallon</div>`)
  }
  if (annot.species && plot.species) {
    rows.push(`<div><strong>Species:</strong> ${plot.species}</div>`)
    if (plot.readinessDate) rows.push(`<div><strong>Ready:</strong> ${fmtReadiness(plot.readinessDate)}</div>`)
  }
  if (plot.areaAcres != null) rows.push(`<div style="color:#6b7280;">${plot.areaAcres.toFixed(2)} acres</div>`)
  return `<div style="min-width:120px;font-size:12px;line-height:1.5;">${rows.join('') || '<em>Plot</em>'}</div>`
}

export default function SharedPropertyMap({
  data,
  token,
  viewerEmail,
}: {
  data: SharedPropertyData
  token: string
  viewerEmail?: string
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  // Tile layers (the fast default path) and lazily-built COG layers (used when
  // the user drags the legend slider away from the baked range).
  const tileLayersRef = useRef<Partial<Record<LayerType, L.Layer>>>({})
  const cogLayersRef = useRef<Partial<Record<LayerType, L.Layer>>>({})
  const parsedRastersRef = useRef<Partial<Record<LayerType, any>>>({})
  const cogRangeRef = useRef<Partial<Record<LayerType, { min: number; max: number }>>>({})

  // Per-plant dots: one canvas renderer + a layer group built once from the
  // fetched [lat,lng] list (kept performant at ~10k+ points via canvas).
  const pointsLayerRef = useRef<L.LayerGroup | null>(null)
  const pointsCanvasRef = useRef<L.Canvas | null>(null)
  const pointsDataRef = useRef<[number, number][] | null>(null)

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
  const [showPoints, setShowPoints] = useState(true)
  const [pointsLoading, setPointsLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 640px)').matches
  )

  // ---- Annotation layers (Block / Size / Species) + viewer-drawn plots ----
  const [annot, setAnnot] = useState<Record<AnnotKey, boolean>>({ block: false, size: false, species: false })
  // Size is a sub-layer of block, so it can't enable drawing on its own.
  const anyAnnot = annot.block || annot.species
  const [plots, setPlots] = useState<SharePlot[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  // Draft holds the just-finished polygon awaiting the tag form.
  const [draft, setDraft] = useState<{ boundary: GeoJSONPolygon; areaAcres: number } | null>(null)
  const [form, setForm] = useState({ block: '', size: '', species: '', readinessDate: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const plotsLayerRef = useRef<L.LayerGroup | null>(null)
  const drawPointsRef = useRef<L.LatLng[]>([])
  const drawMarkersRef = useRef<L.CircleMarker[]>([])
  const drawPolygonRef = useRef<L.Polygon | null>(null)
  const rubberBandRef = useRef<L.Polyline | null>(null)
  const closingLineRef = useRef<L.Polyline | null>(null)

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

    // Layer group that holds all saved viewer-drawn plots (redrawn by an effect).
    plotsLayerRef.current = L.layerGroup().addTo(map)

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
      pointsLayerRef.current = null
      pointsCanvasRef.current = null
      plotsLayerRef.current = null
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

  // The plant count is tied to the RGB orthophoto, so it's only meaningful (and
  // only shown) while the RGB layer is the active one.
  const rgbLayer = data.layers.find((l) => l.type === 'rgb')
  const showCount = !!visible['rgb'] && typeof rgbLayer?.plant_count === 'number'

  // Per-plant dots, tied to RGB visibility + the markers toggle. Fetch the
  // [lat,lng] list once, build the canvas marker group once, then just add/
  // remove it from the map as the toggles change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const wantPoints = !!visible['rgb'] && showPoints && !!rgbLayer?.pointsUrl
    let cancelled = false

    const ensure = async () => {
      if (!wantPoints) {
        const g = pointsLayerRef.current
        if (g && map.hasLayer(g)) map.removeLayer(g)
        return
      }
      if (pointsLayerRef.current) {
        if (!map.hasLayer(pointsLayerRef.current)) pointsLayerRef.current.addTo(map)
        return
      }
      setPointsLoading(true)
      try {
        if (!pointsDataRef.current) {
          const res = await fetch(rgbLayer!.pointsUrl!)
          pointsDataRef.current = await res.json()
        }
        if (cancelled) return
        if (!pointsCanvasRef.current) pointsCanvasRef.current = L.canvas({ padding: 0.5 })
        const renderer = pointsCanvasRef.current
        const group = L.layerGroup()
        for (const [lat, lng] of pointsDataRef.current!) {
          L.circleMarker([lat, lng], {
            renderer,
            radius: 3,
            fillColor: '#22c55e',
            fillOpacity: 1,
            color: '#ffffff',
            weight: 1,
            opacity: 1,
          }).addTo(group)
        }
        if (cancelled) return
        pointsLayerRef.current = group
        group.addTo(map)
      } catch (err) {
        console.error('Failed to load plant points:', err)
      } finally {
        if (!cancelled) setPointsLoading(false)
      }
    }

    void ensure()
    return () => {
      cancelled = true
    }
  }, [visible, showPoints, rgbLayer])

  // Load any previously-saved plots for this share once we have an access token.
  useEffect(() => {
    if (!data.accessToken) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/share/${token}/plots?k=${encodeURIComponent(data.accessToken!)}`)
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled && Array.isArray(body.plots)) setPlots(body.plots)
      } catch {
        // Non-fatal — the map still works without saved plots.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, data.accessToken])

  // Tear down an in-progress drawing: remove map handlers + temporary layers.
  const teardownDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const h = (map as any)._sharePlotDraw
    if (h) {
      map.off('click', h.handleClick)
      map.off('dblclick', h.handleDbl)
      map.off('contextmenu', h.handleCtx)
      map.off('mousemove', h.handleMove)
      ;(map as any)._sharePlotDraw = null
    }
    map.doubleClickZoom.enable()
    drawPolygonRef.current?.remove()
    drawPolygonRef.current = null
    rubberBandRef.current?.remove()
    rubberBandRef.current = null
    closingLineRef.current?.remove()
    closingLineRef.current = null
    drawMarkersRef.current.forEach((m) => m.remove())
    drawMarkersRef.current = []
  }, [])

  // Finish the polygon and open the tag form (if it has enough points).
  const finishDrawing = useCallback(() => {
    const points = drawPointsRef.current.slice()
    teardownDraw()
    drawPointsRef.current = []
    setIsDrawing(false)
    if (points.length < 3) return
    const ring = points.map((p) => [p.lng, p.lat])
    ring.push(ring[0]) // close the polygon
    setForm({ block: '', size: '', species: '', readinessDate: '' })
    setSaveError('')
    setDraft({ boundary: { type: 'Polygon', coordinates: [ring] }, areaAcres: plotAreaAcres(points) })
  }, [teardownDraw])

  const cancelDrawing = useCallback(() => {
    teardownDraw()
    drawPointsRef.current = []
    setIsDrawing(false)
  }, [teardownDraw])

  // Begin click-to-add-points drawing. Double-click or right-click finishes.
  const startDrawing = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    setDraft(null)
    setSaveError('')
    setIsDrawing(true)
    drawPointsRef.current = []
    drawMarkersRef.current.forEach((m) => m.remove())
    drawMarkersRef.current = []

    const handleClick = (e: L.LeafletMouseEvent) => {
      drawPointsRef.current.push(e.latlng)
      const marker = L.circleMarker(e.latlng, {
        radius: 5,
        fillColor: DEFAULT_PLOT_COLOR,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1,
      }).addTo(map)
      drawMarkersRef.current.push(marker)
      drawPolygonRef.current?.remove()
      if (drawPointsRef.current.length >= 2) {
        drawPolygonRef.current = L.polygon(drawPointsRef.current, {
          color: DEFAULT_PLOT_COLOR,
          weight: 2,
          fillColor: DEFAULT_PLOT_COLOR,
          fillOpacity: 0.1,
          dashArray: '5, 5',
        }).addTo(map)
      }
    }
    const handleDbl = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e.originalEvent)
      finishDrawing()
    }
    const handleCtx = (e: L.LeafletMouseEvent) => {
      L.DomEvent.preventDefault(e.originalEvent)
      finishDrawing()
    }
    const handleMove = (e: L.LeafletMouseEvent) => {
      const pts = drawPointsRef.current
      if (pts.length === 0) return
      rubberBandRef.current?.remove()
      rubberBandRef.current = L.polyline([pts[pts.length - 1], e.latlng], {
        color: DEFAULT_PLOT_COLOR,
        weight: 2,
        dashArray: '5, 10',
        opacity: 0.7,
      }).addTo(map)
      if (pts.length >= 2) {
        closingLineRef.current?.remove()
        closingLineRef.current = L.polyline([e.latlng, pts[0]], {
          color: DEFAULT_PLOT_COLOR,
          weight: 2,
          dashArray: '3, 6',
          opacity: 0.4,
        }).addTo(map)
      }
    }

    map.on('click', handleClick)
    map.on('dblclick', handleDbl)
    map.on('contextmenu', handleCtx)
    map.on('mousemove', handleMove)
    map.doubleClickZoom.disable()
    ;(map as any)._sharePlotDraw = { handleClick, handleDbl, handleCtx, handleMove }
  }, [finishDrawing])

  const discardDraft = () => {
    setDraft(null)
    setSaveError('')
  }

  const savePlot = useCallback(async () => {
    if (!draft || !data.accessToken) return
    // Block and its container size are captured together — both required.
    if (annot.block && (!form.block.trim() || !form.size.trim())) {
      setSaveError('Block and container size are both required.')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`/api/share/${token}/plots?k=${encodeURIComponent(data.accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boundary: draft.boundary,
          areaAcres: draft.areaAcres,
          // Size rides with block (its sub-layer), so it's sent whenever block is.
          block: annot.block ? form.block : undefined,
          size: annot.block ? form.size : undefined,
          species: annot.species ? form.species : undefined,
          readinessDate: annot.species ? form.readinessDate : undefined,
          email: viewerEmail,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body.error || 'Could not save plot.')
        return
      }
      setPlots((prev) => [...prev, body.plot])
      setDraft(null)
    } catch {
      setSaveError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [draft, data.accessToken, token, annot, form, viewerEmail])

  const deletePlot = useCallback(
    async (id: string) => {
      setPlots((prev) => prev.filter((p) => p.id !== id)) // optimistic
      if (!data.accessToken) return
      try {
        await fetch(
          `/api/share/${token}/plots?k=${encodeURIComponent(data.accessToken)}&id=${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        )
      } catch {
        // Optimistic removal stands; a reload will reconcile if it failed.
      }
    },
    [data.accessToken, token]
  )

  // Redraw saved plots whenever the set changes or an annotation toggle flips
  // (toggles change the color/label, so we rebuild the layer).
  useEffect(() => {
    const layer = plotsLayerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const plot of plots) {
      const ring = plot.boundary?.coordinates?.[0]
      if (!ring) continue
      // Only draw the boundary if at least one active layer applies to it, so
      // toggling Block/Size/Species off hides the boundaries that relied on it.
      const parts = activePlotParts(plot, annot)
      if (parts.length === 0) continue
      const coords = ring.map(([lng, lat]) => [lat, lng] as [number, number])
      const color = plotColor(plot, annot)
      const polygon = L.polygon(coords, { color, weight: 2, fillColor: color, fillOpacity: 0.2 })

      const popupEl = document.createElement('div')
      popupEl.innerHTML = plotPopupHtml(plot, annot)
      const del = document.createElement('button')
      del.textContent = 'Delete plot'
      del.style.cssText =
        'margin-top:6px;font-size:11px;color:#dc2626;background:none;border:none;cursor:pointer;padding:0;'
      del.onclick = () => {
        polygon.closePopup()
        deletePlot(plot.id)
      }
      popupEl.appendChild(del)
      polygon.bindPopup(popupEl)

      polygon.bindTooltip(parts.join(' | '), { permanent: true, direction: 'center', className: 'plnt-plot-label' })
      layer.addLayer(polygon)
    }
  }, [plots, annot, deletePlot])

  const allLoading = data.layers.length > 0 && Object.keys(ready).length < data.layers.filter((l) => l.tilesUrl).length

  return (
    <div className="relative h-full w-full">
      <style>{`
        .plnt-plot-label { background: transparent; border: none; box-shadow: none; padding: 0; color: #fff; font-weight: 600; font-size: 11px; text-shadow: 0 1px 2px rgba(0,0,0,0.9); white-space: nowrap; }
        .plnt-plot-label::before { display: none; }
      `}</style>
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Draw-plot control — appears once a Block/Size/Species layer is on */}
      {anyAnnot && !draft && (
        <div className="absolute bottom-3 left-14 z-[1000]">
          {!isDrawing ? (
            <button
              onClick={startDrawing}
              className="rounded-md bg-green-600 text-white shadow px-3 py-2 text-sm font-medium flex items-center gap-2 hover:bg-green-700"
            >
              <Pencil className="h-4 w-4" />
              Draw plot
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-white shadow px-3 py-2 text-xs text-gray-700">
                <span className="font-medium text-green-600">Drawing</span> — click to add points, double-click to
                finish
              </div>
              <button
                onClick={cancelDrawing}
                className="rounded-md bg-white shadow px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tag form — shown after a polygon is drawn */}
      {draft && (
        <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-xs rounded-lg bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">Tag this plot</span>
              <button onClick={discardDraft} className="text-gray-400 hover:text-gray-700" aria-label="Discard plot">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">
                Area: <span className="font-medium text-gray-700">{draft.areaAcres.toFixed(2)} acres</span>
              </p>
              {annot.block && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      {ANNOT_META.block.hint} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={form.block}
                      onChange={(e) => setForm((f) => ({ ...f, block: e.target.value }))}
                      placeholder="e.g. 12"
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      {ANNOT_META.size.hint} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={form.size}
                      onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                      placeholder="e.g. 5"
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </>
              )}
              {annot.species && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Species</label>
                    <input
                      type="text"
                      value={form.species}
                      onChange={(e) => setForm((f) => ({ ...f, species: e.target.value }))}
                      placeholder="e.g. Coast live oak"
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Readiness date</label>
                    <input
                      type="date"
                      value={form.readinessDate}
                      onChange={(e) => setForm((f) => ({ ...f, readinessDate: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </>
              )}
              {saveError && <p className="text-xs text-red-600">{saveError}</p>}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-gray-100">
              <button
                onClick={discardDraft}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={savePlot}
                disabled={saving}
                className="flex-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {saving ? (
                  'Saving…'
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    {layer.type === 'rgb' && layer.pointsUrl && isOn && (
                      <label className="flex items-center gap-2 cursor-pointer pl-6 pt-1.5">
                        <input
                          type="checkbox"
                          checked={showPoints}
                          onChange={(e) => setShowPoints(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e] shrink-0 ring-1 ring-white" />
                        <span className="text-xs text-gray-600 flex-1">
                          Plant markers{typeof layer.plant_count === 'number' ? ` (${layer.plant_count.toLocaleString()})` : ''}
                        </span>
                        {pointsLoading && <span className="text-[10px] text-gray-400">loading…</span>}
                      </label>
                    )}
                  </div>
                )
              })}

              {/* Plot data — draw + tag boundary plots */}
              <div className="mt-1 pt-1.5 border-t border-gray-100">
                <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Plot data
                </p>
                {/* Block, with Size nested beneath it (like RGB → Plant markers) */}
                <label className="flex items-center gap-2 cursor-pointer rounded p-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={annot.block}
                    onChange={(e) => setAnnot((p) => ({ ...p, block: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-800 flex-1">{ANNOT_META.block.label}</span>
                </label>
                {annot.block && (
                  <label className="flex items-center gap-2 cursor-pointer rounded p-1.5 pl-7 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={annot.size}
                      onChange={(e) => setAnnot((p) => ({ ...p, size: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <span className="text-xs text-gray-600 flex-1">{ANNOT_META.size.label}</span>
                  </label>
                )}
                {/* Species */}
                <label className="flex items-center gap-2 cursor-pointer rounded p-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={annot.species}
                    onChange={(e) => setAnnot((p) => ({ ...p, species: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-800 flex-1">{ANNOT_META.species.label}</span>
                </label>
                <p className="px-1.5 pt-0.5 text-[11px] text-gray-400">
                  {anyAnnot ? 'Use “Draw plot” to add a boundary.' : 'Turn one on to draw boundary plots.'}
                </p>
              </div>
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
