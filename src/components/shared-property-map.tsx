'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Layers, X, Maximize2, Minimize2, RotateCcw, Leaf, Pencil, Trash2, Check, ChevronUp, Table2, Download } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { SPECIES_LIST } from '@/lib/species-list'

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
  maxNativeZoom?: number // deepest zoom this layer has tiles for (default 22)
}

export interface ShareLocation {
  token: string
  title: string
  client_name?: string | null
  flights?: { key: string; date: string | null; label?: string | null }[] // this parcel's dropdown entries
}

export interface ShareFlight {
  key: string
  date: string | null // YYYY-MM-DD
  label?: string | null // shown in the dropdown instead of the date when set
  bounds: { north: number; south: number; east: number; west: number }
  layers: ShareLayer[]
}

export interface SharedPropertyData {
  title: string
  client_name?: string | null
  bounds: { north: number; south: number; east: number; west: number }
  layers: ShareLayer[]
  accessToken?: string // gates the plots API (draw/save boundary plots)
  locations?: ShareLocation[] // other locations this viewer's email can open
  flights?: ShareFlight[] // dated orthophoto sets for this parcel (newest first)
}

const MAX_NATIVE_ZOOM = 22 // matches the gdal2tiles pyramid; Leaflet upscales beyond

// A viewer's manual correction to the plant count on a gated share.
type PointEdit = { id: string; kind: 'add' | 'remove'; lat: number; lng: number }
// Round to 6 decimals to match points.json, so a 'remove' keys to the exact dot.
const ptKey = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`

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

// Ray-casting point-in-polygon. `ring` is [[lng,lat], ...]; point is (lng, lat).
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Average vertex of a ring [[lng,lat], ...] -> [lng, lat]. Used to find which
// block a species plot sits inside.
function ringCentroid(ring: number[][]): [number, number] {
  let sx = 0
  let sy = 0
  for (const [x, y] of ring) {
    sx += x
    sy += y
  }
  return [sx / ring.length, sy / ring.length]
}

const DEFAULT_PLOT_COLOR = '#10b981'

// A few muted colors cycled across plots so neighbours are easy to tell apart
// without being garish.
const PLOT_PALETTE4 = ['#3f7d5a', '#3f6f9e', '#b1894d', '#7d5e88']

// Escape text for safe insertion into the tooltip's innerHTML.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Color a plot by block when the Block layer is on; otherwise by size when
// viewing sizes alone; else cycle the muted 4-color palette by render index.
function plotColor(plot: SharePlot, annot: Record<AnnotKey, boolean>, idx: number): string {
  if (annot.block && plot.block != null) return stringToColor(`block-${plot.block}`)
  if (annot.size && plot.size != null) return stringToColor(`size-${plot.size}`)
  return PLOT_PALETTE4[idx % PLOT_PALETTE4.length]
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
  // Block and size are captured together at draw time but display independently,
  // so you can view just sizes (block off) or just block numbers (size off).
  if (annot.block && plot.block != null) parts.push(`Block ${plot.block}`)
  if (annot.size && plot.size != null) parts.push(`${plot.size}-Gallon`)
  if (annot.species && plot.species) parts.push(plot.species)
  return parts
}

// Full popup HTML for a plot — every active toggle's field.
function plotPopupHtml(plot: SharePlot, annot: Record<AnnotKey, boolean>): string {
  const rows: string[] = []
  if (annot.block && plot.block != null) rows.push(`<div><strong>Block:</strong> ${plot.block}</div>`)
  if (annot.size && plot.size != null) rows.push(`<div><strong>Size:</strong> ${plot.size}-Gallon</div>`)
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
  flightKey,
}: {
  data: SharedPropertyData
  token: string
  viewerEmail?: string
  flightKey?: string
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

  // ---- Viewer count corrections (add missed / remove double-counted plants) ----
  const [pointEdits, setPointEdits] = useState<PointEdit[]>([])
  const [editingCount, setEditingCount] = useState(false)
  const [savingPoint, setSavingPoint] = useState(false)
  // Refs so the long-lived map/marker click handlers always see current values
  // without being torn down and rebuilt on every edit.
  const editingCountRef = useRef(false)
  const skipNextMapClickRef = useRef(false)
  const addPointRef = useRef<(latlng: L.LatLng) => void>(() => {})
  const deletePointRef = useRef<(pt: { lat: number; lng: number; addId?: string }) => void>(() => {})
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 640px)').matches
  )

  // ---- Annotation layers (Block / Size / Species) + viewer-drawn plots ----
  const [annot, setAnnot] = useState<Record<AnnotKey, boolean>>({ block: false, size: false, species: false })
  // Size is a sub-layer of block, so it can't enable drawing on its own.
  const anyAnnot = annot.block || annot.species
  const [plots, setPlots] = useState<SharePlot[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  // Which layer's Draw button started this drawing — decides the tag form's fields.
  const [drawMode, setDrawMode] = useState<'block' | 'species' | null>(null)
  // Draft holds the just-finished polygon awaiting the tag form.
  const [draft, setDraft] = useState<{ boundary: GeoJSONPolygon; areaAcres: number } | null>(null)
  // The saved plot currently being edited (fields only — boundary untouched).
  const [editing, setEditing] = useState<SharePlot | null>(null)
  const [form, setForm] = useState({ block: '', size: '', species: '', readinessDate: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const plotsLayerRef = useRef<L.LayerGroup | null>(null)
  const drawPointsRef = useRef<L.LatLng[]>([])
  const drawMarkersRef = useRef<L.CircleMarker[]>([])
  const drawPolygonRef = useRef<L.Polygon | null>(null)
  const rubberBandRef = useRef<L.Polyline | null>(null)
  const closingLineRef = useRef<L.Polyline | null>(null)

  // ---- Inventory drawer (bottom sheet over the map) ----
  const rootRef = useRef<HTMLDivElement>(null)
  const [invOpen, setInvOpen] = useState(false)
  const [invFrac, setInvFrac] = useState(0.5) // share of the map height the sheet takes
  const [invCounts, setInvCounts] = useState<Record<string, number> | null>(null)
  const [invCounting, setInvCounting] = useState(false)

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
          maxNativeZoom: layer.maxNativeZoom ?? MAX_NATIVE_ZOOM,
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
  // Displayed count = the baked detection count, plus viewer corrections. A
  // 'remove' only ever hides a real detected dot, so this stays accurate even
  // before points.json loads (no need to diff the full array).
  const baseCount = rgbLayer?.plant_count ?? pointsDataRef.current?.length ?? 0
  const addCount = pointEdits.reduce((n, e) => n + (e.kind === 'add' ? 1 : 0), 0)
  const removeCount = pointEdits.reduce((n, e) => n + (e.kind === 'remove' ? 1 : 0), 0)
  const effectiveCount = baseCount + addCount - removeCount
  const hasEdits = pointEdits.length > 0
  const canEditCount = !!rgbLayer?.pointsUrl && !!data.accessToken
  const showCount = !!visible['rgb'] && (typeof rgbLayer?.plant_count === 'number' || hasEdits)

  // Per-plant dots, tied to RGB visibility + the markers toggle. Fetch the
  // [lat,lng] list once, build the canvas marker group once, then just add/
  // remove it from the map as the toggles change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const wantPoints = !!visible['rgb'] && showPoints && !!rgbLayer?.pointsUrl
    let cancelled = false

    // Merge viewer edits over the detected dots: drop removed ones, add new ones.
    const removedKeys = new Set(
      pointEdits.filter((e) => e.kind === 'remove').map((e) => ptKey(e.lat, e.lng))
    )
    const adds = pointEdits.filter((e) => e.kind === 'add')

    const ensure = async () => {
      const prev = pointsLayerRef.current
      if (!wantPoints) {
        if (prev && map.hasLayer(prev)) map.removeLayer(prev)
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
        // In edit mode a dot is a click target (removes it); the handler reads
        // refs so we never rebuild the group just to toggle edit mode on/off.
        const onDotClick = (pt: { lat: number; lng: number; addId?: string }) => () => {
          if (!editingCountRef.current) return
          // Leaflet fires this marker click before the map click; flag it so the
          // same click doesn't also drop a new point (see the map-click handler).
          skipNextMapClickRef.current = true
          deletePointRef.current(pt)
        }
        const addDot = (lat: number, lng: number, addId?: string) => {
          const m = L.circleMarker([lat, lng], {
            renderer,
            radius: 3,
            fillColor: addId ? '#f59e0b' : '#22c55e', // viewer-added = amber, detected = green
            fillOpacity: 1,
            color: '#ffffff',
            weight: 1,
            opacity: 1,
          })
          m.on('click', onDotClick({ lat, lng, addId }))
          m.addTo(group)
        }
        for (const [lat, lng] of pointsDataRef.current!) {
          if (removedKeys.has(ptKey(lat, lng))) continue
          addDot(lat, lng)
        }
        for (const a of adds) addDot(a.lat, a.lng, a.id)
        if (cancelled) return
        if (prev && map.hasLayer(prev)) map.removeLayer(prev)
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
  }, [visible, showPoints, rgbLayer, pointEdits])

  // ---- Count-correction handlers ----
  // Add a plant the model missed at the clicked location.
  const addPoint = useCallback(
    async (latlng: L.LatLng) => {
      if (!data.accessToken || savingPoint) return
      const lat = Math.round(latlng.lat * 1e6) / 1e6
      const lng = Math.round(latlng.lng * 1e6) / 1e6
      setSavingPoint(true)
      try {
        const res = await fetch(`/api/share/${token}/points?k=${encodeURIComponent(data.accessToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flightKey: flightKey ?? '', kind: 'add', lat, lng, email: viewerEmail }),
        })
        const body = await res.json()
        if (res.ok && body.edit) {
          setPointEdits((p) => (p.some((e) => e.id === body.edit.id) ? p : [...p, body.edit]))
        }
      } catch {
        /* leave the count as-is on failure */
      } finally {
        setSavingPoint(false)
      }
    },
    [data.accessToken, token, flightKey, viewerEmail, savingPoint]
  )

  // Remove a dot: undo a prior add (delete its edit), or hide a detected dot
  // (record a 'remove' correction).
  const deletePoint = useCallback(
    async (pt: { lat: number; lng: number; addId?: string }) => {
      if (!data.accessToken) return
      setSavingPoint(true)
      try {
        if (pt.addId) {
          const res = await fetch(
            `/api/share/${token}/points?k=${encodeURIComponent(data.accessToken)}&id=${encodeURIComponent(pt.addId)}`,
            { method: 'DELETE' }
          )
          if (res.ok) setPointEdits((p) => p.filter((e) => e.id !== pt.addId))
        } else {
          const res = await fetch(`/api/share/${token}/points?k=${encodeURIComponent(data.accessToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flightKey: flightKey ?? '', kind: 'remove', lat: pt.lat, lng: pt.lng, email: viewerEmail }),
          })
          const body = await res.json()
          if (res.ok && body.edit) {
            setPointEdits((p) => (p.some((e) => e.id === body.edit.id) ? p : [...p, body.edit]))
          }
        }
      } catch {
        /* leave the count as-is on failure */
      } finally {
        setSavingPoint(false)
      }
    },
    [data.accessToken, token, flightKey, viewerEmail]
  )

  // Clear every correction on this flight, back to the raw detection count.
  const resetPointEdits = useCallback(async () => {
    if (!data.accessToken || pointEdits.length === 0) return
    setSavingPoint(true)
    try {
      const res = await fetch(
        `/api/share/${token}/points?k=${encodeURIComponent(data.accessToken)}&flight=${encodeURIComponent(flightKey ?? '')}&all=1`,
        { method: 'DELETE' }
      )
      if (res.ok) setPointEdits([])
    } catch {
      /* ignore */
    } finally {
      setSavingPoint(false)
    }
  }, [data.accessToken, token, flightKey, pointEdits.length])

  // Keep the handler refs + mode flag current for the map/marker listeners.
  useEffect(() => {
    addPointRef.current = addPoint
  }, [addPoint])
  useEffect(() => {
    deletePointRef.current = deletePoint
  }, [deletePoint])
  useEffect(() => {
    editingCountRef.current = editingCount
  }, [editingCount])

  // Load this flight's saved corrections once we have an access token.
  useEffect(() => {
    if (!data.accessToken) {
      setPointEdits([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/share/${token}/points?k=${encodeURIComponent(data.accessToken!)}&flight=${encodeURIComponent(flightKey ?? '')}`
        )
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled && Array.isArray(body.edits)) setPointEdits(body.edits)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data.accessToken, token, flightKey])

  // While editing, a map click (not on a dot) adds a plant there.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !editingCount) return
    const onClick = (e: L.LeafletMouseEvent) => {
      if (skipNextMapClickRef.current) {
        skipNextMapClickRef.current = false
        return
      }
      addPointRef.current(e.latlng)
    }
    map.on('click', onClick)
    const el = map.getContainer()
    el.style.cursor = 'crosshair'
    return () => {
      map.off('click', onClick)
      el.style.cursor = ''
    }
  }, [editingCount])

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

  // Enter/exit count-correction mode. Defined here (after cancelDrawing) so the
  // two modes can cleanly exclude each other.
  const startEditCount = useCallback(() => {
    if (isDrawing) cancelDrawing() // count editing and plot drawing are mutually exclusive
    setVisible((p) => ({ ...p, rgb: true }))
    setShowPoints(true) // you need the dots visible to remove them
    setEditingCount(true)
  }, [isDrawing, cancelDrawing])
  const stopEditCount = useCallback(() => setEditingCount(false), [])

  // Begin click-to-add-points drawing in a given layer's mode. The mode decides
  // which fields the tag form collects (block+size vs species+readiness).
  const startDrawing = useCallback((mode: 'block' | 'species') => {
    const map = mapRef.current
    if (!map) return
    setEditingCount(false) // count editing and plot drawing are mutually exclusive
    setDrawMode(mode)
    setDraft(null)
    setSaveError('')
    setIsDrawing(true)
    drawPointsRef.current = []
    drawMarkersRef.current.forEach((m) => m.remove())
    drawMarkersRef.current = []

    const handleClick = (e: L.LeafletMouseEvent) => {
      // Close the shape by clicking back on the first vertex (needs >= 3 points).
      if (drawPointsRef.current.length >= 3) {
        const first = map.latLngToContainerPoint(drawPointsRef.current[0])
        const here = map.latLngToContainerPoint(e.latlng)
        if (first.distanceTo(here) <= 14) {
          finishDrawing()
          return
        }
      }
      const isFirst = drawPointsRef.current.length === 0
      drawPointsRef.current.push(e.latlng)
      // The first vertex is drawn larger/hollow so it reads as the "click to close" target.
      const marker = L.circleMarker(e.latlng, {
        radius: isFirst ? 7 : 5,
        fillColor: isFirst ? '#ffffff' : DEFAULT_PLOT_COLOR,
        color: isFirst ? DEFAULT_PLOT_COLOR : '#fff',
        weight: isFirst ? 3 : 2,
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
    setEditing(null)
    setSaveError('')
  }

  // Open the tag form pre-filled to edit a saved plot's fields (not its boundary).
  const startEdit = useCallback((plot: SharePlot) => {
    setDrawMode(plot.species ? 'species' : 'block')
    setForm({
      block: plot.block != null ? String(plot.block) : '',
      size: plot.size != null ? String(plot.size) : '',
      species: plot.species || '',
      readinessDate: plot.readinessDate || '',
    })
    setSaveError('')
    setDraft(null)
    setEditing(plot)
  }, [])

  const savePlot = useCallback(async () => {
    if (!draft || !data.accessToken) return
    // The draw mode (which Draw button was used) decides the required fields.
    if (drawMode === 'block' && (!form.block.trim() || !form.size.trim())) {
      setSaveError('Block and container size are both required.')
      return
    }
    if (drawMode === 'species' && !form.species.trim()) {
      setSaveError('Species is required.')
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
          // Only the drawn layer's fields are saved (block+size, or species+readiness).
          block: drawMode === 'block' ? form.block : undefined,
          size: drawMode === 'block' ? form.size : undefined,
          species: drawMode === 'species' ? form.species : undefined,
          readinessDate: drawMode === 'species' ? form.readinessDate : undefined,
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
  }, [draft, data.accessToken, token, drawMode, form, viewerEmail])

  // Save edits to an existing plot's fields (PATCH — boundary stays put).
  const updatePlot = useCallback(async () => {
    if (!editing || !data.accessToken) return
    if (drawMode === 'block' && (!form.block.trim() || !form.size.trim())) {
      setSaveError('Block and container size are both required.')
      return
    }
    if (drawMode === 'species' && !form.species.trim()) {
      setSaveError('Species is required.')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`/api/share/${token}/plots?k=${encodeURIComponent(data.accessToken)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          block: drawMode === 'block' ? form.block : undefined,
          size: drawMode === 'block' ? form.size : undefined,
          species: drawMode === 'species' ? form.species : undefined,
          readinessDate: drawMode === 'species' ? form.readinessDate : undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body.error || 'Could not save changes.')
        return
      }
      setPlots((prev) => prev.map((p) => (p.id === body.plot.id ? body.plot : p)))
      setEditing(null)
    } catch {
      setSaveError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [editing, data.accessToken, token, drawMode, form])

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

  // Orient each plot label along the plot's longest edge and shrink the font so
  // it fits that edge on one line; hide it when it would be unreadably small (the
  // viewer can still click the plot to see its details). Leaflet centers the
  // label box on the plot; we only rotate the inner text. Recomputed on zoom.
  const fitPlotLabels = useCallback(() => {
    const map = mapRef.current
    const layer = plotsLayerRef.current
    if (!map || !layer) return
    const REF = 12 // reference font size used to measure the label's natural width
    const view = map.getBounds()
    layer.eachLayer((lyr) => {
      const poly = lyr as L.Polygon
      const tt = poly.getTooltip?.()
      const el = tt?.getElement?.() as HTMLElement | undefined
      if (!tt || !el) return
      // Off-screen labels don't need updating.
      if (!view.intersects(poly.getBounds())) {
        el.style.display = 'none'
        return
      }

      // Cache the label text and its natural width at REF (both zoom-independent).
      if (!el.dataset.txt) el.dataset.txt = (el.textContent || '').trim()
      const text = el.dataset.txt
      let natural = Number(el.dataset.natw || 0)
      if (!natural) {
        const sp = el.querySelector('.plnt-label-inner') as HTMLElement | null
        if (sp) {
          sp.style.fontSize = `${REF}px`
          natural = sp.scrollWidth
          el.dataset.natw = String(natural)
        }
      }
      if (!text || !natural) return

      // Longest polygon edge in screen pixels → text budget + angle (angle is
      // constant across zoom; only the pixel length scales).
      const ringLL = poly.getLatLngs()[0] as L.LatLng[]
      if (!Array.isArray(ringLL) || ringLL.length < 2) return
      let bestLen = 0
      let bestAng = 0
      for (let i = 0; i < ringLL.length; i++) {
        const a = map.latLngToContainerPoint(ringLL[i])
        const c = map.latLngToContainerPoint(ringLL[(i + 1) % ringLL.length])
        const len = Math.hypot(c.x - a.x, c.y - a.y)
        if (len > bestLen) {
          bestLen = len
          bestAng = Math.atan2(c.y - a.y, c.x - a.x)
        }
      }
      let deg = (bestAng * 180) / Math.PI
      if (deg > 90) deg -= 180
      else if (deg < -90) deg += 180

      const avail = bestLen - 8
      if (avail < 16 || REF * (avail / natural) < 7) {
        el.style.display = 'none'
        return
      }
      const fs = Math.min(16, Math.round(REF * (avail / natural)))
      const sig = `${fs}|${Math.round(deg)}`
      if (el.style.display !== 'none' && el.dataset.sig === sig) return // unchanged
      el.dataset.sig = sig
      el.style.display = ''
      // Re-render the label content (re-centers the box) with the fitted font + rotation.
      poly.setTooltipContent(
        `<span class="plnt-label-inner" style="font-size:${fs}px;transform:rotate(${deg.toFixed(1)}deg)">${escapeHtml(text)}</span>`
      )
    })
  }, [])

  // Redraw saved plots whenever the set changes or an annotation toggle flips
  // (toggles change the color/label, so we rebuild the layer).
  useEffect(() => {
    const layer = plotsLayerRef.current
    if (!layer) return
    layer.clearLayers()
    for (let idx = 0; idx < plots.length; idx++) {
      const plot = plots[idx]
      const ring = plot.boundary?.coordinates?.[0]
      if (!ring) continue
      // Only draw the boundary if at least one active layer applies to it, so
      // toggling Block/Size/Species off hides the boundaries that relied on it.
      const parts = activePlotParts(plot, annot)
      if (parts.length === 0) continue
      const coords = ring.map(([lng, lat]) => [lat, lng] as [number, number])
      const color = plotColor(plot, annot, idx)
      const polygon = L.polygon(coords, { color, weight: 2, fillColor: color, fillOpacity: 0.2 })

      const popupEl = document.createElement('div')
      popupEl.innerHTML = plotPopupHtml(plot, annot)
      const actions = document.createElement('div')
      actions.style.cssText = 'margin-top:6px;display:flex;gap:12px;'
      const edit = document.createElement('button')
      edit.textContent = 'Edit'
      edit.style.cssText = 'font-size:11px;color:#16a34a;background:none;border:none;cursor:pointer;padding:0;'
      edit.onclick = () => {
        polygon.closePopup()
        startEdit(plot)
      }
      const del = document.createElement('button')
      del.textContent = 'Delete plot'
      del.style.cssText = 'font-size:11px;color:#dc2626;background:none;border:none;cursor:pointer;padding:0;'
      del.onclick = () => {
        polygon.closePopup()
        deletePlot(plot.id)
      }
      actions.appendChild(edit)
      actions.appendChild(del)
      popupEl.appendChild(actions)
      polygon.bindPopup(popupEl)

      // On-map label shows block/size only — species is view-on-click (popup),
      // since species names are too long to read inside the plots. Species plots
      // stay drawn + clickable (no text label).
      const mapLabel = [
        annot.block && plot.block != null ? `Block ${plot.block}` : null,
        annot.size && plot.size != null ? `${plot.size}-Gallon` : null,
      ]
        .filter(Boolean)
        .join(' -- ')
      if (mapLabel) {
        polygon.bindTooltip(`<span class="plnt-label-inner">${escapeHtml(mapLabel)}</span>`, {
          permanent: true,
          direction: 'center',
          className: 'plnt-plot-label',
        })
      }
      layer.addLayer(polygon)
    }
    fitPlotLabels()
  }, [plots, annot, deletePlot, startEdit, fitPlotLabels])

  // Re-fit labels to their boundaries as the map zooms.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = () => fitPlotLabels()
    map.on('zoomend', handler)
    return () => {
      map.off('zoomend', handler)
    }
  }, [fitPlotLabels])

  // When the inventory opens, fetch the plant points once and count how many
  // fall inside each plot's boundary — same point-in-polygon as the dashboard.
  useEffect(() => {
    if (!invOpen) return
    let cancelled = false
    const run = async () => {
      if (rgbLayer?.pointsUrl && !pointsDataRef.current) {
        setInvCounting(true)
        try {
          const res = await fetch(rgbLayer.pointsUrl)
          pointsDataRef.current = await res.json()
        } catch {
          /* no points file — counts stay unavailable */
        }
        if (!cancelled) setInvCounting(false)
      }
      if (cancelled) return
      const base = pointsDataRef.current
      if (!base) {
        setInvCounts(null)
        return
      }
      // Count against the corrected set so the drawer agrees with the badge.
      const removedKeys = new Set(
        pointEdits.filter((e) => e.kind === 'remove').map((e) => ptKey(e.lat, e.lng))
      )
      const pts: [number, number][] = base.filter(([lat, lng]) => !removedKeys.has(ptKey(lat, lng)))
      for (const a of pointEdits) if (a.kind === 'add') pts.push([a.lat, a.lng])
      const counts: Record<string, number> = {}
      for (const plot of plots) {
        const ring = plot.boundary?.coordinates?.[0]
        let c = 0
        if (ring) for (const [lat, lng] of pts) if (pointInRing(lng, lat, ring)) c++
        counts[plot.id] = c
      }
      if (!cancelled) setInvCounts(counts)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [invOpen, plots, rgbLayer, pointEdits])

  // Drag the sheet's top edge to resize it (clamped between a peek and full screen).
  const startInvResize = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // let header buttons click
    e.preventDefault()
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const frac = (rect.bottom - ev.clientY) / rect.height
      setInvFrac(Math.max(0.2, Math.min(1, frac)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Inventory rows = species plots only. A species is drawn inside a block, so
  // it inherits that block's number + size (found by which block boundary its
  // centroid falls inside).
  const blockPlots = plots.filter((p) => p.block != null)
  const inventoryRows = plots
    .filter((p) => !!p.species)
    .map((sp) => {
      const ring = sp.boundary?.coordinates?.[0]
      let block: SharePlot | null = null
      if (ring) {
        const [clng, clat] = ringCentroid(ring)
        block =
          blockPlots.find((b) => {
            const br = b.boundary?.coordinates?.[0]
            return br ? pointInRing(clng, clat, br) : false
          }) || null
      }
      return {
        id: sp.id,
        species: sp.species,
        size: block?.size ?? null,
        block: block?.block ?? null,
        readinessDate: sp.readinessDate ?? null,
      }
    })

  // Group the species plots by (block, size, species) so every unique combination
  // is a single line — the count is summed across all of that combination's plots.
  // Sorted species -> size -> block (matching the column order) instead of one
  // line per drawn plot.
  type InvGroup = {
    key: string
    species: string | null
    size: number | null
    block: number | null
    plotIds: string[]
    readiness: string[]
  }
  const inventoryGroups = Object.values(
    inventoryRows.reduce((acc: Record<string, InvGroup>, r) => {
      const key = `${r.block ?? ''}|${r.size ?? ''}|${(r.species ?? '').trim().toLowerCase()}`
      if (!acc[key]) {
        acc[key] = { key, species: r.species, size: r.size, block: r.block, plotIds: [], readiness: [] }
      }
      acc[key].plotIds.push(r.id)
      if (r.readinessDate) acc[key].readiness.push(r.readinessDate)
      return acc
    }, {})
  )
    .map((g) => ({
      key: g.key,
      species: g.species,
      size: g.size,
      block: g.block,
      plotIds: g.plotIds,
      // Earliest readiness across the group (ISO dates sort chronologically).
      readinessDate: g.readiness.length ? g.readiness.slice().sort()[0] : null,
    }))
    .sort(
      (a, b) =>
        (a.species ?? '').localeCompare(b.species ?? '') ||
        (a.size ?? Infinity) - (b.size ?? Infinity) ||
        (a.block ?? Infinity) - (b.block ?? Infinity)
    )

  // Total plant count for a grouped row = sum of its plots' individual counts.
  const groupCount = (g: { plotIds: string[] }) =>
    invCounts ? g.plotIds.reduce((sum, id) => sum + (invCounts[id] ?? 0), 0) : null

  // Export the current location's species inventory as CSV (matches the drawer's columns).
  const exportInventoryCSV = () => {
    const cell = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ['Species', 'Size (gal)', 'Count', 'Block', 'Readiness Date']
    const rows = inventoryGroups.map((g) => [
      g.species || '',
      g.size != null ? g.size : '',
      invCounts ? groupCount(g) ?? 0 : '',
      g.block != null ? g.block : '',
      g.readinessDate ? fmtReadiness(g.readinessDate) : '',
    ])
    const csv = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    const slug = (data.title || 'inventory').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
    a.download = `${slug || 'inventory'}-inventory.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const allLoading = data.layers.length > 0 && Object.keys(ready).length < data.layers.filter((l) => l.tilesUrl).length

  return (
    <div ref={rootRef} className="relative h-full w-full">
      <style>{`
        .plnt-plot-label { background: transparent; border: none; box-shadow: none; padding: 0; margin: 0; overflow: visible; pointer-events: none; }
        .plnt-plot-label::before { display: none; }
        .plnt-label-inner { display: inline-block; white-space: nowrap; transform-origin: center center; color: #fff; font-weight: 700; line-height: 1; text-shadow: 0 1px 2px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.85); pointer-events: none; }
      `}</style>
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Drawing instructions — stays in the corner; the Draw button lives in the panel */}
      {isDrawing && !draft && (
        <div className="absolute bottom-3 left-14 z-[1000] flex items-center gap-2">
          <div className="rounded-md bg-white shadow px-3 py-2 text-xs text-gray-700">
            <span className="font-medium text-green-600">Drawing</span> — click to add points, then click the first
            point (or double-click) to finish
          </div>
          <button
            onClick={cancelDrawing}
            className="rounded-md bg-white shadow px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Species autocomplete options (nursery availability list) */}
      <datalist id="plnt-species">
        {SPECIES_LIST.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* Tag form — shown after a polygon is drawn (draft) or when editing a plot.
          z above the inventory drawer so row-edits surface over it. */}
      {(draft || editing) && (
        <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-xs rounded-lg bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">{editing ? 'Edit plot' : 'Tag this plot'}</span>
              <button onClick={discardDraft} className="text-gray-400 hover:text-gray-700" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">
                Area:{' '}
                <span className="font-medium text-gray-700">
                  {((draft ? draft.areaAcres : editing?.areaAcres) ?? 0).toFixed(2)} acres
                </span>
              </p>
              {drawMode === 'block' && (
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
              {drawMode === 'species' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Species</label>
                    <input
                      type="text"
                      list="plnt-species"
                      autoComplete="off"
                      value={form.species}
                      onChange={(e) => setForm((f) => ({ ...f, species: e.target.value }))}
                      placeholder="Start typing… e.g. Acer rubrum"
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
                onClick={editing ? updatePlot : savePlot}
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
        <div className="absolute top-3 left-14 z-[1000] rounded-lg bg-[#0f2e1d]/95 text-white shadow-lg px-3 py-2 flex items-center gap-2">
          <Leaf className="h-4 w-4 text-green-300 shrink-0" />
          <span className="text-sm font-semibold tabular-nums">{effectiveCount.toLocaleString()}</span>
          <span className="text-xs text-green-200/80">plants counted</span>
          {hasEdits && (
            <span
              className="text-[10px] text-amber-300 border-l border-white/20 pl-2"
              title={`Adjusted by a viewer: ${addCount} added, ${removeCount} removed`}
            >
              edited
            </span>
          )}
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
                          Plant markers{typeof layer.plant_count === 'number' ? ` (${effectiveCount.toLocaleString()})` : ''}
                        </span>
                        {pointsLoading && <span className="text-[10px] text-gray-400">loading…</span>}
                      </label>
                    )}
                    {layer.type === 'rgb' && canEditCount && isOn && (
                      <div className="pl-6 pt-1.5">
                        <button
                          onClick={() => (editingCount ? stopEditCount() : startEditCount())}
                          className={`w-full flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                            editingCount
                              ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {editingCount ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                          {editingCount ? 'Done' : 'Add / remove plants'}
                        </button>
                        {editingCount && (
                          <p className="mt-1 text-[10px] leading-snug text-gray-500">
                            Click the map to <span className="font-medium text-amber-600">add</span> a plant; click a
                            dot to <span className="font-medium text-red-600">remove</span> it.
                            {savingPoint && <span className="text-gray-400"> · saving…</span>}
                          </p>
                        )}
                        {hasEdits && (
                          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                            <span className="truncate">
                              {addCount > 0 && `+${addCount} added`}
                              {addCount > 0 && removeCount > 0 && ' · '}
                              {removeCount > 0 && `−${removeCount} removed`}
                            </span>
                            <button
                              onClick={resetPointEdits}
                              disabled={savingPoint}
                              className="shrink-0 text-gray-400 underline hover:text-red-600 disabled:opacity-50"
                            >
                              Reset
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Plot data — draw + tag boundary plots */}
              <div className="mt-1 pt-1.5 border-t border-gray-100">
                <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Plot data</p>
                {/* Block row, with its own Draw button. Size is grouped beneath and
                    is captured together with block when you draw a block plot. */}
                <div className="flex items-center gap-2 rounded p-1.5 hover:bg-gray-50">
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={annot.block}
                      onChange={(e) => setAnnot((p) => ({ ...p, block: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-800 truncate">{ANNOT_META.block.label}</span>
                  </label>
                  {annot.block &&
                    !draft &&
                    (isDrawing ? (
                      drawMode === 'block' && (
                        <span className="text-[11px] font-medium text-green-600 shrink-0">Drawing…</span>
                      )
                    ) : (
                      <button
                        onClick={() => startDrawing('block')}
                        className="flex items-center gap-1 rounded bg-green-600 text-white px-2 py-0.5 text-[11px] font-medium hover:bg-green-700 shrink-0"
                        title="Draw a block plot"
                      >
                        <Pencil className="h-3 w-3" />
                        Draw
                      </button>
                    ))}
                </div>
                <label className="flex items-center gap-2 cursor-pointer rounded p-1.5 pl-7 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={annot.size}
                    onChange={(e) => setAnnot((p) => ({ ...p, size: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs text-gray-600 flex-1">{ANNOT_META.size.label}</span>
                </label>
                {/* Species row, with its own Draw button */}
                <div className="flex items-center gap-2 rounded p-1.5 hover:bg-gray-50">
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={annot.species}
                      onChange={(e) => setAnnot((p) => ({ ...p, species: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-800 truncate">{ANNOT_META.species.label}</span>
                  </label>
                  {annot.species &&
                    !draft &&
                    (isDrawing ? (
                      drawMode === 'species' && (
                        <span className="text-[11px] font-medium text-green-600 shrink-0">Drawing…</span>
                      )
                    ) : (
                      <button
                        onClick={() => startDrawing('species')}
                        className="flex items-center gap-1 rounded bg-green-600 text-white px-2 py-0.5 text-[11px] font-medium hover:bg-green-700 shrink-0"
                        title="Draw a species plot"
                      >
                        <Pencil className="h-3 w-3" />
                        Draw
                      </button>
                    ))}
                </div>
                {!anyAnnot && (
                  <p className="px-1.5 pt-0.5 text-[11px] text-gray-400">Turn on Block or Species to draw.</p>
                )}
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

      {/* Bottom-center legend + interactive range slider per visible ramp layer.
          Raised to clear the centered Inventory pill when both are present. */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 max-w-[90vw]">
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

      {/* Inventory drawer — collapsed trigger (bottom-right) */}
      {!invOpen && (
        <button
          onClick={() => setInvOpen(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1100] flex items-center gap-1.5 rounded-md bg-[#0f2e1d] text-white shadow-lg px-3 py-2 text-sm font-medium hover:bg-[#143d27]"
          title="Show inventory"
        >
          <Table2 className="h-4 w-4" />
          Inventory
          <span className="text-green-300 tabular-nums">({inventoryGroups.length})</span>
          <ChevronUp className="h-4 w-4" />
        </button>
      )}

      {/* Inventory drawer — expandable bottom sheet */}
      {invOpen && (
        <div
          className="absolute inset-x-0 bottom-0 z-[1100] flex flex-col bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.15)] rounded-t-xl overflow-hidden"
          style={{ height: `${Math.round(invFrac * 100)}%` }}
        >
          {/* Drag handle + controls */}
          <div
            onPointerDown={startInvResize}
            className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 cursor-ns-resize touch-none select-none"
          >
            <div className="absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full bg-gray-300" />
            <Table2 className="h-4 w-4 text-[#0f2e1d] shrink-0" />
            <span className="text-sm font-semibold text-gray-900">Inventory</span>
            <span className="text-xs text-gray-400 tabular-nums">{inventoryGroups.length} lines</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={exportInventoryCSV}
                disabled={inventoryGroups.length === 0}
                className="text-gray-400 hover:text-gray-700 p-1 disabled:opacity-40"
                title="Download CSV"
                aria-label="Download inventory as CSV"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                onClick={() => setInvFrac((f) => (f >= 0.95 ? 0.5 : 1))}
                className="text-gray-400 hover:text-gray-700 p-1"
                title={invFrac >= 0.95 ? 'Split with map' : 'Full screen'}
                aria-label={invFrac >= 0.95 ? 'Split with map' : 'Full screen'}
              >
                {invFrac >= 0.95 ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setInvOpen(false)}
                className="text-gray-400 hover:text-gray-700 p-1"
                title="Hide inventory"
                aria-label="Hide inventory"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {inventoryGroups.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400 p-6 text-center">
                No species plots yet. Turn on Species and use its “Draw” button to add one.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Species</th>
                    <th className="text-left font-medium px-3 py-2">Size</th>
                    <th className="text-right font-medium px-3 py-2">Count</th>
                    <th className="text-left font-medium px-3 py-2">Block</th>
                    <th className="text-left font-medium px-3 py-2">Readiness Date</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {inventoryGroups.map((g) => (
                    <tr key={g.key} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-900">{g.species || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {g.size != null ? `${g.size}-Gallon` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                        {invCounts ? (groupCount(g) ?? 0).toLocaleString() : invCounting ? '…' : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {g.block != null ? g.block : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {g.readinessDate ? fmtReadiness(g.readinessDate) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {g.plotIds.length === 1 ? (
                          <button
                            onClick={() => {
                              const plot = plots.find((p) => p.id === g.plotIds[0])
                              if (plot) startEdit(plot)
                            }}
                            className="inline-flex items-center gap-1 text-green-700 hover:text-green-900 text-xs font-medium"
                            title="Edit this species"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                        ) : (
                          <span
                            className="text-xs text-gray-400 tabular-nums"
                            title={`${g.plotIds.length} plots grouped — edit them individually on the map`}
                          >
                            {g.plotIds.length} plots
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
