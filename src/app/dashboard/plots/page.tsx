'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PlotSidebar } from '@/components/plot-sidebar'
import {
  Plus,
  Map,
  List,
  Loader2,
  Pencil,
  Trash2,
  Eye,
  Leaf,
  AlertCircle,
  Plane,
} from 'lucide-react'

// Dynamic import for map component
const PlotBoundaryMap = dynamic(() => import('@/components/plot-boundary-map'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-gray-100 rounded-lg flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  ),
})

interface Species {
  id: string
  name: string
  scientific_name?: string
  category?: string
}

interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

interface Plot {
  id: string
  name: string
  species_id?: string
  species?: Species
  boundaries?: GeoJSONPolygon
  area_acres: number
  status?: 'active' | 'archived' | 'planning'
  created_at: string
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

interface MarkerRegistration {
  id: string
  aruco_marker_id: number
  latitude: number
  longitude: number
  species?: {
    id: string
    name: string
    scientific_name?: string
  }
  registered_at: string
  plot_name?: string
}

// Demo markers
const DEMO_MARKERS: MarkerRegistration[] = [
  { id: 'm1', aruco_marker_id: 42, latitude: 34.0525, longitude: -118.2440, species: { id: 's1', name: 'White Oak', scientific_name: 'Quercus alba' }, registered_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'm2', aruco_marker_id: 15, latitude: 34.0523, longitude: -118.2438, species: { id: 's2', name: 'Red Maple', scientific_name: 'Acer rubrum' }, registered_at: new Date(Date.now() - 172800000).toISOString() },
  { id: 'm3', aruco_marker_id: 78, latitude: 34.0521, longitude: -118.2442, species: { id: 's1', name: 'White Oak', scientific_name: 'Quercus alba' }, registered_at: new Date(Date.now() - 259200000).toISOString() },
  { id: 'm4', aruco_marker_id: 103, latitude: 34.0527, longitude: -118.2435, species: { id: 's3', name: 'Blue Hydrangea' }, registered_at: new Date(Date.now() - 345600000).toISOString() },
  { id: 'm5', aruco_marker_id: 56, latitude: 34.0519, longitude: -118.2445, registered_at: new Date(Date.now() - 432000000).toISOString() },
]

// Demo data
const DEMO_PLOTS: Plot[] = [
  {
    id: 'demo-1',
    name: 'Row A - Oaks',
    species: { id: 's1', name: 'White Oak', scientific_name: 'Quercus alba', category: 'Tree' },
    species_id: 's1',
    area_acres: 2.5,
    status: 'active',
    created_at: new Date().toISOString(),
    boundaries: {
      type: 'Polygon',
      coordinates: [[[-118.245, 34.053], [-118.243, 34.053], [-118.243, 34.051], [-118.245, 34.051], [-118.245, 34.053]]],
    },
  },
  {
    id: 'demo-2',
    name: 'Row B - Maples',
    species: { id: 's2', name: 'Red Maple', scientific_name: 'Acer rubrum', category: 'Tree' },
    species_id: 's2',
    area_acres: 1.8,
    status: 'active',
    created_at: new Date().toISOString(),
    boundaries: {
      type: 'Polygon',
      coordinates: [[[-118.243, 34.053], [-118.241, 34.053], [-118.241, 34.051], [-118.243, 34.051], [-118.243, 34.053]]],
    },
  },
]

const DEMO_SPECIES: Species[] = [
  { id: 's1', name: 'White Oak', scientific_name: 'Quercus alba', category: 'Tree' },
  { id: 's2', name: 'Red Maple', scientific_name: 'Acer rubrum', category: 'Tree' },
  { id: 's3', name: 'Blue Hydrangea', category: 'Shrub' },
]

export default function PlotsPage() {
  const { session, isDemo, loading: authLoading } = useAuth()

  // Data state
  const [plots, setPlots] = useState<Plot[]>([])
  const [species, setSpecies] = useState<Species[]>([])
  const [orthomosaics, setOrthomosaics] = useState<Orthomosaic[]>([])
  const [markers, setMarkers] = useState<MarkerRegistration[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedOrthomosaicId, setSelectedOrthomosaicId] = useState<string | null>(null)

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarMode, setSidebarMode] = useState<'view' | 'create' | 'edit'>('view')
  const [selectedPlot, setSelectedPlot] = useState<Plot | null>(null)

  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [drawnBoundary, setDrawnBoundary] = useState<GeoJSONPolygon | null>(null)
  const [drawnAreaAcres, setDrawnAreaAcres] = useState<number>(0)

  // Load data
  useEffect(() => {
    if (authLoading) return

    if (isDemo) {
      setPlots(DEMO_PLOTS)
      setSpecies(DEMO_SPECIES)
      setMarkers(DEMO_MARKERS)
      setIsLoading(false)
      return
    }

    if (!session?.access_token) {
      setIsLoading(false)
      setError('Please sign in to view plots')
      return
    }

    loadData()
  }, [session, isDemo, authLoading])

