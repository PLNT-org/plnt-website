// app/dashboard/analytics/soil-moisture/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { 
  Droplets, 
  AlertCircle, 
  TrendingDown, 
  TrendingUp,
  Calendar,
  Cloud,
  Thermometer,
  Activity,
  MapPin,
  Download,
  RefreshCw,
  Settings,
  Eye,
  Clock,
  Zap,
  CloudRain,
  Sun,
  CloudDrizzle,
  Wind
} from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, RadialBarChart, RadialBar, PolarAngleAxis
} from 'recharts'
import Link from 'next/link'

interface MoistureZone {
  id: string
  name: string
  plantType: string
  containerSize: string
  plantCount: number
  currentMoisture: number
  targetMoisture: number
  lastIrrigation: string
  nextIrrigation: string
  status: 'optimal' | 'dry' | 'critical' | 'overwatered'
  ndwiIndex: number
  tempVariance: number
  evapotranspiration: number
}

interface IrrigationSchedule {
  zoneId: string
  zoneName: string
  scheduledTime: string
  duration: number
  priority: 'critical' | 'high' | 'normal' | 'low'
  waterVolume: number
  status: 'pending' | 'in-progress' | 'completed' | 'skipped'
}

interface WeatherData {
  day: string
  icon: string
  precipitation: number
  temperature: number
  humidity: number
}

