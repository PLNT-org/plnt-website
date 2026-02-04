'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Mountain,
  Layers,
  Download,
  ChevronLeft,
  Loader2,
  BarChart3,
  TrendingUp,
  Ruler,
  Info,
} from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts'

// Dynamic import for map component (Leaflet requires browser APIs)
const CanopyHeightMap = dynamic(() => import('@/components/canopy-height-map'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-gray-100 rounded-lg flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  ),
})

// Demo data for height analysis
const DEMO_HEIGHT_DATA = {
  id: 'demo-chm-1',
  name: 'North Field A - Height Analysis',
  bounds: {
    north: 34.0524,
    south: 34.0520,
    east: -118.2434,
    west: -118.2440,
  },
  webodm_project_id: '1',
  webodm_task_id: 'demo-task',
  stats: {
    minHeight: 0.3,
    maxHeight: 4.2,
    avgHeight: 1.8,
    stdDev: 0.72,
    totalArea: 2.5, // acres
    coveredArea: 2.1, // acres with vegetation
  },
  histogram: [
    { range: '0-0.5m', count: 180, percentage: 12, color: '#22c55e' },
    { range: '0.5-1m', count: 320, percentage: 21, color: '#84cc16' },
    { range: '1-1.5m', count: 410, percentage: 27, color: '#eab308' },
    { range: '1.5-2m', count: 290, percentage: 19, color: '#f97316' },
    { range: '2-2.5m', count: 175, percentage: 12, color: '#ef4444' },
    { range: '2.5-3m', count: 95, percentage: 6, color: '#dc2626' },
    { range: '3m+', count: 50, percentage: 3, color: '#991b1b' },
  ],
}

interface HeightStats {
  minHeight: number
  maxHeight: number
  avgHeight: number
  stdDev: number
  totalArea?: number
  coveredArea?: number
}

interface HistogramBin {
  range: string
  count: number
  percentage: number
  color: string
}

interface Orthomosaic {
  id: string
  name: string
  bounds: { north: number; south: number; east: number; west: number }
  webodm_project_id?: string
  webodm_task_id?: string
  has_dsm?: boolean
  has_dtm?: boolean
  processing_type?: string
}

