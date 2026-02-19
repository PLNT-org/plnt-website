'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import {
  Search,
  Download,
  Filter,
  Loader2,
  AlertCircle,
  Table2,
  ChevronUp,
  ChevronDown,
  Layers,
} from 'lucide-react'

interface Orthomosaic {
  id: string
  name: string
  status: string
  created_at: string
  webodm_project_id?: string
  webodm_task_id?: string
}

interface InventoryItem {
  id: string
  species_name: string
  scientific_name?: string
  category?: string
  count: number
  date_counted: string
  plot_id?: string
  plot_name?: string
}

// Demo data
const DEMO_INVENTORY: InventoryItem[] = [
  {
    id: '1',
    species_name: 'White Oak',
    scientific_name: 'Quercus alba',
    category: 'Tree',
    count: 1247,
    date_counted: new Date(Date.now() - 86400000).toISOString(),
    plot_id: 'p1',
    plot_name: 'North Field A',
  },
  {
    id: '2',
    species_name: 'Red Maple',
    scientific_name: 'Acer rubrum',
    category: 'Tree',
    count: 892,
    date_counted: new Date(Date.now() - 172800000).toISOString(),
    plot_id: 'p2',
    plot_name: 'East Grove',
  },
  {
    id: '3',
    species_name: 'Blue Hydrangea',
    scientific_name: 'Hydrangea macrophylla',
    category: 'Shrub',
    count: 456,
    date_counted: new Date(Date.now() - 259200000).toISOString(),
    plot_id: 'p1',
    plot_name: 'North Field A',
  },
  {
    id: '4',
    species_name: 'Japanese Maple',
    scientific_name: 'Acer palmatum',
    category: 'Tree',
    count: 234,
    date_counted: new Date(Date.now() - 345600000).toISOString(),
    plot_id: 'p3',
    plot_name: 'South Nursery',
  },
  {
    id: '5',
    species_name: 'Boxwood',
    scientific_name: 'Buxus sempervirens',
    category: 'Shrub',
    count: 1890,
    date_counted: new Date(Date.now() - 432000000).toISOString(),
    plot_id: 'p2',
    plot_name: 'East Grove',
  },
  {
    id: '6',
    species_name: 'Eastern Redbud',
    scientific_name: 'Cercis canadensis',
    category: 'Tree',
    count: 567,
    date_counted: new Date(Date.now() - 518400000).toISOString(),
    plot_id: 'p1',
    plot_name: 'North Field A',
  },
]

type SortField = 'species_name' | 'count' | 'date_counted' | 'plot_name' | 'category'
type SortDirection = 'asc' | 'desc'

