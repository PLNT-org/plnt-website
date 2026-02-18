import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    // Get user from auth header or cookies
    let userId: string | null = null

    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      const { data } = await supabaseAdmin.auth.getUser(token)
      userId = data.user?.id || null
    }

    if (!userId) {
      // Try cookies
      const cookies = request.headers.get('cookie') || ''
      const accessTokenMatch = cookies.match(/sb-[^-]+-auth-token=([^;]+)/)
      if (accessTokenMatch) {
        try {
          const tokenData = JSON.parse(decodeURIComponent(accessTokenMatch[1]))
          if (tokenData.access_token) {
            const { data } = await supabaseAdmin.auth.getUser(tokenData.access_token)
            userId = data.user?.id || null
          }
        } catch {
          // Token parsing failed
        }
      }
    }

    // Aggregate plant counts by plot and species
    // This joins plant_labels with plots and species to get inventory data

    // First, get all plots with their species
    const { data: plots, error: plotsError } = await supabaseAdmin
      .from('plots')
      .select(`
        id,
        name,
        species_id,
        boundaries,
        species:species_id (
          id,
          name,
          scientific_name,
          category,
          barcode_value
        )
      `)
      .eq('user_id', userId)

    if (plotsError) {
      console.error('Error fetching plots:', plotsError)
    }

    // Get plant labels grouped by orthomosaic
    const { data: orthomosaics, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .eq('status', 'completed')

    if (orthoError) {
      console.error('Error fetching orthomosaics:', orthoError)
    }

    // For each plot, count plants that fall within its boundaries
    const inventory: Array<{
      id: string
      species_name: string
      scientific_name?: string
      category?: string
      count: number
      barcode?: string
      aruco_id?: number
      date_counted: string
      plot_id?: string
      plot_name?: string
    }> = []

    if (plots && plots.length > 0) {
      for (const plot of plots) {
        if (!plot.boundaries) continue

        // Get plant labels that fall within this plot
        // For now, we'll get all labels and filter by plot in the aggregation
        const { data: labels, error: labelsError } = await supabaseAdmin
          .from('plant_labels')
          .select('id, latitude, longitude, created_at, verified')
          .in('orthomosaic_id', orthomosaics?.map(o => o.id) || [])

        if (labelsError) {
          console.error('Error fetching labels:', labelsError)
          continue
        }

        // Count labels within plot boundaries
        let count = 0
        let latestDate = plot.boundaries.created_at || new Date().toISOString()

        if (labels && plot.boundaries) {
          // Simple point-in-polygon check for labels within plot
          const polygonCoords = plot.boundaries.coordinates?.[0] || []

          for (const label of labels) {
            if (isPointInPolygon(label.latitude, label.longitude, polygonCoords)) {
              count++
              if (new Date(label.created_at) > new Date(latestDate)) {
                latestDate = label.created_at
              }
            }
          }
        }

        if (count > 0 || plot.species) {
          const species = plot.species as any
          inventory.push({
            id: `${plot.id}-inventory`,
            species_name: species?.name || 'Unknown Species',
            scientific_name: species?.scientific_name,
            category: species?.category,
            count,
            barcode: species?.barcode_value,
            date_counted: latestDate,
            plot_id: plot.id,
            plot_name: plot.name,
          })
        }
      }
    }

    // Also get counts from marker registrations (ArUco-based inventory)
    const { data: markerRegs, error: markerError } = await supabaseAdmin
      .from('marker_registrations')
      .select(`
        id,
        aruco_marker_id,
        plot_name,
        species:species_id (
          id,
          name,
          scientific_name,
          category,
          barcode_value
        ),
        registered_at
      `)
      .eq('user_id', userId)
      .eq('is_active', true)

    if (!markerError && markerRegs) {
      // Group by species and count ArUco markers
      const speciesCounts = new Map<string, {
        species: any
        count: number
        aruco_ids: number[]
        plot_name?: string
        latest_date: string
      }>()

      for (const reg of markerRegs) {
        const species = reg.species as any
        if (!species) continue

        const key = species.id
        const existing = speciesCounts.get(key)

        if (existing) {
          existing.count++
          existing.aruco_ids.push(reg.aruco_marker_id)
          if (new Date(reg.registered_at) > new Date(existing.latest_date)) {
            existing.latest_date = reg.registered_at
          }
        } else {
          speciesCounts.set(key, {
            species,
            count: 1,
            aruco_ids: [reg.aruco_marker_id],
            plot_name: reg.plot_name,
            latest_date: reg.registered_at,
          })
        }
      }

      // Add marker-based inventory items
      for (const [speciesId, data] of speciesCounts) {
        // Check if we already have this species from plot data
        const existingIdx = inventory.findIndex(
          item => item.species_name === data.species.name && item.plot_name === data.plot_name
        )

        if (existingIdx >= 0) {
          // Merge ArUco data
          inventory[existingIdx].aruco_id = data.aruco_ids[0]
        } else {
          inventory.push({
            id: `marker-${speciesId}`,
            species_name: data.species.name,
            scientific_name: data.species.scientific_name,
            category: data.species.category,
            count: data.count,
            barcode: data.species.barcode_value,
            aruco_id: data.aruco_ids[0],
            date_counted: data.latest_date,
            plot_name: data.plot_name,
          })
        }
      }
    }

    // Sort by species name
    inventory.sort((a, b) => a.species_name.localeCompare(b.species_name))

    return NextResponse.json({ inventory })

  } catch (error) {
    console.error('Inventory API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory' },
      { status: 500 }
    )
  }
}

// Simple point-in-polygon check using ray casting
function isPointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  if (!polygon || polygon.length < 3) return false

  let inside = false
  const n = polygon.length

  for (let i = 0, j = n - 1; i < n; j = i++) {
    // GeoJSON coordinates are [lng, lat]
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]

    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }

  return inside
}