export default function CanopyHeightPage() {
  const { user, isDemo } = useAuth()
  const searchParams = useSearchParams()
  const orthomosaicId = searchParams.get('id')

  const [loading, setLoading] = useState(true)
  const [orthomosaics, setOrthomosaics] = useState<Orthomosaic[]>([])
  const [selectedOrthomosaic, setSelectedOrthomosaic] = useState<Orthomosaic | null>(null)
  const [heightStats, setHeightStats] = useState<HeightStats | null>(null)
  const [histogram, setHistogram] = useState<HistogramBin[]>([])
  const [colorScale, setColorScale] = useState<'viridis' | 'terrain' | 'rdylgn'>('viridis')

  // Load orthomosaics with height data
  useEffect(() => {
    async function loadData() {
      if (isDemo) {
        setOrthomosaics([DEMO_HEIGHT_DATA as unknown as Orthomosaic])
        setSelectedOrthomosaic(DEMO_HEIGHT_DATA as unknown as Orthomosaic)
        setHeightStats(DEMO_HEIGHT_DATA.stats)
        setHistogram(DEMO_HEIGHT_DATA.histogram)
        setLoading(false)
        return
      }

      try {
        // Fetch orthomosaics that have DSM/DTM (height data)
        const { data, error } = await supabase
          .from('orthomosaics')
          .select('*')
          .eq('user_id', user?.id)
          .or('has_dsm.eq.true,processing_type.eq.height-mapping')
          .order('created_at', { ascending: false })

        if (error) throw error

        setOrthomosaics(data || [])

        // Select the one from URL or first available
        if (orthomosaicId) {
          const found = data?.find((o: Orthomosaic) => o.id === orthomosaicId)
          if (found) {
            setSelectedOrthomosaic(found)
            await loadHeightStats(found.id)
          }
        } else if (data && data.length > 0) {
          setSelectedOrthomosaic(data[0])
          await loadHeightStats(data[0].id)
        }
      } catch (err) {
        console.error('Error loading orthomosaics:', err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [isDemo, user?.id, orthomosaicId])

  const loadHeightStats = async (id: string) => {
    if (isDemo) {
      setHeightStats(DEMO_HEIGHT_DATA.stats)
      setHistogram(DEMO_HEIGHT_DATA.histogram)
      return
    }

    try {
      const response = await fetch(`/api/canopy-height/stats?orthomosaicId=${id}`)
      const data = await response.json()
      if (response.ok) {
        setHeightStats(data.stats)
        setHistogram(data.histogram)
      }
    } catch (err) {
      console.error('Error loading height stats:', err)
    }
  }

  const handleOrthomosaicChange = async (id: string) => {
    const ortho = orthomosaics.find(o => o.id === id)
    if (ortho) {
      setSelectedOrthomosaic(ortho)
      await loadHeightStats(id)
    }
  }

  const exportCSV = () => {
    if (!heightStats || !histogram || !selectedOrthomosaic) return

    let csv = 'Canopy Height Analysis Report\n'
    csv += `Orthomosaic: ${selectedOrthomosaic.name}\n`
    csv += `Generated: ${new Date().toISOString()}\n\n`
    csv += 'Summary Statistics\n'
    csv += `Min Height (m),${heightStats.minHeight.toFixed(2)}\n`
    csv += `Max Height (m),${heightStats.maxHeight.toFixed(2)}\n`
    csv += `Average Height (m),${heightStats.avgHeight.toFixed(2)}\n`
    csv += `Std Deviation (m),${heightStats.stdDev.toFixed(2)}\n\n`
    csv += 'Height Distribution\n'
    csv += 'Range,Pixel Count,Percentage\n'
    histogram.forEach(bin => {
      csv += `${bin.range},${bin.count},${bin.percentage}%\n`
    })

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `canopy-height-${selectedOrthomosaic.name.replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    )
  }

  if (orthomosaics.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/analytics">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to Analytics
            </Button>
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mountain className="h-6 w-6 text-green-600" />
            Canopy Height Analysis
          </h1>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No height mapping data available. To measure tree/plant heights:
            <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
              <li>Create a flight plan with "3D Model (Height Mapping)" mission type</li>
              <li>Fly the cross-hatch pattern with your drone</li>
              <li>Upload images and select "3D Height Mapping" processing</li>
              <li>Wait for WebODM to generate DSM and DTM</li>
            </ol>
          </AlertDescription>
        </Alert>

        <div className="flex gap-4">
          <Link href="/dashboard/flight-planner">
            <Button className="bg-green-700 hover:bg-green-800">
              Create Height Mapping Flight
            </Button>
          </Link>
          <Link href="/dashboard/upload">
            <Button variant="outline">
              Upload Images
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/analytics">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mountain className="h-6 w-6 text-green-600" />
              Canopy Height Analysis
            </h1>
            <p className="text-gray-600 text-sm">CHM = DSM - DTM (vegetation height above ground)</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isDemo && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800">
              Demo Mode
            </Badge>
          )}
          <Select
            value={selectedOrthomosaic?.id || ''}
            onValueChange={handleOrthomosaicChange}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select orthomosaic..." />
            </SelectTrigger>
            <SelectContent>
              {orthomosaics.map(ortho => (
                <SelectItem key={ortho.id} value={ortho.id}>
                  {ortho.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Quick Stats */}
      {heightStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Ruler className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Min Height</p>
                  <p className="text-2xl font-bold">{heightStats.minHeight.toFixed(1)}m</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Max Height</p>
                  <p className="text-2xl font-bold">{heightStats.maxHeight.toFixed(1)}m</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <BarChart3 className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Average Height</p>
                  <p className="text-2xl font-bold">{heightStats.avgHeight.toFixed(1)}m</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Layers className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Std Deviation</p>
                  <p className="text-2xl font-bold">{heightStats.stdDev.toFixed(2)}m</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs defaultValue="map" className="space-y-4">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="map">Height Map</TabsTrigger>
            <TabsTrigger value="histogram">Distribution</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Select value={colorScale} onValueChange={(v: 'viridis' | 'terrain' | 'rdylgn') => setColorScale(v)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viridis">Viridis</SelectItem>
                <SelectItem value="terrain">Terrain</SelectItem>
                <SelectItem value="rdylgn">Red-Yellow-Green</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        <TabsContent value="map">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Canopy Height Model (CHM)</CardTitle>
              <CardDescription>
                Height above ground calculated from DSM - DTM. Colors represent vegetation height.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {selectedOrthomosaic && (
                <CanopyHeightMap
                  orthomosaic={selectedOrthomosaic}
                  colorScale={colorScale}
                  isDemo={isDemo}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="histogram">
          <Card>
            <CardHeader>
              <CardTitle>Height Distribution</CardTitle>
              <CardDescription>
                Distribution of vegetation heights across the surveyed area
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogram} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="range" />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        name === 'count' ? `${value.toLocaleString()} pixels` : `${value}%`,
                        name === 'count' ? 'Count' : 'Percentage'
                      ]}
                    />
                    <Legend />
                    <Bar dataKey="count" name="Pixel Count" radius={[4, 4, 0, 0]}>
                      {histogram.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Height Legend */}
              <div className="mt-6 border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Height Interpretation</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500"></div>
                    <span className="text-gray-600">0-1m: Seedlings/Ground cover</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-yellow-500"></div>
                    <span className="text-gray-600">1-2m: Young plants</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-orange-500"></div>
                    <span className="text-gray-600">2-3m: Established plants</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-700"></div>
                    <span className="text-gray-600">3m+: Mature trees</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
