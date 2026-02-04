// app/dashboard/flight-plans/[id]/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  ArrowLeft,
  Download,
  Plane,
  MapPin,
  Calendar,
  Clock,
  Settings,
  FileDown,
} from 'lucide-react'
import dynamic from 'next/dynamic'

// Dynamically import the map component to avoid SSR issues
const FlightPathPreviewMap = dynamic(
  () => import('@/components/flight-path-preview-map'),
  { 
    ssr: false,
    loading: () => (
      <div className="h-[500px] bg-gray-50 rounded-lg flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    )
  }
)

// Using Plane icon as Drone
const Drone = Plane

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
  waypoints: {
    coordinates: [number, number][]
    type: string
    actions?: ('fly' | 'photo')[]
    photoIntervalMeters?: number
    estimatedPhotos?: number
  }
  estimated_duration_min: number
  created_at: string
  scheduled_for: string
  status?: string
}

export default function FlightPlanDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user, isDemo, userProfile } = useAuth()
  const [flightPlan, setFlightPlan] = useState<FlightPlan | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const planId = params.id as string
    
    if (!planId || planId === 'undefined') {
      console.error('Invalid flight plan ID:', planId)
      router.push('/dashboard?tab=flights')
      return
    }
    
    loadFlightPlan(planId)
  }, [params.id])

  const loadFlightPlan = async (planId: string) => {
  console.log('loadFlightPlan called with ID:', planId)
  console.log('isDemo:', isDemo)
  console.log('user:', user)
    if (isDemo) {
    // Load demo flight plan with comprehensive waypoints
    const demoPlans: Record<string, FlightPlan> = {
      '1': {
        id: '1',
        name: 'Weekly Survey - North Field',
        plot_id: '1',
        plot: { name: 'North Field A', area_acres: 2.5 },
        drone_model: 'DJI Mavic 3',
        altitude_m: 30,
        speed_ms: 5,
        overlap_percent: 80,
        waypoints: {
          type: 'LineString',
          coordinates: [
            [-118.4085, 34.0522],
            [-118.4086, 34.0523],
            [-118.4087, 34.0524],
            [-118.4088, 34.0525],
            [-118.4089, 34.0526],
            [-118.4090, 34.0527],
            [-118.4091, 34.0528],
            [-118.4092, 34.0529],
          ]
        },
        estimated_duration_min: 15,
        created_at: '2024-01-20',
        scheduled_for: '2024-01-25',
        status: 'scheduled'
      },
      '2': {
        id: '2',
        name: 'Growth Check - Greenhouse B',
        plot_id: '2',
        plot: { name: 'Greenhouse B', area_acres: 1.2 },
        drone_model: 'DJI Phantom 4',
        altitude_m: 25,
        speed_ms: 4,
        overlap_percent: 75,
        waypoints: {
          type: 'LineString',
          coordinates: [
            [-118.4100, 34.0530],
            [-118.4101, 34.0531],
            [-118.4102, 34.0532],
            [-118.4103, 34.0533],
            [-118.4104, 34.0534],
            [-118.4105, 34.0535],
          ]
        },
        estimated_duration_min: 10,
        created_at: '2024-01-18',
        scheduled_for: '2024-01-23',
        status: 'completed'
      }
    }
    
    setFlightPlan(demoPlans[planId] || demoPlans['1'])
    setLoading(false)
    return
  }

  try {
    const { data, error } = await supabase
      .from('flight_plans')
      .select(`
        *,
        plots (
          name,
          area_acres
        )
      `)
      .eq('id', planId)
      .single()

      console.log('Query result:', data)
      console.log('Query error:', error)

    if (error) throw error
    
    // Parse waypoints if it's a string (Supabase sometimes returns JSONB as string)
    if (data) {
      if (typeof data.waypoints === 'string') {
        data.waypoints = JSON.parse(data.waypoints)
      }
      
      // Log for debugging
      console.log('Loaded flight plan:', data)
      console.log('Waypoints object:', data.waypoints)
      console.log('Waypoints coordinates:', data.waypoints?.coordinates)
      console.log('Waypoints coordinates length:', data.waypoints?.coordinates?.length)
      
      setFlightPlan(data)
    }
  } catch (error) {
    console.error('Error loading flight plan:', error)
    alert('Error loading flight plan. Please try again.')
    router.push('/dashboard?tab=flights')
  } finally {
    setLoading(false)
  }
}

  const downloadWaypoints = (format: 'kml' | 'csv' | 'json' | 'gpx' | 'litchi') => {
    if (!flightPlan?.waypoints?.coordinates || flightPlan.waypoints.coordinates.length === 0) {
      alert('No waypoints available for download')
      return
    }

    const waypoints = flightPlan.waypoints.coordinates
    const actions = flightPlan.waypoints.actions || waypoints.map(() => 'photo')
    const gimbalPitches = flightPlan.waypoints.gimbalPitches || waypoints.map(() => -90)
    const headings = flightPlan.waypoints.headings || waypoints.map(() => 0)
    const photoIntervalMeters = flightPlan.waypoints.photoIntervalMeters
    const estimatedPhotos = flightPlan.waypoints.estimatedPhotos || waypoints.length
    const missionType = flightPlan.waypoints.missionType || 'orthomosaic'
    let content = ''
    let filename = ''
    let mimeType = ''

    if (format === 'litchi') {
      // Litchi CSV format for DJI drones with camera triggers
      // CAPTURE-WHILE-MOVING mode: Uses distance-based photo triggering instead of hover-and-capture
      // - curvesize > 0: Drone curves through waypoints without stopping (5m radius)
      // - actiontype1=-1: No per-waypoint photo action (photos triggered by distance interval)
      // - photo_distinterval: Triggers camera every N meters while flying
      // - Speed 4-5 m/s recommended to minimize motion blur with 1/500s+ shutter
      content = 'latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,actiontype1,actionparam1,actiontype2,actionparam2,actiontype3,actionparam3,actiontype4,actionparam4,actiontype5,actionparam5,actiontype6,actionparam6,actiontype7,actionparam7,actiontype8,actionparam8,actiontype9,actionparam9,actiontype10,actionparam10,actiontype11,actionparam11,actiontype12,actionparam12,actiontype13,actionparam13,actiontype14,actionparam14,actiontype15,actionparam15,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval\n'

      // Curve radius for smooth flight through waypoints (meters)
      // 5m provides good balance between flight efficiency and path accuracy
      const curveRadius = 5

      // Use photo_distinterval for distance-based triggering
      // Fall back to 5m interval if not specified
      const distInterval = photoIntervalMeters || 5

      waypoints.forEach((coord, index) => {
        // First and last waypoints: no curve (start/end precisely)
        // Middle waypoints: use curve radius for smooth continuous flight
        const isEndpoint = index === 0 || index === waypoints.length - 1
        const curve = isEndpoint ? 0 : curveRadius

        // Get gimbal pitch for this waypoint (supports variable angles for 3D mapping)
        // -90 = nadir (straight down), -45 = oblique (for 3D reconstruction)
        const gimbalPitch = gimbalPitches[index] || -90

        // Get heading for this waypoint (for 3D mapping, heading follows flight direction)
        // This ensures oblique shots capture objects from all directions (N/S/E/W)
        const heading = headings[index] || 0

        // actiontype1=-1: No per-waypoint action (photos triggered by distance interval instead)
        // This allows continuous flight without hovering at each waypoint
        content += `${coord[1]},${coord[0]},${flightPlan.altitude_m},${heading},${curve},0,2,${gimbalPitch},-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,-1,0,1,${flightPlan.speed_ms},0,0,0,0,-1,${distInterval}\n`
      })
      filename = `${flightPlan.name.replace(/\s+/g, '_')}_litchi.csv`
      mimeType = 'text/csv'
    } else if (format === 'gpx') {
      content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PLNT Flight Planner"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${flightPlan.name}</name>
    <desc>Photo interval: ${photoIntervalMeters?.toFixed(1) || 'N/A'}m, Estimated photos: ${estimatedPhotos}</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <rte>
    <name>${flightPlan.name}</name>
${waypoints.map((coord, index) => {
  const action = actions[index] || 'photo'
  const wpName = action === 'photo' ? `PHOTO${index + 1}` : `WP${index + 1}`
  return `    <rtept lat="${coord[1]}" lon="${coord[0]}">
      <ele>${flightPlan.altitude_m}</ele>
      <name>${wpName}</name>
      <type>${action}</type>
    </rtept>`
}).join('\n')}
  </rte>
</gpx>`
      filename = `${flightPlan.name.replace(/\s+/g, '_')}_waypoints.gpx`
      mimeType = 'application/gpx+xml'
    } else if (format === 'json') {
      const data = {
        name: flightPlan.name,
        drone: flightPlan.drone_model,
        altitude_m: flightPlan.altitude_m,
        speed_ms: flightPlan.speed_ms,
        overlap_percent: flightPlan.overlap_percent,
        photoIntervalMeters: photoIntervalMeters,
        estimatedPhotos: estimatedPhotos,
        waypoints: waypoints.map((coord, index) => ({
          point: index + 1,
          longitude: coord[0],
          latitude: coord[1],
          altitude: flightPlan.altitude_m,
          action: actions[index] || 'photo'
        }))
      }
      content = JSON.stringify(data, null, 2)
      filename = `${flightPlan.name.replace(/\s+/g, '_')}_waypoints.json`
      mimeType = 'application/json'
    } else if (format === 'csv') {
      content = 'Point,Latitude,Longitude,Altitude(m),Action\n'
      waypoints.forEach((coord, index) => {
        const action = actions[index] || 'photo'
        content += `${index + 1},${coord[1]},${coord[0]},${flightPlan.altitude_m},${action.toUpperCase()}\n`
      })
      // Add metadata as comment at the end
      content += `\n# Photo Interval: ${photoIntervalMeters?.toFixed(1) || 'N/A'}m\n`
      content += `# Estimated Photos: ${estimatedPhotos}\n`
      content += `# For best results, use Litchi CSV format with Maven EVO or Litchi app\n`
      filename = `${flightPlan.name.replace(/\s+/g, '_')}_waypoints.csv`
      mimeType = 'text/csv'
    } else if (format === 'kml') {
      const photoCount = actions.filter(a => a === 'photo').length
      content = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${flightPlan.name}</name>
    <description>Photo interval: ${photoIntervalMeters?.toFixed(1) || 'N/A'}m, Estimated photos: ${estimatedPhotos}</description>
    <Style id="flightPath">
      <LineStyle>
        <color>ff0088ff</color>
        <width>3</width>
      </LineStyle>
    </Style>
    <Style id="photoPoint">
      <IconStyle>
        <color>ff00ff00</color>
        <scale>0.8</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="flyPoint">
      <IconStyle>
        <color>ffff0000</color>
        <scale>0.6</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Placemark>
      <name>Flight Path</name>
      <styleUrl>#flightPath</styleUrl>
      <LineString>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>
${waypoints.map(coord => `          ${coord[0]},${coord[1]},${flightPlan.altitude_m}`).join('\n')}
        </coordinates>
      </LineString>
    </Placemark>
    ${waypoints.map((coord, index) => {
      const action = actions[index] || 'photo'
      const style = action === 'photo' ? 'photoPoint' : 'flyPoint'
      const label = action === 'photo' ? `Photo ${index + 1}` : `Waypoint ${index + 1}`
      return `
    <Placemark>
      <name>${label}</name>
      <styleUrl>#${style}</styleUrl>
      <Point>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>${coord[0]},${coord[1]},${flightPlan.altitude_m}</coordinates>
      </Point>
    </Placemark>`
    }).join('')}
  </Document>
</kml>`
      filename = `${flightPlan.name.replace(/\s+/g, '_')}_waypoints.kml`
      mimeType = 'application/vnd.google-earth.kml+xml'
    }

    // Create and trigger download
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    // Show success message
    console.log(`Downloaded ${filename}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    )
  }

  if (!flightPlan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Flight plan not found</p>
          <Link href="/dashboard?tab=flights">
            <Button className="mt-4">Back to Flight Plans</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
  <div className="min-h-screen bg-gray-50">
    {/* Debug info - remove after fixing */}
    <div className="bg-red-100 p-4">
      <p>Flight Plan ID: {flightPlan?.id}</p>
      <p>Has waypoints: {flightPlan?.waypoints ? 'YES' : 'NO'}</p>
      <p>Waypoints type: {typeof flightPlan?.waypoints}</p>
      <p>Coordinates length: {flightPlan?.waypoints?.coordinates?.length || 'NONE'}</p>
    </div>
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/dashboard?tab=flights">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to All Flight Plans
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{flightPlan.name}</h1>
                <p className="text-sm text-gray-600">Flight plan details and waypoints</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Link href={`/dashboard/flight-planner?edit=${flightPlan.id}`}>
                <Button variant="outline">
                  <Settings className="w-4 h-4 mr-2" />
                  Edit Plan
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6">
          {/* Flight Details Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Flight Configuration</CardTitle>
                  <CardDescription>
                    {flightPlan.plot?.name || 'Custom Area'} • {flightPlan.plot?.area_acres || 'N/A'} acres
                  </CardDescription>
                </div>
                <Badge variant={
                  flightPlan.status === 'completed' ? 'default' :
                  flightPlan.status === 'scheduled' ? 'secondary' :
                  'outline'
                }>
                  {flightPlan.status || (new Date(flightPlan.scheduled_for) > new Date() ? 'Upcoming' : 'Past')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Drone Model</p>
                  <p className="font-medium flex items-center">
                    <Drone className="w-4 h-4 mr-1 text-gray-500" />
                    {flightPlan.drone_model}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Altitude</p>
                  <p className="font-medium">{Math.round(flightPlan.altitude_m * 3.28084)} ft</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Speed</p>
                  <p className="font-medium">{Math.round(flightPlan.speed_ms * 3.28084)} ft/s</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Overlap</p>
                  <p className="font-medium">{flightPlan.overlap_percent}%</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Est. Duration</p>
                  <p className="font-medium flex items-center">
                    <Clock className="w-4 h-4 mr-1 text-gray-500" />
                    {flightPlan.estimated_duration_min} min
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Created</p>
                  <p className="font-medium">{new Date(flightPlan.created_at).toLocaleDateString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Scheduled</p>
                  <p className="font-medium flex items-center">
                    <Calendar className="w-4 h-4 mr-1 text-gray-500" />
                    {new Date(flightPlan.scheduled_for).toLocaleDateString()}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">Waypoints</p>
                  <p className="font-medium flex items-center">
                    <MapPin className="w-4 h-4 mr-1 text-gray-500" />
                    {flightPlan.waypoints?.coordinates?.length || 0} points
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Download Waypoints Card - VISIBLE FOR ALL USERS */}
          <Card>
            <CardHeader>
              <CardTitle>Download Waypoints</CardTitle>
              <CardDescription>
                Export flight path with camera triggers • {flightPlan.waypoints?.coordinates?.length || 0} photo waypoints
                {flightPlan.waypoints?.photoIntervalMeters && (
                  <span className="block mt-1 font-medium text-green-700">
                    Photo interval: {(flightPlan.waypoints.photoIntervalMeters * 3.28084).toFixed(1)} ft
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {flightPlan.waypoints?.coordinates && flightPlan.waypoints.coordinates.length > 0 ? (
                <div className="space-y-4">
                  {flightPlan.waypoints?.photoIntervalMeters && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-sm text-blue-800">
                        <strong>For Maven EVO / Litchi:</strong> Capture-while-moving enabled - photos trigger every {flightPlan.waypoints.photoIntervalMeters.toFixed(1)}m during continuous flight (no hover stops)
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => downloadWaypoints('litchi')}
                      className="bg-green-700 hover:bg-green-800 text-white"
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      Litchi CSV (Maven EVO)
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => downloadWaypoints('kml')}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      KML (Google Earth)
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => downloadWaypoints('json')}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      JSON
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => downloadWaypoints('csv')}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      CSV
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => downloadWaypoints('gpx')}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      GPX
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No waypoints available for this flight plan</p>
              )}
            </CardContent>
          </Card>

          {/* Flight Path Preview - VISIBLE FOR ALL USERS */}
          <Card>
            <CardHeader>
              <CardTitle>Flight Path Preview</CardTitle>
              <CardDescription>Visual representation of the drone flight pattern</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {flightPlan.waypoints?.coordinates && flightPlan.waypoints.coordinates.length > 0 ? (
                <div className="h-[500px] w-full">
                  <FlightPathPreviewMap 
                    waypoints={flightPlan.waypoints} 
                    plotName={flightPlan.plot?.name}
                    zoomLevel={18}  // More zoomed out for better overview
                  />
                </div>
              ) : (
                <div className="h-[500px] bg-gray-50 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-500">No waypoints available for this flight plan</p>
                    <Link href={`/dashboard/flight-planner?edit=${flightPlan.id}`}>
                      <Button variant="outline" className="mt-4">
                        Add Waypoints
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}