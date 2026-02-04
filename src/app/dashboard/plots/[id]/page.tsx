// app/dashboard/plots/[id]/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { ProtectedRoute } from '@/lib/auth/protected-route'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import {
  ArrowLeft,
  Plane,
  BarChart3,
  Calendar,
  MapPin,
  TrendingUp,
  Download,
  Settings,
  Clock,
  Activity,
  Pencil,
} from 'lucide-react'

interface PlotDetails {
  id: string
  name: string
  area_acres: number
  plant_type: string
  location: any
  boundaries: any
  created_at: string
}

interface FlightHistory {
  id: string
  started_at: string
  completed_at: string
  status: string
  images_captured: number
  plant_count?: number
}

export default function PlotDetailsPage() {
  return (
    <ProtectedRoute>
      <PlotDetailsContent />
    </ProtectedRoute>
  )
}

function PlotDetailsContent() {
  const params = useParams()
  const router = useRouter()
  const { user, isDemo } = useAuth()
  const [plot, setPlot] = useState<PlotDetails | null>(null)
  const [flights, setFlights] = useState<FlightHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    if (isDemo) {
      // Load demo data
      setPlot({
        id: params.id as string,
        name: 'North Field A',
        area_acres: 2.5,
        plant_type: 'Tomatoes',
        location: { address: '123 Farm Road' },
        boundaries: { type: 'Polygon', coordinates: [] },
        created_at: '2024-01-15',
      })
      setFlights([
        {
          id: '1',
          started_at: '2024-01-18T09:00:00',
          completed_at: '2024-01-18T09:15:00',
          status: 'completed',
          images_captured: 145,
          plant_count: 1247,
        },
        {
          id: '2',
          started_at: '2024-01-15T10:00:00',
          completed_at: '2024-01-15T10:12:00',
          status: 'completed',
          images_captured: 132,
          plant_count: 1198,
        },
      ])
      setLoading(false)
    } else {
      fetchPlotData()
    }
  }, [params.id, isDemo])

  const fetchPlotData = async () => {
    if (!user) return

    try {
      // Fetch plot details
      const { data: plotData, error: plotError } = await supabase
        .from('plots')
        .select('*')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single()

      if (plotError) throw plotError
      setPlot(plotData)

      // Fetch flight history
      const { data: flightPlans } = await supabase
        .from('flight_plans')
        .select('id')
        .eq('plot_id', params.id)

      if (flightPlans) {
        const planIds = flightPlans.map(p => p.id)
        const { data: flightsData } = await supabase
          .from('flights')
          .select(`
            *,
            plant_counts (count)
          `)
          .in('flight_plan_id', planIds)
          .order('started_at', { ascending: false })

        setFlights(flightsData || [])
      }
    } catch (error) {
      console.error('Error fetching plot data:', error)
      router.push('/dashboard/plots')
    } finally {
      setLoading(false)
    }
  }

  const getGrowthTrend = () => {
    if (flights.length < 2) return null
    const latest = flights[0]?.plant_count || 0
    const previous = flights[1]?.plant_count || 0
    const change = ((latest - previous) / previous) * 100
    return change
  }

  if (loading || !plot) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    )
  }

  const growthTrend = getGrowthTrend()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/dashboard/plots">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Plots
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{plot.name}</h1>
                <p className="text-sm text-gray-600">{plot.plant_type} • {plot.area_acres} acres</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Link href={`/dashboard/flight-planner?plot=${plot.id}`}>
                <Button className="bg-green-700 hover:bg-green-800 text-white">
                  <Plane className="w-4 h-4 mr-2" />
                  Plan New Flight
                </Button>
              </Link>
              <Link href={`/dashboard/plots/${plot.id}/edit`}>
                <Button variant="outline">
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="flights">Flight History</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* Stats Cards */}
            <div className="grid md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Flights</p>
                      <p className="text-2xl font-bold">{flights.length}</p>
                    </div>
                    <Plane className="w-8 h-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Latest Count</p>
                      <p className="text-2xl font-bold">
                        {flights[0]?.plant_count?.toLocaleString() || 'N/A'}
                      </p>
                    </div>
                    <Activity className="w-8 h-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Growth Trend</p>
                      <p className="text-2xl font-bold">
                        {growthTrend !== null ? (
                          <span className={growthTrend >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {growthTrend >= 0 ? '+' : ''}{growthTrend.toFixed(1)}%
                          </span>
                        ) : (
                          'N/A'
                        )}
                      </p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-purple-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Last Flight</p>
                      <p className="text-2xl font-bold">
                        {flights[0] ? new Date(flights[0].started_at).toLocaleDateString() : 'Never'}
                      </p>
                    </div>
                    <Calendar className="w-8 h-8 text-orange-600" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Plot Info */}
            <Card>
              <CardHeader>
                <CardTitle>Plot Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-600">Location</label>
                      <p className="mt-1">{plot.location?.address || 'Not specified'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Created</label>
                      <p className="mt-1">{new Date(plot.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-600">Plant Type</label>
                      <p className="mt-1">{plot.plant_type}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Survey Area</label>
                      <p className="mt-1">{plot.area_acres} acres</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Flights */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Flights</CardTitle>
                <CardDescription>Latest survey missions for this plot</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {flights.slice(0, 3).map((flight) => (
                    <div key={flight.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium">
                          {new Date(flight.started_at).toLocaleDateString()} at{' '}
                          {new Date(flight.started_at).toLocaleTimeString()}
                        </p>
                        <p className="text-sm text-gray-600">
                          {flight.images_captured} images • {flight.plant_count?.toLocaleString() || 'Processing'} plants
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant={flight.status === 'completed' ? 'default' : 'secondary'}>
                          {flight.status}
                        </Badge>
                        <Button variant="ghost" size="sm">
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="flights" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Complete Flight History</CardTitle>
                <CardDescription>All survey missions for this plot</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {flights.map((flight) => (
                    <div key={flight.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">
                            Flight on {new Date(flight.started_at).toLocaleDateString()}
                          </p>
                          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600">Duration:</span>
                              <p className="font-medium">
                                {flight.completed_at
                                  ? Math.round(
                                      (new Date(flight.completed_at).getTime() -
                                        new Date(flight.started_at).getTime()) /
                                        60000
                                    )
                                  : 'N/A'}{' '}
                                min
                              </p>
                            </div>
                            <div>
                              <span className="text-gray-600">Images:</span>
                              <p className="font-medium">{flight.images_captured}</p>
                            </div>
                            <div>
                              <span className="text-gray-600">Plant Count:</span>
                              <p className="font-medium">{flight.plant_count?.toLocaleString() || 'N/A'}</p>
                            </div>
                            <div>
                              <span className="text-gray-600">Status:</span>
                              <Badge variant={flight.status === 'completed' ? 'default' : 'secondary'}>
                                {flight.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Plant Count Over Time</CardTitle>
                  <CardDescription>Track growth trends</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 bg-gray-50 rounded flex items-center justify-center">
                    <div className="text-center">
                      <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-600">Growth chart visualization</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Plant Density Map</CardTitle>
                  <CardDescription>Latest density distribution</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 bg-gray-50 rounded flex items-center justify-center">
                    <div className="text-center">
                      <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-600">Density heatmap</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Average Flight Time</p>
                    <p className="text-2xl font-bold">12 min</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Coverage Efficiency</p>
                    <p className="text-2xl font-bold">98.5%</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Detection Accuracy</p>
                    <p className="text-2xl font-bold">99.5%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Plot Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-600">Default Drone</label>
                  <select className="mt-1 w-full border rounded p-2">
                    <option>DJI Mavic 3</option>
                    <option>DJI Air 2S</option>
                    <option>DJI Mini 3</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Flight Frequency</label>
                  <select className="mt-1 w-full border rounded p-2">
                    <option>Weekly</option>
                    <option>Bi-weekly</option>
                    <option>Monthly</option>
                    <option>Manual</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Notification Preferences</label>
                  <div className="mt-2 space-y-2">
                    <label className="flex items-center">
                      <input type="checkbox" className="mr-2" defaultChecked />
                      <span className="text-sm">Email me when flights complete</span>
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" className="mr-2" defaultChecked />
                      <span className="text-sm">Alert on significant plant count changes</span>
                    </label>
                  </div>
                </div>
                <Button className="bg-green-700 hover:bg-green-800 text-white">Save Settings</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}