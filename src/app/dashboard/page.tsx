// app/dashboard/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import Image from 'next/image'
import {
  Plane, MapPin, Camera, Leaf,
  ChevronRight, Plus, Upload, BarChart3,
  Clock, Search, Filter, MoreVertical, Edit, Trash2,
  CheckCircle2, AlertCircle, PlayCircle, FileText,
  Activity, Users, Settings, HelpCircle, LogOut,
  Home, Map, Eye, Lock, Layers, QrCode, Table2
} from 'lucide-react'
import Link from 'next/link'

interface DashboardStats {
  totalPlots: number
  totalFlights: number
  totalPlants: number
  pendingUploads: number
  recentFlights: any[]
  upcomingMissions: any[]
  plotsList: any[]
  flightPlans: any[]
}

interface InventoryItem {
  id: string
  species_name: string
  scientific_name?: string
  category?: string
  count: number
  date_counted: string
  plot_name?: string
}

const DEMO_INVENTORY: InventoryItem[] = [
  { id: '1', species_name: 'White Oak', scientific_name: 'Quercus alba', category: 'Tree', count: 1247, date_counted: new Date(Date.now() - 86400000).toISOString(), plot_name: 'North Field A' },
  { id: '2', species_name: 'Red Maple', scientific_name: 'Acer rubrum', category: 'Tree', count: 892, date_counted: new Date(Date.now() - 172800000).toISOString(), plot_name: 'East Grove' },
  { id: '3', species_name: 'Blue Hydrangea', scientific_name: 'Hydrangea macrophylla', category: 'Shrub', count: 456, date_counted: new Date(Date.now() - 259200000).toISOString(), plot_name: 'North Field A' },
  { id: '4', species_name: 'Japanese Maple', scientific_name: 'Acer palmatum', category: 'Tree', count: 234, date_counted: new Date(Date.now() - 345600000).toISOString(), plot_name: 'South Nursery' },
  { id: '5', species_name: 'Boxwood', scientific_name: 'Buxus sempervirens', category: 'Shrub', count: 1890, date_counted: new Date(Date.now() - 432000000).toISOString(), plot_name: 'East Grove' },
]