export default function InventoryPage() {
  const { session, isDemo, loading: authLoading, user } = useAuth()

  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Orthomosaic selector
  const [orthomosaics, setOrthomosaics] = useState<Orthomosaic[]>([])
  const [selectedOrthomosaicId, setSelectedOrthomosaicId] = useState<string>('')

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [plotFilter, setPlotFilter] = useState<string>('all')

  // Sorting
  const [sortField, setSortField] = useState<SortField>('species_name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Load orthomosaic list on mount
  useEffect(() => {
    if (authLoading) return

    if (isDemo) {
      setInventory(DEMO_INVENTORY)
      setIsLoading(false)
      return
    }

    if (!session?.access_token) {
      setIsLoading(false)
      setError('Please sign in to view inventory')
      return
    }

    loadOrthomosaics()
  }, [session, isDemo, authLoading])

  // Fetch aggregate when orthomosaic selection changes
  useEffect(() => {
    if (selectedOrthomosaicId && !isDemo) {
      loadInventoryForOrthomosaic(selectedOrthomosaicId)
    }
  }, [selectedOrthomosaicId])

  const loadOrthomosaics = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/orthomosaic/list', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch orthomosaics')
      const data = await res.json()
      const completed = (data.orthomosaics || []).filter(
        (o: Orthomosaic) => o.status === 'completed'
      )
      setOrthomosaics(completed)

      if (completed.length > 0) {
        setSelectedOrthomosaicId(completed[0].id)
      } else {
        setIsLoading(false)
      }
    } catch (err) {
      console.error('Load orthomosaics error:', err)
      setError('Failed to load orthomosaics')
      setIsLoading(false)
    }
  }

  const loadInventoryForOrthomosaic = async (orthomosaicId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/plant-detection/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orthomosaicId, userId: user?.id }),
      })

      if (!res.ok) throw new Error('Failed to fetch plant counts')
      const data = await res.json()

      const selectedOrtho = orthomosaics.find((o) => o.id === orthomosaicId)
      const dateCounted = selectedOrtho?.created_at || new Date().toISOString()

      const items: InventoryItem[] = (data.plotCounts || []).map(
        (pc: any, idx: number) => ({
          id: `plot-${pc.plotId}-${idx}`,
          species_name: pc.speciesName || 'Unknown Species',
          category: pc.category,
          count: pc.totalCount,
          date_counted: dateCounted,
          plot_id: pc.plotId,
          plot_name: pc.plotName,
        })
      )

      if (data.unassignedCount > 0) {
        items.push({
          id: 'unassigned',
          species_name: 'Unassigned',
          category: undefined,
          count: data.unassignedCount,
          date_counted: dateCounted,
        })
      }

      setInventory(items)
    } catch (err) {
      console.error('Load inventory error:', err)
      setError('Failed to load plant counts')
      setInventory([])
    } finally {
      setIsLoading(false)
    }
  }

  // Get unique categories and plots for filters
  const categories = [...new Set(inventory.map((item) => item.category).filter(Boolean))]
  const plots = [...new Set(inventory.map((item) => item.plot_name).filter(Boolean))]

  // Filter and sort inventory
  const filteredInventory = inventory
    .filter((item) => {
      const matchesSearch =
        item.species_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.scientific_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.plot_name?.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
      const matchesPlot = plotFilter === 'all' || item.plot_name === plotFilter

      return matchesSearch && matchesCategory && matchesPlot
    })
    .sort((a, b) => {
      let aVal: string | number = a[sortField] ?? ''
      let bVal: string | number = b[sortField] ?? ''

      if (sortField === 'count') {
        aVal = a.count
        bVal = b.count
      } else if (sortField === 'date_counted') {
        aVal = new Date(a.date_counted).getTime()
        bVal = new Date(b.date_counted).getTime()
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = (bVal as string).toLowerCase()
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

  // Total count
  const totalPlants = filteredInventory.reduce((sum, item) => sum + item.count, 0)

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // Sort indicator component
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-4 w-4 inline ml-1" />
    ) : (
      <ChevronDown className="h-4 w-4 inline ml-1" />
    )
  }

  // Export to CSV
  const exportCSV = () => {
    const headers = ['Species', 'Scientific Name', 'Category', 'Count', 'Date Counted', 'Plot']
    const rows = filteredInventory.map((item) => [
      item.species_name,
      item.scientific_name || '',
      item.category || '',
      item.count.toString(),
      new Date(item.date_counted).toLocaleDateString(),
      item.plot_name || '',
    ])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventory-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
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
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <Table2 className="h-6 w-6 text-purple-600" />
                  Inventory
                </h1>
                <p className="text-gray-600">View and manage plant inventory</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isDemo && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                  Demo Mode
                </Badge>
              )}
              <Button variant="outline" onClick={exportCSV} disabled={filteredInventory.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Orthomosaic Selector */}
      {!isDemo && orthomosaics.length > 0 && (
        <div className="bg-white border-b">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <Layers className="h-4 w-4 text-teal-600" />
              <span className="text-sm font-medium text-gray-700">Orthomosaic:</span>
              <Select value={selectedOrthomosaicId} onValueChange={setSelectedOrthomosaicId}>
                <SelectTrigger className="w-[320px]">
                  <SelectValue placeholder="Select orthomosaic" />
                </SelectTrigger>
                <SelectContent className="z-[1100]">
                  {orthomosaics.map((ortho) => (
                    <SelectItem key={ortho.id} value={ortho.id}>
                      {ortho.name} — {new Date(ortho.created_at).toLocaleDateString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                type="search"
                placeholder="Search species, plot..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-0 bg-gray-100"
              />
            </div>

            {/* Category filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="z-[1100]">
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat!}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Plot filter */}
            <Select value={plotFilter} onValueChange={setPlotFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Plot" />
              </SelectTrigger>
              <SelectContent className="z-[1100]">
                <SelectItem value="all">All Plots</SelectItem>
                {plots.map((plot) => (
                  <SelectItem key={plot} value={plot!}>
                    {plot}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Summary */}
            <div className="ml-auto text-sm text-gray-600">
              <span className="font-medium">{filteredInventory.length}</span> species •{' '}
              <span className="font-medium">{totalPlants.toLocaleString()}</span> total plants
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-6">
        {/* Error state */}
        {error && (
          <Card className="border-red-200 mb-6">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && filteredInventory.length === 0 && (
          <Card className="py-12">
            <CardContent className="text-center">
              <Table2 className="h-12 w-12 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Inventory Data</h3>
              <p className="text-gray-600 mb-4">
                {searchQuery || categoryFilter !== 'all' || plotFilter !== 'all'
                  ? 'No items match your filters.'
                  : orthomosaics.length === 0
                    ? 'No completed orthomosaics found. Upload drone images to get started.'
                    : 'No plant detections found for this orthomosaic. Run plant detection from the orthomosaic viewer.'}
              </p>
              {!searchQuery && categoryFilter === 'all' && plotFilter === 'all' && orthomosaics.length === 0 && (
                <Link href="/dashboard/orthomosaic">
                  <Button>Create Orthomosaic</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {/* Table */}
        {!isLoading && !error && filteredInventory.length > 0 && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort('species_name')}
                  >
                    Species
                    <SortIndicator field="species_name" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort('category')}
                  >
                    Type
                    <SortIndicator field="category" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50 text-right"
                    onClick={() => handleSort('count')}
                  >
                    Count
                    <SortIndicator field="count" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort('date_counted')}
                  >
                    Date Counted
                    <SortIndicator field="date_counted" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSort('plot_name')}
                  >
                    Plot
                    <SortIndicator field="plot_name" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInventory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{item.species_name}</div>
                        {item.scientific_name && (
                          <div className="text-sm text-gray-500 italic">{item.scientific_name}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.category && (
                        <Badge variant="outline" className="text-xs">
                          {item.category}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {item.count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(item.date_counted).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {item.plot_name && (
                        <Link
                          href={`/dashboard/plots?plot=${item.plot_id}`}
                          className="text-green-600 hover:underline"
                        >
                          {item.plot_name}
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  )
}
