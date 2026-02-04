'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { ProtectedRoute } from '@/lib/auth/protected-route'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PlotBoundaryMap } from '@/components/dynamic-map-wrapper'
import { SpeciesSelector } from '@/components/species-selector'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, AlertCircle, Leaf } from 'lucide-react'

interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

interface Species {
  id: string
  name: string
  scientific_name?: string
  category?: string
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

interface Plot {
  id: string
  name: string
  species_id?: string
  species?: {
    id: string
    name: string
    scientific_name?: string
    category?: string
  }
  boundaries?: GeoJSONPolygon
  area_acres: number
  status?: 'active' | 'planning' | 'archived'
  created_at: string
}

// Demo data
const DEMO_SPECIES: Species[] = [
  { id: 's1', name: 'White Oak', scientific_name: 'Quercus alba', category: 'Tree' },
  { id: 's2', name: 'Red Maple', scientific_name: 'Acer rubrum', category: 'Tree' },
  { id: 's3', name: 'Blue Hydrangea', category: 'Shrub' },
  { id: 's4', name: 'Japanese Maple', scientific_name: 'Acer palmatum', category: 'Tree' },
]

const DEMO_PLOT: Plot = {
  id: 'demo-1',
  name: 'Row A - Oaks',
  species_id: 's1',
  species: { id: 's1', name: 'White Oak', scientific_name: 'Quercus alba', category: 'Tree' },
  boundaries: {
    type: 'Polygon',
    coordinates: [[[-118.245, 34.053], [-118.243, 34.053], [-118.243, 34.051], [-118.245, 34.051], [-118.245, 34.053]]],
  },
  area_acres: 2.5,
  status: 'active',
  created_at: new Date().toISOString(),
}

export default function EditPlotPage() {
  return (
    <ProtectedRoute>
      <EditPlotContent />
    </ProtectedRoute>
  )
}

function EditPlotContent() {
  const params = useParams()
  const { session, isDemo } = useAuth()
  const router = useRouter()
  const plotId = params.id as string

  const [plot, setPlot] = useState<Plot | null>(null)
  const [name, setName] = useState('')
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<string>('')
  const [status, setStatus] = useState<'active' | 'planning' | 'archived'>('active')
  const [boundary, setBoundary] = useState<GeoJSONPolygon | null>(null)
  const [areaAcres, setAreaAcres] = useState<number>(0)
  const [selectedOrthomosaicId, setSelectedOrthomosaicId] = useState<string | null>(null)

  const [species, setSpecies] = useState<Species[]>([])
  const [orthomosaics, setOrthomosaics] = useState<Orthomosaic[]>([])
  const [otherPlots, setOtherPlots] = useState<Plot[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load plot data
  useEffect(() => {
    if (isDemo) {
      setPlot(DEMO_PLOT)
      setName(DEMO_PLOT.name)
      setSelectedSpeciesId(DEMO_PLOT.species_id || '')
      setStatus(DEMO_PLOT.status || 'active')
      setBoundary(DEMO_PLOT.boundaries || null)
      setAreaAcres(DEMO_PLOT.area_acres)
      setSpecies(DEMO_SPECIES)
      setLoading(false)
      return
    }

    if (!session?.access_token) {
      setLoading(false)
      return
    }

    loadData()
  }, [session, isDemo, plotId])

  const loadData = async () => {
    setLoading(true)

    try {
      // Load plot, species, orthomosaics, and other plots in parallel
      const [plotRes, speciesRes, orthoRes, plotsRes] = await Promise.all([
        fetch(`/api/plots/${plotId}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
        fetch('/api/species', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
        fetch('/api/orthomosaic/list'),
        fetch('/api/plots', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
      ])

      if (!plotRes.ok) {
        setError('Plot not found')
        return
      }

      const plotData = await plotRes.json()
      const loadedPlot = plotData.plot as Plot

      setPlot(loadedPlot)
      setName(loadedPlot.name)
      setSelectedSpeciesId(loadedPlot.species_id || loadedPlot.species?.id || '')
      setStatus(loadedPlot.status || 'active')
      setBoundary(loadedPlot.boundaries || null)
      setAreaAcres(loadedPlot.area_acres || 0)

      if (speciesRes.ok) {
        const speciesData = await speciesRes.json()
        // API returns array directly, not { species: [...] }
        setSpecies(Array.isArray(speciesData) ? speciesData : [])
      }

      if (orthoRes.ok) {
        const orthoData = await orthoRes.json()
        setOrthomosaics(orthoData.orthomosaics || [])
      }

      if (plotsRes.ok) {
        const plotsData = await plotsRes.json()
        // Exclude current plot from other plots
        setOtherPlots((plotsData.plots || []).filter((p: Plot) => p.id !== plotId))
      }
    } catch (err) {
      console.error('Load data error:', err)
      setError('Failed to load plot data')
    } finally {
      setLoading(false)
    }
  }

  const handleBoundaryDrawn = (newBoundary: GeoJSONPolygon, acres: number) => {
    setBoundary(newBoundary)
    setAreaAcres(acres)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please provide a plot name')
      return
    }

    if (!selectedSpeciesId) {
      setError('Please select a species for this plot')
      return
    }

    if (!boundary) {
      setError('Please draw the plot boundary on the map')
      return
    }

    if (isDemo) {
      alert('Plot updated! (Demo mode - data not persisted)')
      router.push('/dashboard/plots')
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch(`/api/plots/${plotId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          species_id: selectedSpeciesId,
          boundaries: boundary,
          area_acres: areaAcres,
          status,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update plot')
      }

      router.push('/dashboard/plots')
    } catch (err: any) {
      setError(err.message || 'Failed to save plot')
    } finally {
      setSaving(false)
    }
  }

  const selectedSpecies = species.find((s) => s.id === selectedSpeciesId)

  // Calculate map center from existing boundary
  const getMapCenter = (): [number, number] => {
    if (boundary?.coordinates?.[0]?.[0]) {
      const coords = boundary.coordinates[0]
      const lats = coords.map(c => c[1])
      const lngs = coords.map(c => c[0])
      const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2
      const centerLng = (Math.max(...lngs) + Math.min(...lngs)) / 2
      return [centerLat, centerLng]
    }
    return [34.0522, -118.2437]
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-green-600 mx-auto mb-2" />
          <p className="text-gray-600">Loading plot...</p>
        </div>
      </div>
    )
  }

  if (!plot && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Plot Not Found</h2>
            <p className="text-gray-600 mb-4">The plot you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
            <Link href="/dashboard/plots">
              <Button>Back to Plots</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard/plots">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Plots
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Edit Plot</h1>
              <p className="text-sm text-gray-600">Modify plot boundaries and details</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Map Section */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Edit Plot Boundary</CardTitle>
                <CardDescription>
                  Clear the existing boundary and draw a new one, or keep the current boundary.
                  Switch between satellite and orthomosaic backgrounds using the layer selector.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PlotBoundaryMap
                  onBoundaryDrawn={handleBoundaryDrawn}
                  existingBoundary={boundary || undefined}
                  otherPlots={otherPlots}
                  orthomosaics={orthomosaics}
                  selectedOrthomosaicId={selectedOrthomosaicId || undefined}
                  onOrthomosaicChange={setSelectedOrthomosaicId}
                  defaultCenter={getMapCenter()}
                  defaultZoom={17}
                  height="500px"
                />
              </CardContent>
            </Card>
          </div>

          {/* Form Section */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Plot Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div>
                  <label className="block text-sm font-medium mb-2">Plot Name *</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Row A - North Section"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Species *</label>
                  {species.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      <p>No species registered yet.</p>
                      <Link href="/dashboard/species" className="text-green-600 hover:underline">
                        Register a species first
                      </Link>
                    </div>
                  ) : (
                    <SpeciesSelector
                      species={species}
                      selectedId={selectedSpeciesId}
                      onSelect={setSelectedSpeciesId}
                      placeholder="Search or select a species..."
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Status</label>
                  <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="planning">Planning</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {boundary && (
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-medium text-green-800 mb-2 flex items-center gap-2">
                      <Leaf className="h-4 w-4" />
                      Boundary Defined
                    </h4>
                    <div className="space-y-1 text-sm text-green-700">
                      <p>Area: {areaAcres.toFixed(2)} acres</p>
                      <p>Points: {boundary.coordinates[0].length - 1}</p>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSave}
                  disabled={saving || !name || !selectedSpeciesId || !boundary}
                  className="w-full bg-green-700 hover:bg-green-800 text-white"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-lg">Tips</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-600">
                <p>1. Click &quot;Clear&quot; to remove the existing boundary</p>
                <p>2. Click &quot;Draw Boundary&quot; to draw a new one</p>
                <p>3. Existing plots are shown with dashed outlines</p>
                <p>4. Boundaries are geo-fenced and will align with any orthomosaic</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