export default function SoilMoistureAnalyticsPage() {
  const { user, isDemo } = useAuth()
  const [selectedPlot, setSelectedPlot] = useState<string>('all')
  const [dateRange, setDateRange] = useState('7d')
  const [moistureZones, setMoistureZones] = useState<MoistureZone[]>([])
  const [irrigationSchedule, setIrrigationSchedule] = useState<IrrigationSchedule[]>([])
  const [weatherForecast, setWeatherForecast] = useState<WeatherData[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'thermal' | 'ndwi' | 'rgb'>('ndwi')
  const [autoIrrigation, setAutoIrrigation] = useState(true)
  const [criticalThreshold, setCriticalThreshold] = useState([25])
  const [optimalRange, setOptimalRange] = useState([40, 60])

  // Stats calculations
  const avgMoisture = moistureZones.length > 0 
    ? Math.round(moistureZones.reduce((acc, z) => acc + z.currentMoisture, 0) / moistureZones.length)
    : 0
  const criticalZones = moistureZones.filter(z => z.status === 'critical').length
  const dryZones = moistureZones.filter(z => z.status === 'dry').length
  const totalWaterUsage = irrigationSchedule
    .filter(s => s.status === 'completed')
    .reduce((acc, s) => acc + s.waterVolume, 0)
  const avgEvapotranspiration = moistureZones.length > 0
    ? (moistureZones.reduce((acc, z) => acc + z.evapotranspiration, 0) / moistureZones.length).toFixed(2)
    : 0

  useEffect(() => {
    loadMoistureData()
  }, [selectedPlot, dateRange])

  const loadMoistureData = async () => {
    if (isDemo) {
      // Generate demo data
      setMoistureZones(generateDemoZones())
      setIrrigationSchedule(generateDemoSchedule())
      setWeatherForecast(generateDemoWeather())
      setLoading(false)
      return
    }

    // Load real data from Supabase
    try {
      // Load moisture data from latest flight with thermal/multispectral data
      const { data: moistureData, error } = await supabase
        .from('moisture_analysis')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

      if (moistureData) {
        setMoistureZones(moistureData)
      }

      // Load irrigation schedule
      const { data: scheduleData } = await supabase
        .from('irrigation_schedule')
        .select('*')
        .gte('scheduled_time', new Date().toISOString())
        .order('scheduled_time', { ascending: true })

      if (scheduleData) {
        setIrrigationSchedule(scheduleData)
      }

      setLoading(false)
    } catch (error) {
      console.error('Error loading moisture data:', error)
      setLoading(false)
    }
  }

  const generateDemoZones = (): MoistureZone[] => {
    return [
      {
        id: '1',
        name: 'Zone A1',
        plantType: 'Japanese Maples',
        containerSize: '3-gal',
        plantCount: 1250,
        currentMoisture: 52,
        targetMoisture: 55,
        lastIrrigation: '8 hours ago',
        nextIrrigation: 'Tomorrow 6:00 AM',
        status: 'optimal',
        ndwiIndex: 0.68,
        tempVariance: 2.3,
        evapotranspiration: 0.22
      },
      {
        id: '2',
        name: 'Zone B3',
        plantType: 'Azaleas',
        containerSize: '5-gal',
        plantCount: 875,
        currentMoisture: 23,
        targetMoisture: 50,
        lastIrrigation: '36 hours ago',
        nextIrrigation: 'Immediate',
        status: 'critical',
        ndwiIndex: 0.31,
        tempVariance: 5.8,
        evapotranspiration: 0.28
      },
      {
        id: '3',
        name: 'Zone B4',
        plantType: 'Hydrangeas',
        containerSize: '5-gal',
        plantCount: 620,
        currentMoisture: 28,
        targetMoisture: 55,
        lastIrrigation: '24 hours ago',
        nextIrrigation: 'Today 6:00 PM',
        status: 'dry',
        ndwiIndex: 0.38,
        tempVariance: 4.2,
        evapotranspiration: 0.26
      },
      {
        id: '4',
        name: 'Zone C2',
        plantType: 'Rhododendrons',
        containerSize: '7-gal',
        plantCount: 450,
        currentMoisture: 78,
        targetMoisture: 60,
        lastIrrigation: '4 hours ago',
        nextIrrigation: 'Skip next cycle',
        status: 'overwatered',
        ndwiIndex: 0.89,
        tempVariance: 1.2,
        evapotranspiration: 0.18
      },
      {
        id: '5',
        name: 'Zone D1',
        plantType: 'Boxwood',
        containerSize: '3-gal',
        plantCount: 980,
        currentMoisture: 45,
        targetMoisture: 50,
        lastIrrigation: '12 hours ago',
        nextIrrigation: 'Tomorrow 8:00 AM',
        status: 'optimal',
        ndwiIndex: 0.58,
        tempVariance: 2.8,
        evapotranspiration: 0.24
      }
    ]
  }

  const generateDemoSchedule = (): IrrigationSchedule[] => {
    return [
      {
        zoneId: '2',
        zoneName: 'Zone B3 - Azaleas',
        scheduledTime: 'Immediate',
        duration: 45,
        priority: 'critical',
        waterVolume: 850,
        status: 'pending'
      },
      {
        zoneId: '3',
        zoneName: 'Zone B4 - Hydrangeas',
        scheduledTime: 'Today 6:00 PM',
        duration: 30,
        priority: 'high',
        waterVolume: 620,
        status: 'pending'
      },
      {
        zoneId: '1',
        zoneName: 'Zone A1 - Japanese Maples',
        scheduledTime: 'Tomorrow 6:00 AM',
        duration: 25,
        priority: 'normal',
        waterVolume: 480,
        status: 'pending'
      },
      {
        zoneId: '5',
        zoneName: 'Zone D1 - Boxwood',
        scheduledTime: 'Tomorrow 8:00 AM',
        duration: 20,
        priority: 'normal',
        waterVolume: 380,
        status: 'pending'
      }
    ]
  }

  const generateDemoWeather = (): WeatherData[] => {
    return [
      { day: 'Today', icon: '☀️', precipitation: 0, temperature: 72, humidity: 45 },
      { day: 'Thu', icon: '⛅', precipitation: 0.1, temperature: 70, humidity: 50 },
      { day: 'Fri', icon: '🌧️', precipitation: 0.85, temperature: 65, humidity: 78 },
      { day: 'Sat', icon: '☁️', precipitation: 0, temperature: 68, humidity: 60 },
      { day: 'Sun', icon: '☀️', precipitation: 0, temperature: 75, humidity: 42 }
    ]
  }

  // Generate moisture trend data for chart
  const moistureTrendData = Array.from({ length: 7 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - i))
    return {
      date: date.toLocaleDateString('en', { weekday: 'short' }),
      optimal: 55,
      average: avgMoisture - (6 - i) * 2 + Math.random() * 10,
      critical: 25
    }
  })

  const getMoistureColor = (moisture: number) => {
    if (moisture < 25) return 'text-red-600'
    if (moisture < 40) return 'text-orange-600'
    if (moisture > 70) return 'text-blue-600'
    return 'text-green-600'
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'critical': return 'destructive'
      case 'dry': return 'outline'
      case 'optimal': return 'secondary'
      case 'overwatered': return 'default'
      default: return 'secondary'
    }
  }

  const getPriorityBadgeVariant = (priority: string) => {
    switch (priority) {
      case 'critical': return 'destructive'
      case 'high': return 'outline'
      default: return 'secondary'
    }
  }

  const handleOptimizeSchedule = () => {
    // Implement schedule optimization logic
    alert('Optimizing irrigation schedule based on weather forecast and current moisture levels...')
  }

  const handleExportData = () => {
    // Implement data export
    alert('Exporting moisture data...')
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Soil Moisture Analytics</h1>
            <p className="text-gray-600 mt-1">Monitor and manage irrigation across all zones</p>
          </div>
        <div className="flex gap-3">
          <Select value={selectedPlot} onValueChange={setSelectedPlot}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select plot" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Plots</SelectItem>
              <SelectItem value="north">North Field</SelectItem>
              <SelectItem value="south">South Field</SelectItem>
              <SelectItem value="greenhouse">Greenhouse</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={loadMoistureData} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={handleExportData}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Critical Alert */}
      {criticalZones > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <div className="flex justify-between items-center w-full">
            <div>
              <AlertDescription className="text-red-900 font-semibold">
                Irrigation Alert: {criticalZones} zone{criticalZones > 1 ? 's' : ''} critically low on moisture
              </AlertDescription>
              <AlertDescription className="text-red-700">
                Zones {moistureZones.filter(z => z.status === 'critical').map(z => z.name).join(', ')} require immediate irrigation
              </AlertDescription>
            </div>
            <Button 
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => alert('Initiating emergency irrigation...')}
            >
              <Droplets className="w-4 h-4 mr-2" />
              Start Irrigation
            </Button>
          </div>
        </Alert>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Moisture</CardTitle>
            <Droplets className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgMoisture}%</div>
            <div className="flex items-center text-xs text-gray-600 mt-1">
              {avgMoisture < 40 ? (
                <>
                  <TrendingDown className="h-3 w-3 text-red-600 mr-1" />
                  <span className="text-red-600">8% from yesterday</span>
                </>
              ) : (
                <>
                  <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
                  <span className="text-green-600">3% from yesterday</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Zones Need Water</CardTitle>
            <AlertCircle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{criticalZones + dryZones}</div>
            <p className="text-xs text-gray-600 mt-1">
              {criticalZones} critical, {dryZones} dry
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Water Usage Today</CardTitle>
            <Activity className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalWaterUsage.toLocaleString()} gal</div>
            <p className="text-xs text-green-600 mt-1">12% below average</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Evapotranspiration</CardTitle>
            <Thermometer className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgEvapotranspiration}"</div>
            <p className="text-xs text-gray-600 mt-1">Daily average</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Next Irrigation</CardTitle>
            <Clock className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {irrigationSchedule.find(s => s.priority === 'critical') ? 'Now' : '6:00 PM'}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              {irrigationSchedule.filter(s => s.status === 'pending').length} zones scheduled
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Weather Forecast */}
      <Card className="bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Weather Forecast & Irrigation Planning</CardTitle>
              <CardDescription>Optimize irrigation based on upcoming weather</CardDescription>
            </div>
            <Button 
              variant="outline" 
              onClick={handleOptimizeSchedule}
              className="bg-white"
            >
              <Zap className="w-4 h-4 mr-2" />
              Optimize Schedule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            {weatherForecast.map((day, index) => (
              <div 
                key={index} 
                className="bg-white rounded-lg p-4 text-center border border-blue-100"
              >
                <p className="text-sm font-medium text-gray-600 mb-2">{day.day}</p>
                <div className="text-3xl mb-2">{day.icon}</div>
                <p className="text-lg font-bold text-gray-900">{day.temperature}°F</p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-center text-xs">
                    <Droplets className="w-3 h-3 mr-1 text-blue-600" />
                    <span>{day.precipitation}"</span>
                  </div>
                  <div className="flex items-center justify-center text-xs">
                    <Wind className="w-3 h-3 mr-1 text-gray-600" />
                    <span>{day.humidity}%</span>
                  </div>
                </div>
                {day.precipitation > 0.5 && (
                  <Badge variant="secondary" className="mt-2 text-xs">
                    Skip irrigation
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="zones" className="space-y-4">
        <TabsList>
          <TabsTrigger value="zones">Zone Status</TabsTrigger>
          <TabsTrigger value="map">Moisture Map</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="schedule">Irrigation Schedule</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Zone Status Tab */}
        <TabsContent value="zones" className="space-y-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Zone Moisture Status</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Filter Critical
              </Button>
              <Button variant="outline" size="sm">
                Sort by Moisture
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {moistureZones.map(zone => (
              <Card key={zone.id} className={zone.status === 'critical' ? 'border-red-300' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{zone.name}</CardTitle>
                      <CardDescription>
                        {zone.plantType} • {zone.plantCount} plants • {zone.containerSize}
                      </CardDescription>
                    </div>
                    <Badge variant={getStatusBadgeVariant(zone.status)}>
                      {zone.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-600">Moisture Level</span>
                      <span className={`text-2xl font-bold ${getMoistureColor(zone.currentMoisture)}`}>
                        {zone.currentMoisture}%
                      </span>
                    </div>
                    <Progress 
                      value={zone.currentMoisture} 
                      className="h-2"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>Target: {zone.targetMoisture}%</span>
                      <span>{Math.abs(zone.currentMoisture - zone.targetMoisture)}% difference</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t">
                    <div>
                      <p className="text-xs text-gray-500">Last Irrigation</p>
                      <p className="text-sm font-medium">{zone.lastIrrigation}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Next Scheduled</p>
                      <p className="text-sm font-medium">
                        {zone.status === 'critical' ? (
                          <span className="text-red-600">Immediate</span>
                        ) : zone.status === 'overwatered' ? (
                          <span className="text-blue-600">Skip cycle</span>
                        ) : (
                          zone.nextIrrigation
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">NDWI Index</p>
                      <p className="text-sm font-medium">{zone.ndwiIndex}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Temp Variance</p>
                      <p className="text-sm font-medium">{zone.tempVariance}°C</p>
                    </div>
                  </div>

                  {zone.status === 'critical' && (
                    <Button className="w-full bg-red-600 hover:bg-red-700 text-white">
                      <Droplets className="w-4 h-4 mr-2" />
                      Start Irrigation Now
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Moisture Map Tab */}
        <TabsContent value="map" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Moisture Heat Map</CardTitle>
                <div className="flex gap-2">
                  <Button 
                    variant={viewMode === 'ndwi' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('ndwi')}
                  >
                    NDWI View
                  </Button>
                  <Button 
                    variant={viewMode === 'thermal' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('thermal')}
                  >
                    Thermal View
                  </Button>
                  <Button 
                    variant={viewMode === 'rgb' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('rgb')}
                  >
                    RGB View
                  </Button>
                  <Button variant="outline" size="sm">
                    <Eye className="w-4 h-4 mr-2" />
                    Time Lapse
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-96 bg-gray-100 rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <MapPin className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">Interactive Moisture Heat Map</p>
                  <p className="text-sm text-gray-500 mt-2">
                    Showing {viewMode.toUpperCase()} data from last flight (2 hours ago)
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Click zones for detailed metrics</p>
                </div>
              </div>
              
              {/* Legend */}
              <div className="mt-4 flex items-center justify-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-500 rounded"></div>
                  <span className="text-sm">Critical (&lt;25%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-orange-500 rounded"></div>
                  <span className="text-sm">Dry (25-40%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded"></div>
                  <span className="text-sm">Optimal (40-60%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-500 rounded"></div>
                  <span className="text-sm">Wet (&gt;60%)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-4">
          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Moisture Trends</CardTitle>
                  <Select value={dateRange} onValueChange={setDateRange}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">24 Hours</SelectItem>
                      <SelectItem value="7d">7 Days</SelectItem>
                      <SelectItem value="30d">30 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <CardDescription>Average moisture levels with irrigation events</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={moistureTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="average" 
                      stroke="#10b981" 
                      fill="#10b981" 
                      fillOpacity={0.3}
                      name="Average Moisture"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="optimal" 
                      stroke="#3b82f6" 
                      strokeDasharray="5 5"
                      name="Optimal Level"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="critical" 
                      stroke="#ef4444" 
                      strokeDasharray="5 5"
                      name="Critical Level"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Zone Performance</CardTitle>
                <CardDescription>Moisture maintenance by zone</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={moistureZones}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="currentMoisture" name="Current" fill="#10b981" />
                    <Bar dataKey="targetMoisture" name="Target" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Water Usage Analysis</CardTitle>
              <CardDescription>Daily water consumption across all zones</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={moistureTrendData.map((d, i) => ({
                  ...d,
                  waterUsage: 2000 + Math.random() * 1000 - i * 50
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="waterUsage" 
                    stroke="#06b6d4" 
                    name="Water Usage (gal)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Irrigation Schedule Tab */}
        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Smart Irrigation Schedule</CardTitle>
                  <CardDescription>AI-optimized based on weather and moisture data</CardDescription>
                </div>
                <Button onClick={handleOptimizeSchedule}>
                  <Zap className="w-4 h-4 mr-2" />
                  Optimize Schedule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {irrigationSchedule.map((schedule, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-12 rounded-full ${
                        schedule.priority === 'critical' ? 'bg-red-500' :
                        schedule.priority === 'high' ? 'bg-orange-500' :
                        'bg-gray-400'
                      }`} />
                      <div>
                        <p className="font-medium">{schedule.zoneName}</p>
                        <div className="flex items-center gap-4 mt-1">
                          <span className="text-sm text-gray-600">
                            <Clock className="w-3 h-3 inline mr-1" />
                            {schedule.scheduledTime}
                          </span>
                          <span className="text-sm text-gray-600">
                            Duration: {schedule.duration} min
                          </span>
                          <span className="text-sm text-gray-600">
                            Volume: {schedule.waterVolume} gal
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={getPriorityBadgeVariant(schedule.priority)}>
                        {schedule.priority}
                      </Badge>
                      {schedule.priority === 'critical' ? (
                        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
                          Start Now
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline">
                          Reschedule
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Irrigation Settings</CardTitle>
              <CardDescription>Configure automatic irrigation parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Automatic Irrigation</Label>
                  <p className="text-sm text-gray-600">Enable AI-powered irrigation scheduling</p>
                </div>
                <Button 
                  variant={autoIrrigation ? 'default' : 'outline'}
                  onClick={() => setAutoIrrigation(!autoIrrigation)}
                >
                  {autoIrrigation ? 'Enabled' : 'Disabled'}
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <Label>Critical Moisture Threshold</Label>
                  <p className="text-sm text-gray-600 mb-2">
                    Trigger immediate irrigation below: {criticalThreshold[0]}%
                  </p>
                  <Slider 
                    value={criticalThreshold}
                    onValueChange={setCriticalThreshold}
                    min={10}
                    max={40}
                    step={5}
                  />
                </div>

                <div>
                  <Label>Optimal Moisture Range</Label>
                  <p className="text-sm text-gray-600 mb-2">
                    Target range: {optimalRange[0]}% - {optimalRange[1]}%
                  </p>
                  <div className="px-2">
                    <Slider 
                      value={optimalRange}
                      onValueChange={setOptimalRange}
                      min={20}
                      max={80}
                      step={5}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <Label>Weather Integration</Label>
                <div className="space-y-2 mt-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    <span className="text-sm">Skip irrigation if rain expected within 24 hours</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    <span className="text-sm">Adjust duration based on temperature forecast</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    <span className="text-sm">Factor evapotranspiration into scheduling</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline">Reset to Defaults</Button>
                <Button className="bg-green-700 hover:bg-green-800">Save Settings</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </div>
  )
}
