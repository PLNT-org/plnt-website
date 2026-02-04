// app/dashboard/analytics/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrendingUp, TrendingDown, Leaf, Calendar, Download, Map, BarChart3, Activity, Droplets, Cloud } from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {  
  Zap, 
  Settings 
} from 'lucide-react'

interface PlantCountData {
  date: string
  count: number
  confidence: number
  plotName: string
  weather?: string
}

interface PlotSummary {
  plotId: string
  plotName: string
  totalCounts: number
  avgCount: number
  lastCount: number
  trend: 'up' | 'down' | 'stable'
  trendPercent: number
}

export default function AnalyticsPage() {
  const { user, isDemo } = useAuth()
  const [selectedPlot, setSelectedPlot] = useState<string>('all')
  const [dateRange, setDateRange] = useState('30d')
  const [plantCounts, setPlantCounts] = useState<PlantCountData[]>([])
  const [plotSummaries, setPlotSummaries] = useState<PlotSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAnalyticsData()
  }, [selectedPlot, dateRange])

  const loadAnalyticsData = async () => {
    if (isDemo) {
      // Generate demo data
      setPlantCounts(generateDemoData())
      setPlotSummaries(generateDemoSummaries())
      setLoading(false)
      return
    }

    try {
      // Load real data from Supabase
      const startDate = getStartDate(dateRange)
      
      let query = supabase
        .from('plant_counts')
        .select(`
          *,
          flights (
            flight_plans (
              name,
              plots (
                id,
                name
              )
            )
          )
        `)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true })

      if (selectedPlot !== 'all') {
        // Filter by plot - would need to join through flights -> flight_plans -> plots
        // This is simplified for now
      }

      const { data, error } = await query
      if (error) throw error

      // Transform data
      const transformed = (data || []).map(item => ({
        date: new Date(item.created_at).toLocaleDateString(),
        count: item.count,
        confidence: item.confidence,
        plotName: item.flights?.flight_plans?.plots?.name || 'Unknown'
      }))

      setPlantCounts(transformed)
      calculateSummaries(transformed)
    } catch (err) {
      console.error('Error loading analytics:', err)
      // Fallback to demo data
      setPlantCounts(generateDemoData())
      setPlotSummaries(generateDemoSummaries())
    } finally {
      setLoading(false)
    }
  }

  const generateDemoData = (): PlantCountData[] => {
    const data: PlantCountData[] = []
    const plots = ['North Field A', 'Greenhouse B', 'South Nursery']
    const today = new Date()
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      
      plots.forEach(plot => {
        if (Math.random() > 0.3) { // Not every plot every day
          data.push({
            date: date.toLocaleDateString(),
            count: Math.floor(1200 + Math.random() * 300 + (29 - i) * 5), // Growing trend
            confidence: 0.90 + Math.random() * 0.08,
            plotName: plot,
            weather: ['sunny', 'cloudy', 'partly cloudy'][Math.floor(Math.random() * 3)]
          })
        }
      })
    }
    
    return data
  }

  const generateDemoSummaries = (): PlotSummary[] => {
    return [
      {
        plotId: '1',
        plotName: 'North Field A',
        totalCounts: 12,
        avgCount: 1247,
        lastCount: 1289,
        trend: 'up',
        trendPercent: 3.4
      },
      {
        plotId: '2',
        plotName: 'Greenhouse B',
        totalCounts: 10,
        avgCount: 892,
        lastCount: 878,
        trend: 'down',
        trendPercent: -1.6
      },
      {
        plotId: '3',
        plotName: 'South Nursery',
        totalCounts: 8,
        avgCount: 1456,
        lastCount: 1501,
        trend: 'up',
        trendPercent: 3.1
      }
    ]
  }

  const calculateSummaries = (data: PlantCountData[]) => {
    // Group by plot and calculate summaries
    const grouped = data.reduce((acc, item) => {
      if (!acc[item.plotName]) {
        acc[item.plotName] = []
      }
      acc[item.plotName].push(item)
      return acc
    }, {} as Record<string, PlantCountData[]>)

    const summaries = Object.entries(grouped).map(([plotName, counts]) => {
      const avgCount = counts.reduce((sum, c) => sum + c.count, 0) / counts.length
      const lastCount = counts[counts.length - 1].count
      const firstCount = counts[0].count
      const trendPercent = ((lastCount - firstCount) / firstCount) * 100

      return {
        plotId: plotName,
        plotName,
        totalCounts: counts.length,
        avgCount: Math.round(avgCount),
        lastCount,
        trend: trendPercent > 1 ? 'up' : trendPercent < -1 ? 'down' : 'stable' as 'up' | 'down' | 'stable',
        trendPercent: Math.round(trendPercent * 10) / 10
      }
    })

    setPlotSummaries(summaries)
  }

  const getStartDate = (range: string): Date => {
    const date = new Date()
    switch (range) {
      case '7d':
        date.setDate(date.getDate() - 7)
        break
      case '30d':
        date.setDate(date.getDate() - 30)
        break
      case '90d':
        date.setDate(date.getDate() - 90)
        break
      case '1y':
        date.setFullYear(date.getFullYear() - 1)
        break
      default:
        date.setDate(date.getDate() - 30)
    }
    return date
  }

  const exportData = () => {
    const csv = [
      ['Date', 'Plot', 'Count', 'Confidence'],
      ...plantCounts.map(row => [row.date, row.plotName, row.count, row.confidence])
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plant-counts-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  // Prepare chart data
  const chartData = selectedPlot === 'all' 
    ? plantCounts 
    : plantCounts.filter(p => p.plotName === selectedPlot)

  const groupedByDate = chartData.reduce((acc, item) => {
    if (!acc[item.date]) {
      acc[item.date] = { date: item.date }
    }
    acc[item.date][item.plotName] = item.count
    return acc
  }, {} as Record<string, any>)

  const lineChartData = Object.values(groupedByDate)

  // Calculate total stats
  const totalPlants = plantCounts.reduce((sum, p) => sum + p.count, 0)
  const avgConfidence = plantCounts.reduce((sum, p) => sum + p.confidence, 0) / plantCounts.length || 0
  const totalFlights = new Set(plantCounts.map(p => p.date + p.plotName)).size

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Analytics Dashboard</h1>
            <p className="text-gray-600 mt-2">Monitor plant count trends and inventory insights</p>
          </div>
          
          <div className="flex gap-4">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="1y">Last year</SelectItem>
              </SelectContent>
            </Select>
            
            <Button onClick={exportData} variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
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
              <div className="text-2xl font-bold">{totalPlants.toLocaleString()}</div>
              <p className="text-xs text-green-600 flex items-center mt-1">
                <TrendingUp className="w-3 h-3 mr-1" />
                +12.3% from last period
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Active Plots</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{plotSummaries.length}</div>
              <p className="text-xs text-gray-500 mt-1">
                {totalFlights} total surveys
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Avg Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(avgConfidence * 100).toFixed(1)}%</div>
              <p className="text-xs text-gray-500 mt-1">
                ML model accuracy
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Growth Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">+8.7%</div>
              <p className="text-xs text-green-600 flex items-center mt-1">
                <Activity className="w-3 h-3 mr-1" />
                Healthy growth
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <Tabs defaultValue="trends" className="space-y-4">
          <TabsList>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="comparison">Plot Comparison</TabsTrigger>
            <TabsTrigger value="distribution">Distribution</TabsTrigger>
            <TabsTrigger value="health">Plant Health</TabsTrigger>
          </TabsList>

          <TabsContent value="trends" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Plant Count Trends</CardTitle>
                <CardDescription>Daily plant counts across all plots</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={lineChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="North Field A" stroke="#10b981" strokeWidth={2} />
                    <Line type="monotone" dataKey="Greenhouse B" stroke="#3b82f6" strokeWidth={2} />
                    <Line type="monotone" dataKey="South Nursery" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="comparison" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Plot Performance Comparison</CardTitle>
                <CardDescription>Compare plant counts across different plots</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={plotSummaries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="plotName" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="avgCount" fill="#10b981" name="Average Count" />
                    <Bar dataKey="lastCount" fill="#3b82f6" name="Latest Count" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="distribution" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Plant Distribution</CardTitle>
                <CardDescription>Distribution of plants across your nursery</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart>
                    <Pie
                      data={plotSummaries}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.plotName}: ${entry.lastCount}`}
                      outerRadius={120}
                      fill="#8884d8"
                      dataKey="lastCount"
                    >
                      {plotSummaries.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#f59e0b'][index % 3]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="health" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Plant Health Metrics</CardTitle>
                <CardDescription>Overall health indicators based on growth patterns</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <RadarChart data={[
                    { metric: 'Growth Rate', value: 85 },
                    { metric: 'Density', value: 78 },
                    { metric: 'Uniformity', value: 92 },
                    { metric: 'Health Score', value: 88 },
                    { metric: 'Yield Prediction', value: 81 }
                  ]}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} />
                    <Radar name="Current" dataKey="value" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Plant Health Analysis Card */}
<Card className="hover:shadow-lg transition-shadow cursor-pointer">
  <CardHeader>
    <div className="flex items-center justify-between">
      <Activity className="w-8 h-8 text-green-600" />
      <Badge variant="outline">New</Badge>
    </div>
    <CardTitle>Plant Health Analysis</CardTitle>
    <CardDescription>
      Analyze aerial imagery for plant stress using VARI and pseudo-NDVI
    </CardDescription>
  </CardHeader>
  <CardContent>
    <div className="space-y-3">
      <div className="flex items-center text-sm text-gray-600">
        <Zap className="w-4 h-4 mr-2 text-yellow-500" />
        WebGL accelerated processing
      </div>
      <div className="flex items-center text-sm text-gray-600">
        <BarChart className="w-4 h-4 mr-2 text-blue-500" />
        Multiple analysis algorithms
      </div>
      <div className="flex items-center text-sm text-gray-600">
        <Settings className="w-4 h-4 mr-2 text-purple-500" />
        Customizable for plant types
      </div>
    </div>
    <Link href="/dashboard/analytics/plant-health">
      <Button className="w-full mt-4 bg-green-700 hover:bg-green-800">
        <Activity className="w-4 h-4 mr-2" />
        Start Analysis
      </Button>
    </Link>
  </CardContent>
</Card>

{/* Soil Moisture Monitoring Card - NEW */}
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <div className="flex items-center justify-between">
                <Droplets className="w-8 h-8 text-blue-600" />
                <Badge variant="outline">New</Badge>
              </div>
              <CardTitle>Soil Moisture Monitoring</CardTitle>
              <CardDescription>
                Real-time irrigation management with NDWI and thermal analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center text-sm text-gray-600">
                  <Droplets className="w-4 h-4 mr-2 text-blue-500" />
                  NDWI & thermal moisture detection
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <Cloud className="w-4 h-4 mr-2 text-gray-500" />
                  Weather-integrated scheduling
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <Zap className="w-4 h-4 mr-2 text-yellow-500" />
                  Smart irrigation automation
                </div>
              </div>
              <Link href="/dashboard/analytics/soil-moisture">
                <Button className="w-full mt-4 bg-blue-600 hover:bg-blue-700">
                  <Droplets className="w-4 h-4 mr-2" />
                  Monitor Moisture
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Plot Details Table */}
        <Card>
          <CardHeader>
            <CardTitle>Plot Details</CardTitle>
            <CardDescription>Individual plot performance metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Plot Name</th>
                    <th className="text-right py-2">Total Surveys</th>
                    <th className="text-right py-2">Avg Count</th>
                    <th className="text-right py-2">Latest Count</th>
                    <th className="text-right py-2">Trend</th>
                    <th className="text-right py-2">Change %</th>
                  </tr>
                </thead>
                <tbody>
                  {plotSummaries.map(plot => (
                    <tr key={plot.plotId} className="border-b">
                      <td className="py-2 font-medium">{plot.plotName}</td>
                      <td className="text-right py-2">{plot.totalCounts}</td>
                      <td className="text-right py-2">{plot.avgCount.toLocaleString()}</td>
                      <td className="text-right py-2">{plot.lastCount.toLocaleString()}</td>
                      <td className="text-right py-2">
                        {plot.trend === 'up' ? (
                          <TrendingUp className="w-4 h-4 text-green-600 inline" />
                        ) : plot.trend === 'down' ? (
                          <TrendingDown className="w-4 h-4 text-red-600 inline" />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={`text-right py-2 ${
                        plot.trendPercent > 0 ? 'text-green-600' : 
                        plot.trendPercent < 0 ? 'text-red-600' : 'text-gray-500'
                      }`}>
                        {plot.trendPercent > 0 ? '+' : ''}{plot.trendPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
  )
}