  const loadData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [plotsRes, speciesRes, orthoRes, markersRes] = await Promise.all([
        fetch('/api/plots', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
        fetch('/api/species', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
        fetch('/api/orthomosaic/list'),
        fetch('/api/marker-registrations', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }),
      ])

      if (plotsRes.ok) {
        const data = await plotsRes.json()
        setPlots(data.plots || [])
      } else {
        setError('Failed to load plots')
      }

      if (speciesRes.ok) {
        const data = await speciesRes.json()
        setSpecies(Array.isArray(data) ? data : [])
      }

      if (orthoRes.ok) {
        const data = await orthoRes.json()
        setOrthomosaics(data.orthomosaics || [])
      }

      if (markersRes.ok) {
        const data = await markersRes.json()
        setMarkers(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Load data error:', err)
      setError('Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  // Handle plot click on map
  const handlePlotClick = useCallback((plot: Plot) => {
    setSelectedPlot(plot)
    setSidebarMode('view')
    setSidebarOpen(true)
    setIsDrawingMode(false)
  }, [])

  // Handle add plot button
  const handleAddPlot = () => {
    setSelectedPlot(null)
    setDrawnBoundary(null)
    setDrawnAreaAcres(0)
    setSidebarMode('create')
    setSidebarOpen(true)
  }

  // Handle edit from sidebar
  const handleEditPlot = () => {
    setSidebarMode('edit')
    setDrawnBoundary(null)
    setDrawnAreaAcres(0)
  }

  // Handle boundary drawn
  const handleBoundaryDrawn = useCallback((boundary: GeoJSONPolygon, areaAcres: number) => {
    setDrawnBoundary(boundary)
    setDrawnAreaAcres(areaAcres)
    setIsDrawingMode(false)
  }, [])

  // Handle boundary cleared
  const handleBoundaryCleared = useCallback(() => {
    setDrawnBoundary(null)
    setDrawnAreaAcres(0)
  }, [])

  // Handle save plot
  const handleSavePlot = async (data: {
    name: string
    species_id: string
    status: string
    boundaries?: GeoJSONPolygon
    area_acres?: number
  }) => {
    if (isDemo) {
      if (sidebarMode === 'create') {
        const newPlot: Plot = {
          id: `demo-${Date.now()}`,
          name: data.name,
          species_id: data.species_id,
          species: species.find(s => s.id === data.species_id),
          boundaries: data.boundaries,
          area_acres: data.area_acres || 0,
          status: data.status as any,
          created_at: new Date().toISOString(),
        }
        setPlots([newPlot, ...plots])
      } else if (selectedPlot) {
        setPlots(plots.map(p =>
          p.id === selectedPlot.id
            ? { ...p, ...data, species: species.find(s => s.id === data.species_id) }
            : p
        ))
      }
      setSidebarOpen(false)
      setSelectedPlot(null)
      setDrawnBoundary(null)
      return
    }

    const url = sidebarMode === 'create'
      ? '/api/plots'
      : `/api/plots/${selectedPlot?.id}`
    const method = sidebarMode === 'create' ? 'POST' : 'PATCH'

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to save plot')
    }

    // Reload plots
    await loadData()
    setSidebarOpen(false)
    setSelectedPlot(null)
    setDrawnBoundary(null)
  }

  // Handle delete plot
  const handleDeletePlot = async (plotId: string) => {
    if (isDemo) {
      setPlots(plots.filter(p => p.id !== plotId))
      setSidebarOpen(false)
      setSelectedPlot(null)
      return
    }

    const response = await fetch(`/api/plots/${plotId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Failed to delete plot')
    }

    setPlots(plots.filter(p => p.id !== plotId))
    setSidebarOpen(false)
    setSelectedPlot(null)
  }

  // Close sidebar
  const handleCloseSidebar = () => {
    setSidebarOpen(false)
    setSelectedPlot(null)
    setIsDrawingMode(false)
    setDrawnBoundary(null)
    setDrawnAreaAcres(0)
  }

  // Filter plots
  const filteredPlots = plots.filter((plot) => {
    if (statusFilter === 'all') return true
    return plot.status === statusFilter
  })

  // Get plots with boundaries for map
  const plotsWithBoundaries = filteredPlots.filter((p) => p.boundaries?.coordinates)

  // Calculate center from plots or use default
  const getMapCenter = (): [number, number] => {
    if (plotsWithBoundaries.length > 0) {
      const firstPlot = plotsWithBoundaries[0]
      const coords = firstPlot.boundaries!.coordinates[0][0]
      return [coords[1], coords[0]]
    }
    return [34.0522, -118.2437]
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-700',
    planning: 'bg-blue-100 text-blue-700',
  }

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
              <h1 className="text-2xl font-bold text-gray-900">Plot Management</h1>
              <p className="text-gray-600">Manage your nursery plots and boundaries</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDemo && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                Demo Mode
              </Badge>
            )}
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleAddPlot}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Plot
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
          <div className="flex items-center gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="z-[1100]">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-gray-500">
              {filteredPlots.length} plot{filteredPlots.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <Button
              size="sm"
              onClick={() => setViewMode('map')}
              className={viewMode === 'map'
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-transparent text-gray-600 hover:bg-gray-200'}
            >
              <Map className="h-4 w-4 mr-1" />
              Map
            </Button>
            <Button
              size="sm"
              onClick={() => setViewMode('list')}
              className={viewMode === 'list'
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-transparent text-gray-600 hover:bg-gray-200'}
            >
              <List className="h-4 w-4 mr-1" />
              List
            </Button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4">
          <Card className="border-red-200">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-600">{error}</p>
              <Button variant="outline" className="mt-4" onClick={loadData}>
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      )}

      {/* Content */}
      {!isLoading && !error && (
        <div className="flex-1 relative overflow-hidden">
          {/* Map View */}
          {viewMode === 'map' && (
            <div className="h-full">
              <PlotBoundaryMap
                otherPlots={plotsWithBoundaries}
                orthomosaics={orthomosaics}
                selectedOrthomosaicId={selectedOrthomosaicId || undefined}
                onOrthomosaicChange={setSelectedOrthomosaicId}
                defaultCenter={getMapCenter()}
                defaultZoom={plotsWithBoundaries.length > 0 ? 17 : 14}
                height="100%"
                onPlotClick={handlePlotClick}
                selectedPlotId={selectedPlot?.id}
                isDrawingMode={isDrawingMode}
                onDrawingModeChange={setIsDrawingMode}
                onBoundaryDrawn={handleBoundaryDrawn}
                onBoundaryCleared={handleBoundaryCleared}
                existingBoundary={sidebarMode === 'edit' ? selectedPlot?.boundaries : undefined}
                readOnly={!sidebarOpen || sidebarMode === 'view'}
                markers={markers}
              />
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <div className="h-full overflow-auto p-4">
              {filteredPlots.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <Leaf className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No Plots Yet</h3>
                    <p className="text-gray-600 mb-4">
                      Create your first plot to start managing your nursery.
                    </p>
                    <Button onClick={handleAddPlot}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Plot
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Species</TableHead>
                        <TableHead className="hidden sm:table-cell">Area</TableHead>
                        <TableHead className="hidden md:table-cell">Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPlots.map((plot) => (
                        <TableRow
                          key={plot.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => handlePlotClick(plot)}
                        >
                          <TableCell className="font-medium">{plot.name}</TableCell>
                          <TableCell>
                            {plot.species ? (
                              <div>
                                <div className="font-medium text-gray-900">{plot.species.name}</div>
                                {plot.species.scientific_name && (
                                  <div className="text-xs text-gray-500 italic">
                                    {plot.species.scientific_name}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">Not assigned</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {plot.area_acres > 0 ? `${plot.area_acres.toFixed(2)} ac` : '-'}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge className={statusColors[plot.status || 'active']}>
                              {plot.status || 'active'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="View"
                                onClick={() => handlePlotClick(plot)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Link href={`/dashboard/flight-planner?plot=${plot.id}`}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Create Flight Plan"
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                >
                                  <Plane className="h-4 w-4" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit"
                                onClick={() => {
                                  setSelectedPlot(plot)
                                  setSidebarMode('edit')
                                  setSidebarOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Delete"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => handleDeletePlot(plot.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}

              {/* Summary */}
              {filteredPlots.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-600">
                  <span>
                    Total area:{' '}
                    <strong>
                      {filteredPlots.reduce((sum, p) => sum + (p.area_acres || 0), 0).toFixed(2)} acres
                    </strong>
                  </span>
                  <span>
                    With boundaries:{' '}
                    <strong>{plotsWithBoundaries.length}</strong>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Sidebar */}
          <PlotSidebar
            isOpen={sidebarOpen}
            onClose={handleCloseSidebar}
            mode={sidebarMode}
            plot={selectedPlot}
            species={species}
            drawnBoundary={drawnBoundary}
            drawnAreaAcres={drawnAreaAcres}
            onSave={handleSavePlot}
            onDelete={handleDeletePlot}
            onEdit={handleEditPlot}
            onStartDrawing={() => setIsDrawingMode(true)}
            onClearDrawing={() => {
              setDrawnBoundary(null)
              setDrawnAreaAcres(0)
            }}
            isDrawing={isDrawingMode}
          />
        </div>
      )}
    </div>
  )
}
