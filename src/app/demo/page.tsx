// app/demo/page.tsx
'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import Image from 'next/image'
import { 
  Plane, MapPin, Camera, Leaf, TrendingUp,
  Calendar, ChevronRight, Plus, Upload, BarChart3, 
  Clock, Search, Filter, MoreVertical, Edit, Trash2,
  CheckCircle2, AlertCircle, PlayCircle, FileText,
  Activity, Users, Settings, HelpCircle, LogOut,
  Home, Map, Eye, Lock, X
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

function DemoPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [flightSearchQuery, setFlightSearchQuery] = useState('')
  
  // Static demo data
  const stats: DashboardStats = {
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
        altitude_m: 30,
        estimated_duration_min: 15
      },
      {
        id: '2',
        name: 'Greenhouse Inspection',
        plot_name: 'Greenhouse Block B',
        scheduled_for: new Date(Date.now() + 172800000).toISOString(),
        drone_model: 'DJI Air 2S',
        status: 'draft',
        altitude_m: 25,
        estimated_duration_min: 12
      },
      {
        id: '3',
        name: 'Weekly Plant Count',
        plot_name: 'South Nursery',
        scheduled_for: new Date(Date.now() + 259200000).toISOString(),
        drone_model: 'DJI Mavic 3',
        status: 'draft',
        altitude_m: 35,
        estimated_duration_min: 20
      }
    ]
  }

  const handleDemoAction = (action: string) => {
    alert(`Demo Mode: ${action} action would be performed in the full version`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Demo Mode Banner */}
      <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Badge className="bg-yellow-600 text-white">DEMO MODE</Badge>
            <span className="text-sm text-yellow-800">
              You're viewing sample data. Contact us for full access.
            </span>
          </div>
          <Link href="/#contact">
            <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white">
              Get your inventory
            </Button>
          </Link>
        </div>
      </div>

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
            <button 
              onClick={() => setActiveTab('plots')}
              className={`font-medium ${activeTab === 'plots' ? 'text-green-700' : 'text-gray-700 hover:text-green-700'}`}
            >
              Plots
            </button>
            <button 
              onClick={() => setActiveTab('flights')}
              className={`font-medium ${activeTab === 'flights' ? 'text-green-700' : 'text-gray-700 hover:text-green-700'}`}
            >
              Flight Plans
            </button>
            <button 
              onClick={() => setActiveTab('results')}
              className={`font-medium ${activeTab === 'results' ? 'text-green-700' : 'text-gray-700 hover:text-green-700'}`}
            >
              Results
            </button>
            <button 
              onClick={() => handleDemoAction('Analytics')}
              className="text-gray-700 hover:text-green-700 font-medium"
            >
              Analytics
            </button>
          </nav>
          
          {/* User Menu */}
          <div className="flex items-center space-x-3">
            <Button 
              onClick={() => handleDemoAction('New Flight')}
              className="bg-green-700 hover:bg-green-800 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Flight
            </Button>
            
            <Button 
              variant="outline" 
              onClick={() => router.push('/')}
              className="text-gray-700"
            >
              <X className="w-4 h-4 mr-2" />
              Exit Demo
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Quick Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Plots</CardTitle>
                    <MapPin className="h-4 w-4 text-gray-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.totalPlots}</div>
                    <p className="text-xs text-gray-500 mt-1">Active areas</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completed Flights</CardTitle>
                    <Plane className="h-4 w-4 text-gray-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.totalFlights}</div>
                    <p className="text-xs text-gray-500 mt-1">Total missions</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Plants Counted</CardTitle>
                    <Leaf className="h-4 w-4 text-gray-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.totalPlants.toLocaleString()}</div>
                    <p className="text-xs text-green-600 mt-1 flex items-center">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      +12% vs last month
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Pending Uploads</CardTitle>
                    <Upload className="h-4 w-4 text-gray-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.pendingUploads}</div>
                    <p 
                      className="text-xs text-blue-600 mt-1 hover:underline cursor-pointer"
                      onClick={() => handleDemoAction('Upload')}
                    >
                      Upload now →
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Quick Actions */}
              <div className="grid md:grid-cols-4 gap-4 mb-6">
                <Card 
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => handleDemoAction('New Flight Plan')}
                >
                  <CardContent className="pt-6">
                    <Plus className="w-8 h-8 text-green-600 mb-2" />
                    <h3 className="font-semibold">New Flight Plan</h3>
                    <p className="text-sm text-gray-500 mt-1">Create mission</p>
                  </CardContent>
                </Card>

                <Card 
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => handleDemoAction('Test Flight')}
                >
                  <CardContent className="pt-6">
                    <Plane className="w-8 h-8 text-blue-600 mb-2" />
                    <h3 className="font-semibold">Test Flight</h3>
                    <p className="text-sm text-gray-500 mt-1">Simulate mission</p>
                  </CardContent>
                </Card>

                <Card 
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => handleDemoAction('Upload Images')}
                >
                  <CardContent className="pt-6">
                    <Camera className="w-8 h-8 text-purple-600 mb-2" />
                    <h3 className="font-semibold">Upload Images</h3>
                    <p className="text-sm text-gray-500 mt-1">Process photos</p>
                  </CardContent>
                </Card>

                <Card 
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => handleDemoAction('View Analytics')}
                >
                  <CardContent className="pt-6">
                    <BarChart3 className="w-8 h-8 text-orange-600 mb-2" />
                    <h3 className="font-semibold">View Analytics</h3>
                    <p className="text-sm text-gray-500 mt-1">Track trends</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                {/* Recent Flights */}
                <Card>
                  <CardHeader>
                    <CardTitle>Recent Flights</CardTitle>
                    <CardDescription>Your latest completed missions</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {stats.recentFlights.map(flight => (
                      <div key={flight.id} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{flight.flight_plans?.name || 'Unnamed'}</p>
                          <p className="text-sm text-gray-500">
                            {new Date(flight.completed_at).toLocaleDateString()} • 
                            {flight.plant_counts?.[0]?.count || 0} plants
                          </p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDemoAction('View Flight')}
                        >
                          View
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Upcoming Missions */}
                <Card>
                  <CardHeader>
                    <CardTitle>Upcoming Missions</CardTitle>
                    <CardDescription>Scheduled flight plans</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {stats.upcomingMissions.map(mission => (
                      <div key={mission.id} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{mission.name}</p>
                          <p className="text-sm text-gray-500">
                            {mission.plot_name} • {new Date(mission.scheduled_for).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge>{mission.status}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
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
                <Button 
                  className="bg-green-700 hover:bg-green-800 text-white"
                  onClick={() => handleDemoAction('Add Plot')}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Plot
                </Button>
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
                      
                      <div className="space-y-2">
                        <Button 
                          className="w-full bg-green-700 hover:bg-green-800 text-white"
                          onClick={() => handleDemoAction('Schedule Survey')}
                        >
                          <Plane className="w-4 h-4 mr-2" />
                          Schedule Survey
                        </Button>
                        <div className="flex gap-2">
                          <Button 
                            className="flex-1" 
                            variant="outline"
                            onClick={() => handleDemoAction('Edit Plot')}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <Button 
                            className="flex-1 hover:bg-red-50 hover:text-red-700 hover:border-red-300" 
                            variant="outline"
                            onClick={() => handleDemoAction('Delete Plot')}
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
                <Button 
                  className="bg-green-700 hover:bg-green-800 text-white"
                  onClick={() => handleDemoAction('New Flight Plan')}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Flight Plan
                </Button>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {stats.flightPlans.filter(plan => 
                  plan.name.toLowerCase().includes(flightSearchQuery.toLowerCase()) ||
                  (plan.plot_name && plan.plot_name.toLowerCase().includes(flightSearchQuery.toLowerCase()))
                ).map(plan => (
                  <Card key={plan.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <CardDescription>{plan.plot_name || 'Custom Area'}</CardDescription>
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
                          <span className="font-medium">{plan.altitude_m}m</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Duration</span>
                          <span className="font-medium">{plan.estimated_duration_min} min</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Status</span>
                          <Badge>{plan.status}</Badge>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Button 
                          className="w-full bg-green-700 hover:bg-green-800 text-white"
                          onClick={() => handleDemoAction('View Details')}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                        <div className="flex gap-2">
                          <Button 
                            className="flex-1" 
                            variant="outline"
                            onClick={() => handleDemoAction('Edit Flight Plan')}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <Button 
                            className="flex-1 hover:bg-red-50 hover:text-red-700 hover:border-red-300" 
                            variant="outline"
                            onClick={() => handleDemoAction('Delete Flight Plan')}
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
                <Button 
                  variant="outline"
                  onClick={() => handleDemoAction('View Analytics')}
                >
                  <BarChart3 className="w-4 h-4 mr-2" />
                  View Analytics
                </Button>
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
                        <Button 
                          variant="outline"
                          onClick={() => handleDemoAction('View Details')}
                        >
                          View Details
                        </Button>
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
// Main component with Suspense wrapper
export default function DemoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    }>
      <DemoPageContent />
    </Suspense>
  )
}