function DashboardContent() {
  const { user, userProfile, isDemo, signOut } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview')
  const [stats, setStats] = useState<DashboardStats>({
    totalPlots: 0,
    totalFlights: 0,
    totalPlants: 0,
    pendingUploads: 0,
    recentFlights: [],
    upcomingMissions: [],
    plotsList: [],
    flightPlans: []
  })
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [flightSearchQuery, setFlightSearchQuery] = useState('')
  const [userRole, setUserRole] = useState<string>('viewer')
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [inventorySearch, setInventorySearch] = useState('')
  
  const checkRole = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      setUserRole(profile?.role || 'viewer')
    }
  }

  useEffect(() => {
    loadDashboardData()
    checkRole()
  }, [])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const loadDashboardData = async () => {
  console.log('Loading dashboard data...')
  console.log('isDemo from context:', isDemo)
  
  if (isDemo) {
    console.log('Loading demo data...')
    // Your demo data...
    setStats({
        totalPlots: 3,
        totalFlights: 12,
        totalPlants: 14847,
        pendingUploads: 2,
        recentFlights: [
          {
            id: '1',
            name: 'North Field Survey',
            completed_at: new Date().toISOString(),
            plant_count: 1247,
            status: 'completed',
            images_captured: 147,
            flight_plans: { name: 'North Field Survey' },
            plant_counts: [{ count: 1247 }]
          },
          {
            id: '2',
            name: 'Greenhouse Check',
            completed_at: new Date(Date.now() - 86400000).toISOString(),
            plant_count: 892,
            status: 'completed',
            images_captured: 98,
            flight_plans: { name: 'Greenhouse Check' },
            plant_counts: [{ count: 892 }]
          }
        ],
        upcomingMissions: [
          {
            id: '1',
            name: 'Weekly Survey - South',
            scheduled_for: new Date(Date.now() + 86400000).toISOString(),
            plot_name: 'South Nursery',
            drone_model: 'DJI Mavic 3',
            status: 'scheduled'
          }
        ],
        plotsList: [
          {
            id: '1',
            name: 'North Field A',
            area_acres: 2.5,
            plant_type: 'Tomatoes',
            last_surveyed: new Date(Date.now() - 86400000).toISOString(),
            plant_count: 1247
          },
          {
            id: '2',
            name: 'Greenhouse Block B',
            area_acres: 1.8,
            plant_type: 'Peppers',
            last_surveyed: new Date(Date.now() - 172800000).toISOString(),
            plant_count: 892
          },
          {
            id: '3',
            name: 'South Nursery',
            area_acres: 3.2,
            plant_type: 'Mixed Herbs',
            last_surveyed: new Date(Date.now() - 604800000).toISOString(),
            plant_count: 1456
          }
        ],
        flightPlans: [
          {
            id: '1',
            name: 'North Field Survey',
            plot_name: 'North Field A',
            scheduled_for: new Date(Date.now() + 86400000).toISOString(),
            drone_model: 'DJI Mavic 3',
            status: 'scheduled',
            altitude_m: 30, // ~100 ft
            estimated_duration_min: 15
          },
          {
            id: '2',
            name: 'Greenhouse Inspection',
            plot_name: 'Greenhouse Block B',
            scheduled_for: new Date(Date.now() + 172800000).toISOString(),
            drone_model: 'DJI Air 2S',
            status: 'draft',
            altitude_m: 23, // ~75 ft
            estimated_duration_min: 12
          },
          {
            id: '3',
            name: 'Weekly Plant Count',
            plot_name: 'South Nursery',
            scheduled_for: new Date(Date.now() + 259200000).toISOString(),
            drone_model: 'DJI Mavic 3',
            status: 'draft',
            altitude_m: 38, // ~125 ft
            estimated_duration_min: 20
          }
        ]
      })
      setInventory(DEMO_INVENTORY)
      setLoading(false)
      return
    }

    // Real data fetch
    try {
      const [plotsRes, flightsRes, countsRes, plansRes] = await Promise.all([
        supabase.from('plots').select('*').eq('user_id', user?.id),
        supabase.from('flights').select('*, flight_plans(name), plant_counts(count)').eq('user_id', user?.id).order('completed_at', { ascending: false }),
        supabase.from('plant_counts').select('count').eq('user_id', user?.id),
        supabase.from('flight_plans').select('*, plots(name)').eq('user_id', user?.id).order('scheduled_for', { ascending: false })
      ])

      const totalPlants = countsRes.data?.reduce((sum, pc) => sum + pc.count, 0) || 0
      const pendingUploads = flightsRes.data?.filter(f => f.status === 'completed' && !f.plant_counts?.length).length || 0

      setStats({
        totalPlots: plotsRes.data?.length || 0,
        totalFlights: flightsRes.data?.filter(f => f.status === 'completed').length || 0,
        totalPlants,
        pendingUploads,
        recentFlights: flightsRes.data?.slice(0, 5) || [],
        upcomingMissions: plansRes.data?.filter(p => new Date(p.scheduled_for) > new Date()).slice(0, 3) || [],
        plotsList: plotsRes.data || [],
        flightPlans: plansRes.data || []
      })

      // Load inventory from plant detections
      loadInventoryFromDetections()
    } catch (error) {
      console.error('Error loading dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadInventoryFromDetections = async () => {
    try {
      const listRes = await fetch('/api/orthomosaic/list', { cache: 'no-store' })
      if (!listRes.ok) return
      const listData = await listRes.json()
      const completed = (listData.orthomosaics || []).filter((o: any) => o.status === 'completed')
      if (completed.length === 0) return

      const firstOrtho = completed[0]
      const aggRes = await fetch('/api/plant-detection/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orthomosaicId: firstOrtho.id, userId: user?.id }),
      })
      if (!aggRes.ok) return
      const aggData = await aggRes.json()

      const dateCounted = firstOrtho.created_at || new Date().toISOString()
      const items: InventoryItem[] = (aggData.plotCounts || []).map((pc: any, idx: number) => ({
        id: `plot-${pc.plotId}-${idx}`,
        species_name: pc.speciesName || 'Unknown Species',
        category: pc.category,
        count: pc.totalCount,
        date_counted: dateCounted,
        plot_name: pc.plotName,
      }))

      if (aggData.unassignedCount > 0) {
        items.push({
          id: 'unassigned',
          species_name: 'Unassigned',
          count: aggData.unassignedCount,
          date_counted: dateCounted,
        })
      }

      if (items.length > 0) {
        setInventory(items)
      }
    } catch (err) {
      console.error('Error loading inventory from detections:', err)
    }
  }

  const handleDeletePlot = async (plotId: string) => {
    if (!confirm('Are you sure you want to delete this plot?')) return
    
    try {
      const { error } = await supabase
        .from('plots')
        .delete()
        .eq('id', plotId)
        .eq('user_id', user?.id)
      
      if (error) throw error
      loadDashboardData()
    } catch (error) {
      console.error('Error deleting plot:', error)
    }
  }

  const handleDeleteFlightPlan = async (planId: string) => {
    if (!confirm('Are you sure you want to delete this flight plan?')) return
    
    try {
      const { error } = await supabase
        .from('flight_plans')
        .delete()
        .eq('id', planId)
        .eq('user_id', user?.id)
      
      if (error) throw error
      loadDashboardData()
    } catch (error) {
      console.error('Error deleting flight plan:', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link href="/">
              <Image 
                src="/images/plnt-logo.svg" 
                alt="PLNT Logo" 
                width={150} 
                height={50} 
                className="h-12 w-auto" 
                priority 
              />
            </Link>
          </div>
          
          {/* Navigation Tabs */}
          <nav className="hidden md:flex space-x-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`font-medium ${activeTab === 'overview' ? 'text-green-700' : 'text-gray-700 hover:text-green-700'}`}
            >
              Overview
            </button>
            <Link href="/dashboard/plots" className="text-gray-700 hover:text-green-700 font-medium">
              Plots
            </Link>
            <Link href="/dashboard/inventory" className="text-gray-700 hover:text-green-700 font-medium">
              Inventory
            </Link>
            <button
              onClick={() => setActiveTab('flights')}
              className={`font-medium ${activeTab === 'flights' ? 'text-green-700' : 'text-gray-700 hover:text-green-700'}`}
            >
              Flight Plans
            </button>
          </nav>
          
          {/* User Menu */}
          <div className="flex items-center space-x-3">
            <Link href="/dashboard/register-marker">
              <Button className="bg-green-700 hover:bg-green-800 text-white">
                <QrCode className="w-4 h-4 mr-2" />
                Register Marker
              </Button>
            </Link>
            
            <Button 
              variant="outline" 
              onClick={() => signOut()}
              className="text-gray-700 hover:text-red-600"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Admin Quick Access (only for admins) */}
      {userRole === 'admin' && (
        <div className="container mx-auto px-4 mt-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Lock className="w-5 h-5 text-red-600 mr-3" />
                <div>
                  <h3 className="font-semibold text-red-900">Admin Tools Available</h3>
                  <p className="text-sm text-red-700">Access training data management tools</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link href="/dashboard/admin/upload-training">
                  <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100">
                    Upload Training Images
                  </Button>
                </Link>
                <Link href="/dashboard/admin/annotate">
                  <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
                    Annotate Data
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Quick Actions - 4 cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <Link href="/dashboard/register-marker">
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                    <CardContent className="pt-6 text-center">
                      <QrCode className="w-10 h-10 text-pink-600 mb-2 mx-auto" />
                      <h3 className="font-semibold">Register Marker</h3>
                      <p className="text-sm text-gray-500 mt-1">Tag plants in field</p>
                    </CardContent>
                  </Card>
                </Link>

                <Link href="/dashboard/orthomosaic">
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                    <CardContent className="pt-6 text-center">
                      <Layers className="w-10 h-10 text-teal-600 mb-2 mx-auto" />
                      <h3 className="font-semibold">Create Orthomosaic</h3>
                      <p className="text-sm text-gray-500 mt-1">Stitch drone images</p>
                    </CardContent>
                  </Card>
                </Link>

                <Link href="/dashboard/analytics/orthomosaic">
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                    <CardContent className="pt-6 text-center">
                      <Map className="w-10 h-10 text-indigo-600 mb-2 mx-auto" />
                      <h3 className="font-semibold">View Orthomosaics</h3>
                      <p className="text-sm text-gray-500 mt-1">Label plants on maps</p>
                    </CardContent>
                  </Card>
                </Link>

                <Link href="/dashboard/upload">
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                    <CardContent className="pt-6 text-center">
                      <Camera className="w-10 h-10 text-orange-600 mb-2 mx-auto" />
                      <h3 className="font-semibold">Upload Images</h3>
                      <p className="text-sm text-gray-500 mt-1">Process drone photos</p>
                    </CardContent>
                  </Card>
                </Link>
              </div>

              {/* Inventory Table */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Table2 className="h-5 w-5 text-purple-600" />
                        Inventory
                      </CardTitle>
                      <CardDescription>
                        {inventory.length} species • {inventory.reduce((sum, item) => sum + item.count, 0).toLocaleString()} total plants
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                        <Input
                          type="search"
                          placeholder="Search..."
                          value={inventorySearch}
                          onChange={(e) => setInventorySearch(e.target.value)}
                          className="pl-8 w-48"
                        />
                      </div>
                      <Link href="/dashboard/inventory">
                        <Button variant="outline" size="sm">
                          View All
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {inventory.length === 0 ? (
                    <div className="text-center py-8">
                      <Table2 className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p className="text-gray-500">No inventory data yet</p>
                      <p className="text-sm text-gray-400 mt-1">Start by registering markers or processing images</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Species</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Count</TableHead>
                          <TableHead>Date Counted</TableHead>
                          <TableHead>Plot</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inventory
                          .filter(item =>
                            item.species_name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
                            item.scientific_name?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
                            item.plot_name?.toLowerCase().includes(inventorySearch.toLowerCase())
                          )
                          .slice(0, 10)
                          .map((item) => (
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
                                  <Badge variant="outline" className="text-xs">{item.category}</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {item.count.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-sm">
                                {new Date(item.date_counted).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="text-sm text-gray-600">
                                {item.plot_name || '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* Plots Tab */}
          {activeTab === 'plots' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Input
                  type="search"
                  placeholder="Search plots..."
                  className="w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Link href="/dashboard/plots/new">
                  <Button className="bg-green-700 hover:bg-green-800 text-white">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Plot
                  </Button>
                </Link>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {stats.plotsList.filter(plot => 
                  plot.name.toLowerCase().includes(searchQuery.toLowerCase())
                ).map(plot => (
                  <Card key={plot.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">{plot.name}</CardTitle>
                      <CardDescription>{plot.plant_type}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Area</span>
                          <span className="font-medium">{plot.area_acres} acres</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Plant Count</span>
                          <span className="font-medium">{plot.plant_count?.toLocaleString() || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Last Survey</span>
                          <span className="font-medium">
                            {plot.last_surveyed 
                              ? new Date(plot.last_surveyed).toLocaleDateString()
                              : 'Never'}
                          </span>
                        </div>
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="space-y-2">
                        <Link href={`/dashboard/flight-planner?plot=${plot.id}`}>
                          <Button className="w-full bg-green-700 hover:bg-green-800 text-white">
                            <Plane className="w-4 h-4 mr-2" />
                            Schedule Survey
                          </Button>
                        </Link>
                        <div className="flex gap-2">
                          <Button 
                            className="flex-1" 
                            variant="outline"
                            onClick={() => router.push(`/dashboard/plots/${plot.id}`)}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <Button 
                            className="flex-1 hover:bg-red-50 hover:text-red-700 hover:border-red-300" 
                            variant="outline"
                            onClick={() => handleDeletePlot(plot.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Flight Plans Tab */}
          {activeTab === 'flights' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Input
                  type="search"
                  placeholder="Search flight plans..."
                  className="w-64"
                  value={flightSearchQuery}
                  onChange={(e) => setFlightSearchQuery(e.target.value)}
                />
                <Link href="/dashboard/flight-planner">
                  <Button className="bg-green-700 hover:bg-green-800 text-white">
                    <Plus className="w-4 h-4 mr-2" />
                    New Flight Plan
                  </Button>
                </Link>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {stats.flightPlans.filter(plan => 
                  plan.name.toLowerCase().includes(flightSearchQuery.toLowerCase()) ||
                  (plan.plot_name && plan.plot_name.toLowerCase().includes(flightSearchQuery.toLowerCase()))
                ).map(plan => (
                  <Card key={plan.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <CardDescription>{plan.plots?.name || plan.plot_name || 'Custom Area'}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Scheduled</span>
                          <span className="font-medium">
                            {new Date(plan.scheduled_for).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Drone</span>
                          <span className="font-medium">{plan.drone_model}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Altitude</span>
                          <span className="font-medium">{Math.round(plan.altitude_m * 3.28084)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Duration</span>
                          <span className="font-medium">{plan.estimated_duration_min} min</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Status</span>
                          <Badge variant={
                            plan.status === 'completed' ? 'default' :
                            plan.status === 'scheduled' ? 'secondary' :
                            'outline'
                          }>
                            {plan.status}
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="space-y-2">
                        <Link href={`/dashboard/flight-plans?=${plan.id}`}>
                          <Button className="w-full bg-green-700 hover:bg-green-800 text-white">
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </Button>
                        </Link>
                        <div className="flex gap-2">
                          <Button 
                            className="flex-1" 
                            variant="outline"
                            onClick={() => router.push(`/dashboard/flight-planner?edit=${plan.id}`)}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <Button 
                            className="flex-1 hover:bg-red-50 hover:text-red-700 hover:border-red-300" 
                            variant="outline"
                            onClick={() => handleDeleteFlightPlan(plan.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Results Tab */}
          {activeTab === 'results' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Processing Results</h3>
                <Link href="/dashboard/analytics">
                  <Button variant="outline">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    View Analytics
                  </Button>
                </Link>
              </div>

              <div className="grid gap-4">
                {stats.recentFlights.filter(f => f.plant_counts?.length > 0).map(flight => (
                  <Card key={flight.id}>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <CheckCircle2 className="w-8 h-8 text-green-600" />
                          <div>
                            <h4 className="font-semibold">{flight.flight_plans?.name}</h4>
                            <p className="text-sm text-gray-500">
                              Completed {new Date(flight.completed_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-green-600">
                            {flight.plant_counts?.[0]?.count?.toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-500">plants detected</p>
                        </div>
                        <Link href={`/dashboard/flights/${flight.id}`}>
                          <Button variant="outline">View Details</Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default function DashboardPage() {
  const { user, loading, isDemo, setIsDemo } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  useEffect(() => {
    // Check if demo parameter is in URL
    const demoParam = searchParams.get('demo')
    if (demoParam === 'true') {
      setIsDemo(true)
    }
  }, [searchParams, setIsDemo])
  
  useEffect(() => {
    console.log('Dashboard auth check - user:', user, 'isDemo:', isDemo, 'loading:', loading)
    
    // Only redirect if loading is complete AND no access
    if (!loading && !user && !isDemo) {
      console.log('No access, redirecting to signin...')
      router.push('/auth/signin')
    }
  }, [user, loading, isDemo, router])
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    )
  }
  
  // Allow access if authenticated OR in demo mode
  if (!user && !isDemo) {
    console.log('No access after loading complete')
    return null
  }
  
  console.log('Rendering dashboard content - isDemo:', isDemo, 'user:', user)
  return <DashboardContent />
}