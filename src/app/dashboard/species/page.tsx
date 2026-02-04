'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Loader2,
  Leaf,
  Barcode,
  AlertCircle,
} from 'lucide-react'

interface Species {
  id: string
  name: string
  scientific_name?: string
  barcode_value?: string
  category?: string
  container_size?: string
  notes?: string
  created_at: string
}

const CATEGORIES = ['Tree', 'Shrub', 'Perennial', 'Annual', 'Grass', 'Fern', 'Succulent', 'Other']
const CONTAINER_SIZES = ['Plug', '4"', '1 gal', '2 gal', '3 gal', '5 gal', '7 gal', '15 gal', '25 gal', 'B&B']

export default function SpeciesPage() {
  const { session, isDemo, loading: authLoading } = useAuth()
  const [speciesList, setSpeciesList] = useState<Species[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingSpecies, setEditingSpecies] = useState<Species | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    scientific_name: '',
    barcode_value: '',
    category: '',
    container_size: '',
    notes: '',
  })

  // Load species on mount
  useEffect(() => {
    if (authLoading) return // Wait for auth to finish

    if (session?.access_token || isDemo) {
      loadSpecies()
    } else {
      // No session and not demo - stop loading
      setIsLoading(false)
      setError('Please sign in to manage species')
    }
  }, [session, isDemo, authLoading])

  const loadSpecies = async () => {
    if (isDemo) {
      // Demo data
      setSpeciesList([
        {
          id: '1',
          name: 'White Oak',
          scientific_name: 'Quercus alba',
          barcode_value: 'OAK001',
          category: 'Tree',
          container_size: '5 gal',
          created_at: new Date().toISOString(),
        },
        {
          id: '2',
          name: 'Red Maple',
          scientific_name: 'Acer rubrum',
          barcode_value: 'MAP001',
          category: 'Tree',
          container_size: '15 gal',
          created_at: new Date().toISOString(),
        },
        {
          id: '3',
          name: 'Blue Hydrangea',
          scientific_name: 'Hydrangea macrophylla',
          barcode_value: 'HYD001',
          category: 'Shrub',
          container_size: '3 gal',
          created_at: new Date().toISOString(),
        },
      ])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/species', {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setSpeciesList(data)
      } else {
        setError('Failed to load species')
      }
    } catch (err) {
      console.error('Load species error:', err)
      setError('Failed to load species')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenCreate = () => {
    setFormData({
      name: '',
      scientific_name: '',
      barcode_value: '',
      category: '',
      container_size: '',
      notes: '',
    })
    setIsEditing(false)
    setEditingSpecies(null)
    setIsDialogOpen(true)
  }

  const handleOpenEdit = (species: Species) => {
    setFormData({
      name: species.name,
      scientific_name: species.scientific_name || '',
      barcode_value: species.barcode_value || '',
      category: species.category || '',
      container_size: species.container_size || '',
      notes: species.notes || '',
    })
    setIsEditing(true)
    setEditingSpecies(species)
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim()) return

    if (isDemo) {
      if (isEditing && editingSpecies) {
        setSpeciesList(
          speciesList.map((s) =>
            s.id === editingSpecies.id ? { ...s, ...formData } : s
          )
        )
      } else {
        setSpeciesList([
          ...speciesList,
          {
            id: Date.now().toString(),
            ...formData,
            created_at: new Date().toISOString(),
          },
        ])
      }
      setIsDialogOpen(false)
      return
    }

    setIsSaving(true)
    try {
      const url = isEditing ? `/api/species/${editingSpecies?.id}` : '/api/species'
      const method = isEditing ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          name: formData.name,
          scientific_name: formData.scientific_name || undefined,
          barcode_value: formData.barcode_value || undefined,
          category: formData.category || undefined,
          container_size: formData.container_size || undefined,
          notes: formData.notes || undefined,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        if (isEditing) {
          setSpeciesList(speciesList.map((s) => (s.id === data.id ? data : s)))
        } else {
          setSpeciesList([data, ...speciesList])
        }
        setIsDialogOpen(false)
      } else {
        const err = await response.json()
        alert(err.error || 'Failed to save species')
      }
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to save species')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (isDemo) {
      setSpeciesList(speciesList.filter((s) => s.id !== id))
      setDeleteConfirmId(null)
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/species/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      })

      if (response.ok) {
        setSpeciesList(speciesList.filter((s) => s.id !== id))
        setDeleteConfirmId(null)
      } else {
        alert('Failed to delete species')
      }
    } catch (err) {
      console.error('Delete error:', err)
      alert('Failed to delete species')
    } finally {
      setIsDeleting(false)
    }
  }

  // Filter species
  const filteredSpecies = speciesList.filter((species) => {
    const matchesSearch =
      searchQuery === '' ||
      species.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      species.scientific_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      species.barcode_value?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesCategory =
      categoryFilter === 'all' || species.category === categoryFilter

    return matchesSearch && matchesCategory
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Species Management</h1>
          <p className="text-gray-600">Manage your plant species catalog</p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Species
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search species..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Species List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <Card className="border-red-200">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-600">{error}</p>
            <Button variant="outline" className="mt-4" onClick={loadSpecies}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : filteredSpecies.length === 0 ? (
        <Card>
          <CardContent className="pt-12 pb-12 text-center">
            <Leaf className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No species found</h3>
            <p className="text-gray-500 mb-4">
              {speciesList.length === 0
                ? 'Add your first species to get started'
                : 'Try adjusting your search or filters'}
            </p>
            {speciesList.length === 0 && (
              <Button onClick={handleOpenCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add Species
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Scientific Name</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead className="hidden lg:table-cell">Container</TableHead>
                <TableHead className="hidden lg:table-cell">Barcode</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSpecies.map((species) => (
                <TableRow key={species.id}>
                  <TableCell className="font-medium">{species.name}</TableCell>
                  <TableCell className="hidden md:table-cell text-gray-500 italic">
                    {species.scientific_name || '-'}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {species.category && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {species.category}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-gray-500">
                    {species.container_size || '-'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {species.barcode_value && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Barcode className="h-3 w-3" />
                        {species.barcode_value}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(species)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteConfirmId(species.id)}
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
      <div className="mt-4 text-sm text-gray-500 text-center">
        {filteredSpecies.length} of {speciesList.length} species
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Species' : 'Add New Species'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the species information below.'
                : 'Enter the details for the new species.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., White Oak"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scientific_name">Scientific Name</Label>
              <Input
                id="scientific_name"
                placeholder="e.g., Quercus alba"
                value={formData.scientific_name}
                onChange={(e) =>
                  setFormData({ ...formData, scientific_name: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="container_size">Container Size</Label>
                <Select
                  value={formData.container_size}
                  onValueChange={(value) =>
                    setFormData({ ...formData, container_size: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTAINER_SIZES.map((size) => (
                      <SelectItem key={size} value={size}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="barcode_value">Barcode Value</Label>
              <Input
                id="barcode_value"
                placeholder="e.g., OAK001"
                value={formData.barcode_value}
                onChange={(e) =>
                  setFormData({ ...formData, barcode_value: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                placeholder="Any additional information"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!formData.name.trim() || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : isEditing ? (
                'Save Changes'
              ) : (
                'Add Species'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Species</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this species? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
