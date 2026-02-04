'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
import { ArrowLeft, Save, Loader2, Leaf } from 'lucide-react'

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
  boundaries?: GeoJSONPolygon
  species?: {
    id: string
    name: string
  }
}

// Demo data
const DEMO_SPECIES: Species[] = [
  { id: 's1', name: 'White Oak', scientific_name: 'Quercus alba', category: 'Tree' },
  { id: 's2', name: 'Red Maple', scientific_name: 'Acer rubrum', category: 'Tree' },
  { id: 's3', name: 'Blue Hydrangea', category: 'Shrub' },
  { id: 's4', name: 'Japanese Maple', scientific_name: 'Acer palmatum', category: 'Tree' },
]

const DEMO_PLOTS: Plot[] = [
  {
    id: 'demo-1',
    name: 'Row A - Oaks',
    species: { id: 's1', name: 'White Oak' },
    boundaries: {
      type: 'Polygon',
      coordinates: [[[-118.245, 34.053], [-118.243, 34.053], [-118.243, 34.051], [-118.245, 34.051], [-118.245, 34.053]]],
    },
  },
]

export default function NewPlotPage() {
  return (
    <ProtectedRoute>
      <NewPlotContent />
    </ProtectedRoute>
  )
}

function NewPlotContent() {
  const { session, isDemo } = useAuth()
  const router = useRouter()

  const [name, setName] = useState('')
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<string>('')
  const [status, setStatus] = useState<'active' | 'planning' | 'archived'>('active')
  const [boundary, setBoundary] = useState<GeoJSONPolygon | null>(null)
  const [areaAcres, setAreaAcres] = useState<number>(0)
  const [selectedOrthomosaicId, setSelectedOrthomosaicId] = useState<string | null>(null)

  const [species, setSpecies] = useState<Species[]>([])
  const [orthomosaics, setOrthomosaics] = useState<Orthomosaic[]>([])
  const [otherPlots, setOtherPlots] = useState<Plot[]>([])

  const [loadingSpecies, setLoadingSpecies] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load species, orthomosaics, and existing plots
  useEffect(() => {
    if (isDemo) {
      setSpecies(DEMO_SPECIES)
      setOtherPlots(DEMO_PLOTS)
      setLoadingSpecies(false)
      return
    }

    if (!session?.access_token) {
      setLoadingSpecies(false)
      return
    }

    loadData()
  }, [session, isDemo])

  const loadData = async () => {
    setLoadingSpecies(true)

    try {
      // Load species, orthomosaics, and plots in parallel
      const [speciesRes, orthoRes, plotsRes] = await Promise.all([
        fetch('/api/species', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
        fetch('/api/orthomosaic/list'),
        fetch('/api/plots', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
      ])

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
        setOtherPlots(plotsData.plots || [])
      }
    } catch (err) {
      console.error('Load data error:', err)
    } finally {
      setLoadingSpecies(false)
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
      alert('Plot saved! (Demo mode - data not persisted)')
      router.push('/dashboard/plots')
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch('/api/plots', {
        method: 'POST',
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
        throw new Error(data.error || 'Failed to create plot')
      }

      router.push('/dashboard/plots')
    } catch (err: any) {
      setError(err.message || 'Failed to save plot')
    } finally {
      setSaving(false)
    }
  }

  const selectedSpecies = species.find((s) => s.id === selectedSpeciesId)

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
              <h1 className="text-2xl font-bold text-gray-900">Create New Plot</h1>
              <p className="text-sm text-gray-600">Define a plot boundary and assign a species</p>
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
                <CardTitle>Draw Plot Boundary</CardTitle>
                <CardDescription>
                  Click &quot;Draw Boundary&quot; then click points on the map to define your plot.
                  Double-click or right-click to finish. You can switch between satellite and orthomosaic backgrounds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PlotBoundaryMap
                  onBoundaryDrawn={handleBoundaryDrawn}
                  otherPlots={otherPlots}
                  orthomosaics={orthomosaics}
                  selectedOrthomosaicId={selectedOrthomosaicId || undefined}
                  onOrthomosaicChange={setSelectedOrthomosaicId}
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
                  {loadingSpecies ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading species...
                    </div>
                  ) : species.length === 0 ? (
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
                      Save Plot
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
                <p>1. Click &quot;Draw Boundary&quot; to start drawing</p>
                <p>2. Click to add points (minimum 3)</p>
                <p>3. Double-click or right-click to finish</p>
                <p>4. Use the layer selector to switch between satellite and orthomosaic</p>
                <p>5. Plot boundaries are saved as GPS coordinates and will align with any orthomosaic</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
