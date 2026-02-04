'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SpeciesSelector } from '@/components/species-selector'
import { X, Save, Trash2, Loader2, Leaf, MapPin, Pencil, Plane } from 'lucide-react'
import Link from 'next/link'

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
  status?: 'active' | 'planning' | 'archived'
  created_at: string
}

interface PlotSidebarProps {
  isOpen: boolean
  onClose: () => void
  mode: 'view' | 'create' | 'edit'
  plot?: Plot | null
  species: Species[]
  drawnBoundary?: GeoJSONPolygon | null
  drawnAreaAcres?: number
  onSave: (data: {
    name: string
    species_id: string
    status: string
    boundaries?: GeoJSONPolygon
    area_acres?: number
  }) => Promise<void>
  onDelete?: (plotId: string) => Promise<void>
  onEdit?: () => void
  onStartDrawing: () => void
  onClearDrawing: () => void
  isDrawing: boolean
}

export function PlotSidebar({
  isOpen,
  onClose,
  mode,
  plot,
  species,
  drawnBoundary,
  drawnAreaAcres,
  onSave,
  onDelete,
  onEdit,
  onStartDrawing,
  onClearDrawing,
  isDrawing,
}: PlotSidebarProps) {
  const [name, setName] = useState('')
  const [selectedSpeciesId, setSelectedSpeciesId] = useState('')
  const [status, setStatus] = useState<'active' | 'planning' | 'archived'>('active')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  // Reset form when plot or mode changes
  useEffect(() => {
    if (mode === 'create') {
      setName('')
      setSelectedSpeciesId('')
      setStatus('active')
    } else if (plot) {
      setName(plot.name)
      setSelectedSpeciesId(plot.species_id || plot.species?.id || '')
      setStatus(plot.status || 'active')
    }
    setError('')
  }, [plot, mode, isOpen])

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a plot name')
      return
    }
    if (!selectedSpeciesId) {
      setError('Please select a species')
      return
    }

    const hasBoundary = mode === 'create' ? drawnBoundary : (drawnBoundary || plot?.boundaries)
    if (!hasBoundary) {
      setError('Please draw the plot boundary on the map')
      return
    }

    setIsSaving(true)
    setError('')

    try {
      await onSave({
        name: name.trim(),
        species_id: selectedSpeciesId,
        status,
        boundaries: drawnBoundary || plot?.boundaries,
        area_acres: drawnAreaAcres ?? plot?.area_acres ?? 0,
      })
    } catch (err: any) {
      setError(err.message || 'Failed to save plot')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!plot || !onDelete) return
    if (!confirm('Are you sure you want to delete this plot?')) return

    setIsDeleting(true)
    try {
      await onDelete(plot.id)
    } catch (err: any) {
      setError(err.message || 'Failed to delete plot')
    } finally {
      setIsDeleting(false)
    }
  }

  const currentBoundary = drawnBoundary || plot?.boundaries
  const currentArea = drawnAreaAcres ?? plot?.area_acres ?? 0
  const selectedSpecies = species.find(s => s.id === selectedSpeciesId)

  if (!isOpen) return null

  return (
    <div className="absolute top-0 right-0 h-full w-96 bg-white shadow-xl z-[1001] flex flex-col border-l">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <h2 className="font-semibold text-lg">
          {mode === 'create' ? 'New Plot' : mode === 'edit' ? 'Edit Plot' : plot?.name}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">
            {error}
          </div>
        )}

        {mode === 'view' && plot ? (
          // View mode
          <>
            <div className="space-y-3">
              <div>
                <Label className="text-gray-500 text-xs">Species</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Leaf className="h-4 w-4 text-green-600" />
                  <span className="font-medium">{plot.species?.name || 'Not assigned'}</span>
                </div>
                {plot.species?.scientific_name && (
                  <p className="text-sm text-gray-500 italic ml-6">{plot.species.scientific_name}</p>
                )}
              </div>

              <div>
                <Label className="text-gray-500 text-xs">Area</Label>
                <div className="flex items-center gap-2 mt-1">
                  <MapPin className="h-4 w-4 text-blue-600" />
                  <span className="font-medium">{plot.area_acres?.toFixed(2) || 0} acres</span>
                </div>
              </div>

              <div>
                <Label className="text-gray-500 text-xs">Status</Label>
                <div className="mt-1">
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                    plot.status === 'active' ? 'bg-green-100 text-green-700' :
                    plot.status === 'planning' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {plot.status || 'active'}
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-gray-500 text-xs">Created</Label>
                <p className="mt-1">{new Date(plot.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </>
        ) : (
          // Create/Edit mode
          <>
            <div>
              <Label htmlFor="plot-name">Plot Name *</Label>
              <Input
                id="plot-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Row A - North Section"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Species *</Label>
              <div className="mt-1">
                {species.length === 0 ? (
                  <p className="text-sm text-gray-500">No species registered yet.</p>
                ) : (
                  <SpeciesSelector
                    species={species}
                    selectedId={selectedSpeciesId}
                    onSelect={setSelectedSpeciesId}
                    placeholder="Search or select..."
                  />
                )}
              </div>
            </div>

            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Boundary section */}
            <div className="border-t pt-4">
              <Label>Plot Boundary *</Label>
              <div className="mt-2 space-y-2">
                {!isDrawing ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={onStartDrawing}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    {currentBoundary ? 'Redraw Boundary' : 'Draw Boundary'}
                  </Button>
                ) : (
                  <div className="bg-green-50 text-green-700 text-sm p-3 rounded-lg">
                    <p className="font-medium">Drawing mode active</p>
                    <p className="text-xs mt-1">Click points on the map, double-click to finish</p>
                  </div>
                )}

                {currentBoundary && (
                  <div className="bg-gray-50 p-3 rounded-lg flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {currentArea.toFixed(2)} acres
                      </p>
                      <p className="text-xs text-gray-500">
                        {currentBoundary.coordinates[0].length - 1} points
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onClearDrawing}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-gray-50 space-y-2">
        {mode === 'view' ? (
          <>
            <Link href={`/dashboard/flight-planner?plot=${plot?.id}`} className="block">
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
              >
                <Plane className="h-4 w-4 mr-2" />
                Create Flight Plan
              </Button>
            </Link>
            <Button
              className="w-full"
              onClick={onEdit}
              variant="outline"
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit Plot
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete Plot
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {mode === 'create' ? 'Create Plot' : 'Save Changes'}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={onClose}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
