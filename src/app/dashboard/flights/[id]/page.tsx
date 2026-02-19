// app/dashboard/flights/[id]/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { EnhancedSatelliteMap } from '@/components/dynamic-map-wrapper'
import { 
  Download, Share2, FileText, MapPin, Camera, 
  Calendar, Clock, Thermometer, Wind, 
  TrendingUp, AlertCircle, CheckCircle2, Leaf
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell
} from 'recharts'
import Link from 'next/link'

interface FlightDetails {
  id: string
  flight_plan_id: string
  started_at: string
  completed_at: string
  status: string
  images_captured: number
  weather_conditions: any
  flight_plans?: {
    name: string
    drone_model: string
    altitude_m: number
    speed_ms: number
    waypoints: any
    plots?: {
      name: string
      boundaries: any
      area_acres: number
      plant_type: string
    }
  }
  plant_counts?: {
    count: number
    confidence: number
    processing_time_s: number
    density_map_url?: string
    individual_plants?: any[]
    created_at: string
  }[]
  flight_images?: {
    id: string
    image_url: string
    thumbnail_url?: string
    gps_coordinates: any
    captured_at: string
  }[]
}

export default function FlightResultsPage() {
  const params = useParams()
  const flightId = params.id as string
  const { user, isDemo } = useAuth()
  const [flight, setFlight] = useState<FlightDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [heatmapData, setHeatmapData] = useState<any[]>([])

  useEffect(() => {
    loadFlightDetails()
  }, [flightId])

  const loadFlightDetails = async () => {
    if (isDemo) {
      // Load demo data
      setFlight(generateDemoFlightData())
      setHeatmapData(generateDemoHeatmap())
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('flights')
        .select(`
          *,
          flight_plans (
            *,
            plots (*)
          ),
          plant_counts (*),
          flight_images (*)
        `)
        .eq('id', flightId)
        .single()

      if (error) throw error
      setFlight(data)
      
      // Generate heatmap data from plant counts
      if (data.plant_counts?.[0]?.individual_plants) {
        setHeatmapData(processPlantLocations(data.plant_counts[0].individual_plants))
      }
    } catch (err) {
      console.error('Error loading flight:', err)
    } finally {
      setLoading(false)
    }
  }

  const generateDemoFlightData = (): FlightDetails => {
    return {
      id: 'demo-flight-1',
      flight_plan_id: 'demo-plan-1',
      started_at: new Date(Date.now() - 3600000).toISOString(),
      completed_at: new Date(Date.now() - 1800000).toISOString(),
      status: 'completed',
      images_captured: 147,
      weather_conditions: {
        temperature: 72,
        humidity: 65,
        wind_speed: 5,
        wind_direction: 'NW',
        conditions: 'Partly Cloudy'
      },
      flight_plans: {
        name: 'North Field Survey',
        drone_model: 'DJI Mavic 3',
        altitude_m: 30,
        speed_ms: 5,
        waypoints: { type: 'LineString', coordinates: [] },
        plots: {
          name: 'North Field A',
          boundaries: null,
          area_acres: 2.5,
          plant_type: 'Tomatoes'
        }
      },
      plant_counts: [{
        count: 1247,
        confidence: 0.94,
        processing_time_s: 45.3,
        created_at: new Date().toISOString(),
        individual_plants: generateDemoPlants(50)
      }],
      flight_images: Array.from({ length: 6 }, (_, i) => ({
        id: `img-${i}`,
        image_url: `/api/placeholder/400/300`,
        thumbnail_url: `/api/placeholder/100/75`,
        gps_coordinates: { lat: 34.0522 + i * 0.0001, lng: -118.2437 + i * 0.0001 },
        captured_at: new Date(Date.now() - 3000000 + i * 60000).toISOString()
      }))
    }
  }

  const generateDemoPlants = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      confidence: 0.85 + Math.random() * 0.15,
      size: ['small', 'medium', 'large'][Math.floor(Math.random() * 3)]
    }))
  }

  const generateDemoHeatmap = () => {
    const data = []
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        data.push({
          x,
          y,
          value: Math.floor(Math.random() * 20 + 5)
        })
      }
    }
    return data
  }

  const processPlantLocations = (plants: any[]) => {
    // Group plants into grid cells for heatmap
    const gridSize = 50
    const grid: Record<string, number> = {}
    
    plants.forEach(plant => {
      const gridX = Math.floor(plant.x / gridSize)
      const gridY = Math.floor(plant.y / gridSize)
      const key = `${gridX},${gridY}`
      grid[key] = (grid[key] || 0) + 1
    })

    return Object.entries(grid).map(([key, value]) => {
      const [x, y] = key.split(',').map(Number)
      return { x, y, value }
    })
  }

  const exportResults = () => {
    if (!flight) return
    
    const report = {
      flight_id: flight.id,
      date: flight.completed_at,
      plot: flight.flight_plans?.plots?.name,
      plant_count: flight.plant_counts?.[0]?.count,
      confidence: flight.plant_counts?.[0]?.confidence,
      images: flight.images_captured,
      weather: flight.weather_conditions
    }
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flight-report-${flight.id}.json`
    a.click()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    )
  }

  if (!flight) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="pt-6">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-center text-gray-600">Flight not found</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const plantCount = flight.plant_counts?.[0]?.count || 0
  const confidence = flight.plant_counts?.[0]?.confidence || 0
  const processingTime = flight.plant_counts?.[0]?.processing_time_s || 0

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
              <Link href="/dashboard" className="hover:text-gray-700">Dashboard</Link>
              <span>/</span>
              <Link href="/dashboard/flights" className="hover:text-gray-700">Flights</Link>
              <span>/</span>
              <span className="text-gray-700">{flightId}</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">
              {flight.flight_plans?.name || 'Flight Results'}
            </h1>
            <p className="text-gray-600 mt-2">
              {flight.flight_plans?.plots?.name} • {new Date(flight.completed_at).toLocaleString()}
            </p>
          </div>
          
          <div className="flex space-x-3">
            <Button onClick={exportResults} variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
            <Button variant="outline">
              <Share2 className="w-4 h-4 mr-2" />
              Share
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Plants</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-700">{plantCount.toLocaleString()}</div>
              <p className="text-xs text-gray-500 mt-1">
                {(plantCount / (flight.flight_plans?.plots?.area_acres || 1)).toFixed(0)} per acre
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{(confidence * 100).toFixed(1)}%</div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div 
                  className="bg-green-600 h-2 rounded-full" 
                  style={{ width: `${confidence * 100}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Images Captured</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{flight.images_captured}</div>
              <p className="text-xs text-gray-500 mt-1">
                {processingTime.toFixed(1)}s processing
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Coverage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{flight.flight_plans?.plots?.area_acres} acres</div>
              <p className="text-xs text-gray-500 mt-1">
                {flight.flight_plans?.plots?.plant_type}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="heatmap">Density Map</TabsTrigger>
            <TabsTrigger value="images">Images</TabsTrigger>
            <TabsTrigger value="details">Flight Details</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Plant Distribution Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Plant Size Distribution</CardTitle>
                  <CardDescription>Classification by plant size</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={[
                      { size: 'Small', count: 412, percentage: 33 },
                      { size: 'Medium', count: 623, percentage: 50 },
                      { size: 'Large', count: 212, percentage: 17 }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="size" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Confidence Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Detection Confidence</CardTitle>
                  <CardDescription>ML model confidence distribution</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={[
                      { range: '0.8-0.85', count: 89 },
                      { range: '0.85-0.9', count: 234 },
                      { range: '0.9-0.95', count: 567 },
                      { range: '0.95-1.0', count: 357 }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="range" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Weather Conditions */}
            <Card>
              <CardHeader>
                <CardTitle>Flight Conditions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center">
                    <Thermometer className="w-8 h-8 mx-auto text-orange-500 mb-2" />
                    <p className="text-sm font-medium">{flight.weather_conditions?.temperature}°F</p>
                    <p className="text-xs text-gray-500">Temperature</p>
                  </div>
                  <div className="text-center">
                    <Wind className="w-8 h-8 mx-auto text-blue-500 mb-2" />
                    <p className="text-sm font-medium">{flight.weather_conditions?.wind_speed} mph</p>
                    <p className="text-xs text-gray-500">Wind Speed</p>
                  </div>
                  <div className="text-center">
                    <Clock className="w-8 h-8 mx-auto text-gray-500 mb-2" />
                    <p className="text-sm font-medium">
                      {Math.round((new Date(flight.completed_at).getTime() - new Date(flight.started_at).getTime()) / 60000)} min
                    </p>
                    <p className="text-xs text-gray-500">Duration</p>
                  </div>
                  <div className="text-center">
                    <Camera className="w-8 h-8 mx-auto text-purple-500 mb-2" />
                    <p className="text-sm font-medium">{flight.flight_plans?.altitude_m}m</p>
                    <p className="text-xs text-gray-500">Altitude</p>
                  </div>
                  <div className="text-center">
                    <TrendingUp className="w-8 h-8 mx-auto text-green-500 mb-2" />
                    <p className="text-sm font-medium">{flight.flight_plans?.speed_ms} m/s</p>
                    <p className="text-xs text-gray-500">Speed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="heatmap" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Plant Density Heatmap</CardTitle>
                <CardDescription>Spatial distribution of detected plants</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Using ScatterChart to simulate heatmap */}
                <ResponsiveContainer width="100%" height={500}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      type="number" 
                      dataKey="x" 
                      name="X Position" 
                      unit="m"
                      domain={[0, 10]}
                    />
                    <YAxis 
                      type="number" 
                      dataKey="y" 
                      name="Y Position" 
                      unit="m"
                      domain={[0, 10]}
                    />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter 
                      name="Plant Density" 
                      data={heatmapData} 
                      fill="#10b981"
                    >
                      {heatmapData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={
                            entry.value > 15 ? '#dc2626' : 
                            entry.value > 8 ? '#f59e0b' : 
                            '#3b82f6'
                          }
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
                
                {/* Legend */}
                <div className="flex items-center justify-center mt-4 space-x-8">
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 bg-blue-500 rounded"></div>
                    <span className="text-sm">Low (0-5 plants)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 bg-yellow-500 rounded"></div>
                    <span className="text-sm">Medium (6-15 plants)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 bg-red-500 rounded"></div>
                    <span className="text-sm">High (16+ plants)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="images" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Captured Images</CardTitle>
                <CardDescription>
                  {flight.flight_images?.length || 0} images from this flight
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                  {flight.flight_images?.map(image => (
                    <div 
                      key={image.id}
                      className="relative group cursor-pointer"
                      onClick={() => setSelectedImage(image.image_url)}
                    >
                      <div className="aspect-square bg-gray-200 rounded-lg overflow-hidden">
                        <div className="w-full h-full flex items-center justify-center">
                          <Camera className="w-8 h-8 text-gray-400" />
                        </div>
                      </div>
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-opacity rounded-lg flex items-center justify-center">
                        <p className="text-white opacity-0 group-hover:opacity-100 text-xs">
                          View
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Flight Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Flight ID</span>
                    <span className="font-mono text-sm">{flight.id}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Status</span>
                    <Badge className="bg-green-100 text-green-800">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Completed
                    </Badge>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Started</span>
                    <span>{new Date(flight.started_at).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Completed</span>
                    <span>{new Date(flight.completed_at).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-gray-600">Drone Model</span>
                    <span>{flight.flight_plans?.drone_model}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Processing Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">ML Model</span>
                    <span>YOLO v8 Plant</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Processing Time</span>
                    <span>{processingTime.toFixed(1)} seconds</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Images Processed</span>
                    <span>{flight.images_captured}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Average Confidence</span>
                    <span>{(confidence * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-gray-600">Processed At</span>
                    <span>{new Date(flight.plant_counts?.[0]?.created_at || '').toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}