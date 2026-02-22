// app/dashboard/flight-plans/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { ProtectedRoute } from '@/lib/auth/protected-route'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  ArrowLeft,
  Plane,
  Calendar,
  Clock,
  MapPin,
  Eye,
  Settings,
  Plus,
  Trash2,
} from 'lucide-react'

interface FlightPlan {
  id: string
  name: string
  plot_id: string
  plot?: {
    name: string
    area_acres: number
  }
  drone_model: string
  altitude_m: number
  speed_ms: number
  overlap_percent: number
  scheduled_for: string
  created_at: string
  status?: string
}

export default function FlightPlansPage() {
  return (
    <ProtectedRoute>
      <FlightPlansContent />
    </ProtectedRoute>
  )
}

function FlightPlansContent() {
  const { user, isDemo, isAdmin } = useAuth()
  const router = useRouter()
  const [flightPlans, setFlightPlans] = useState<FlightPlan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isDemo) {
      // Load demo flight plans
      setFlightPlans([
        {
          id: '1',
          name: 'Weekly Survey - North Field',
          plot_id: '1',
          plot: { name: 'North Field A', area_acres: 2.5 },
          drone_model: 'DJI Mavic 3',
          altitude_m: 30,
          speed_ms: 5,
          overlap_percent: 80,
          scheduled_for: '2024-01-25T10:00:00',
          created_at: '2024-01-20',
          status: 'scheduled',
        },
        {
          id: '2',
          name: 'Growth Check - Greenhouse B',
          plot_id: '2',
          plot: { name: 'Greenhouse Block B', area_acres: 1.8 },
          drone_model: 'DJI Air 2S',
          altitude_m: 25,
          speed_ms: 4,
          overlap_percent: 75,
          scheduled_for: '2024-01-26T14:00:00',
          created_at: '2024-01-19',
          status: 'scheduled',
        },
        {
          id: '3',
          name: 'Monthly Inventory - Full Property',
          plot_id: '3',
          plot: { name: 'South Nursery', area_acres: 3.2 },
          drone_model: 'DJI Mavic 3',
          altitude_m: 35,
          speed_ms: 6,
          overlap_percent: 85,
          scheduled_for: '2024-01-20T09:00:00',
          created_at: '2024-01-15',
          status: 'completed',
        },
      ])
      setLoading(false)
    } else {
      fetchFlightPlans()
    }
  }, [isDemo])

  const fetchFlightPlans = async () => {
    if (!user) return

    try {
      let query = supabase
        .from('flight_plans')
        .select(`
          *,
          plots (name, area_acres)
        `)
        .order('scheduled_for', { ascending: false })

      if (!isAdmin) {
        query = query.eq('user_id', user.id)
      }

      const { data, error } = await query

      if (error) throw error

      // Determine status based on scheduled date
      const plansWithStatus = (data || []).map(plan => ({
        ...plan,
        plot: plan.plots,
        status: new Date(plan.scheduled_for) > new Date() ? 'scheduled' : 'completed'
      }))

      setFlightPlans(plansWithStatus)
    } catch (error) {
      console.error('Error fetching flight plans:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (planId: string) => {
    if (!confirm('Are you sure you want to delete this flight plan?')) {
      return
    }

    if (isDemo) {
      // Handle demo mode deletion
      setFlightPlans(flightPlans.filter(plan => plan.id !== planId))
      alert('Flight plan deleted! (Demo mode - not persisted)')
      return
    }

    try {
      let query = supabase.from('flight_plans').delete().eq('id', planId)
      if (!isAdmin) query = query.eq('user_id', user!.id)
      const { error } = await query

      if (error) throw error

      // Remove from local state
      setFlightPlans(flightPlans.filter(plan => plan.id !== planId))
    } catch (error) {
      console.error('Error deleting flight plan:', error)
      alert('Failed to delete flight plan. Please try again.')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'default'
      case 'completed':
        return 'secondary'
      case 'in_progress':
        return 'outline'
      default:
        return 'secondary'
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
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Flight Plans</h1>
                <p className="text-sm text-gray-600">Manage your drone survey missions</p>
              </div>
            </div>
            <Link href="/dashboard/flight-planner">
              <Button className="bg-green-700 hover:bg-green-800">
                <Plus className="w-4 h-4 mr-2" />
                New Flight Plan
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {flightPlans.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Plane className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No flight plans yet</h3>
              <p className="text-gray-600 mb-4">Create your first flight plan to get started</p>
              <Link href="/dashboard/flight-planner">
                <Button className="bg-green-700 hover:bg-green-800">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Flight Plan
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {flightPlans.map((plan) => (
              <Card key={plan.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-semibold">{plan.name}</h3>
                        <Badge variant={getStatusColor(plan.status || 'scheduled')}>
                          {plan.status || 'scheduled'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                        <div>
                          <p className="text-gray-600">Plot</p>
                          <p className="font-medium">{plan.plot?.name || 'Custom Area'}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Drone</p>
                          <p className="font-medium">{plan.drone_model}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Altitude</p>
                          <p className="font-medium">{plan.altitude_m}m</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Overlap</p>
                          <p className="font-medium">{plan.overlap_percent}%</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Scheduled</p>
                          <p className="font-medium">
                            {new Date(plan.scheduled_for).toLocaleDateString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-600">Time</p>
                          <p className="font-medium">
                            {new Date(plan.scheduled_for).toLocaleTimeString([], { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 ml-4">
                      <Link href={`/dashboard/flight-plans/${plan.id}`}>
                        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white">
                          View
                        </Button>
                      </Link>
                      <Link href={`/dashboard/flight-planner?edit=${plan.id}`}>
                        <Button variant="outline" size="sm">
                          <Settings className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleDelete(plan.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}