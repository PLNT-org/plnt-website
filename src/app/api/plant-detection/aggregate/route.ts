'use server'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Check if a point is inside a polygon using ray casting algorithm
function pointInPolygon(
  point: { lat: number; lng: number },
  polygon: { lat: number; lng: number }[]
): boolean {
  let inside = false
  const x = point.lng
  const y = point.lat

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng
    const yi = polygon[i].lat
    const xj = polygon[j].lng
    const yj = polygon[j].lat

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi)

    if (intersect) inside = !inside
  }

  return inside
}

// Convert GeoJSON polygon to simple array of points
function parseGeoJSONPolygon(boundaries: any): { lat: number; lng: number }[] | null {
  try {
    if (!boundaries) return null

    // Handle different GeoJSON formats
    if (boundaries.type === 'Polygon' && boundaries.coordinates) {
      // GeoJSON Polygon: coordinates are [lng, lat]
      return boundaries.coordinates[0].map((coord: number[]) => ({
        lat: coord[1],
        lng: coord[0]
      }))
    } else if (Array.isArray(boundaries)) {
      // Direct array of points
      if (boundaries[0]?.lat !== undefined) {
        return boundaries
      } else if (Array.isArray(boundaries[0])) {
        // Array of [lng, lat] pairs
        return boundaries.map((coord: number[]) => ({
          lat: coord[1],
          lng: coord[0]
        }))
      }
    }

    return null
  } catch (e) {
    console.error('Error parsing polygon:', e)
    return null
  }
}

// POST: Aggregate plant detections by plot
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orthomosaicId, userId } = body

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    // Get all AI plant labels for this orthomosaic (with batch fetching)
    const batchSize = 1000
    let labels: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error: labelsError } = await supabase
        .from('plant_labels')
        .select('*')
        .eq('orthomosaic_id', orthomosaicId)
        .eq('source', 'ai')
        .range(offset, offset + batchSize - 1)

      if (labelsError) {
        throw labelsError
      }

      if (data && data.length > 0) {
        labels = [...labels, ...data]
        offset += batchSize
        hasMore = data.length === batchSize
      } else {
        hasMore = false
      }

      // Safety limit
      if (labels.length >= 100000) {
        hasMore = false
      }
    }

    if (labels.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No plant detections found for this orthomosaic',
        plotCounts: [],
        unassignedCount: 0,
      })
    }

    // Get user's plots with boundaries
    let plotsQuery = supabase
      .from('plots')
      .select('id, name, species_id, boundaries, status')
      .eq('status', 'active')

    if (userId) {
      plotsQuery = plotsQuery.eq('user_id', userId)
    }

    const { data: plots, error: plotsError } = await plotsQuery

    if (plotsError) {
      throw plotsError
    }

    // Get species info for the plots
    const speciesIds = [...new Set(plots?.filter(p => p.species_id).map(p => p.species_id))]
    let speciesMap: Record<string, any> = {}

    if (speciesIds.length > 0) {
      const { data: species } = await supabase
        .from('species')
        .select('id, name, scientific_name, category')
        .in('id', speciesIds)

      if (species) {
        species.forEach(s => {
          speciesMap[s.id] = s
        })
      }
    }

    // Count plants per plot
    const plotCounts: {
      plotId: string
      plotName: string
      speciesId?: string
      speciesName?: string
      category?: string
      totalCount: number
      verifiedCount: number
      classCounts: Record<string, number>
      averageConfidence: number
    }[] = []

    const assignedLabelIds = new Set<string>()

    for (const plot of plots || []) {
      const polygon = parseGeoJSONPolygon(plot.boundaries)
      if (!polygon) continue

      const plotLabels = labels.filter(label => {
        const point = { lat: label.latitude, lng: label.longitude }
        const isInside = pointInPolygon(point, polygon)
        if (isInside) {
          assignedLabelIds.add(label.id)
        }
        return isInside
      })

      if (plotLabels.length === 0) continue

      const classCounts: Record<string, number> = {}
      let totalConfidence = 0

      plotLabels.forEach(label => {
        const className = label.label || 'plant'
        classCounts[className] = (classCounts[className] || 0) + 1
        totalConfidence += label.confidence || 0
      })

      const species = plot.species_id ? speciesMap[plot.species_id] : null

      plotCounts.push({
        plotId: plot.id,
        plotName: plot.name,
        speciesId: plot.species_id,
        speciesName: species?.name,
        category: species?.category,
        totalCount: plotLabels.length,
        verifiedCount: plotLabels.filter(l => l.verified).length,
        classCounts,
        averageConfidence: totalConfidence / plotLabels.length,
        boundaries: plot.boundaries, // Include for map visualization
      })
    }

    // Count unassigned labels (not in any plot)
    const unassignedCount = labels.filter(l => !assignedLabelIds.has(l.id)).length

    // Calculate totals
    const totalBySpecies: Record<string, { name: string; count: number }> = {}
    plotCounts.forEach(pc => {
      if (pc.speciesName) {
        if (!totalBySpecies[pc.speciesName]) {
          totalBySpecies[pc.speciesName] = { name: pc.speciesName, count: 0 }
        }
        totalBySpecies[pc.speciesName].count += pc.totalCount
      }
    })

    return NextResponse.json({
      success: true,
      orthomosaicId,
      totalDetections: labels.length,
      assignedToPlots: labels.length - unassignedCount,
      unassignedCount,
      plotCounts: plotCounts.sort((a, b) => b.totalCount - a.totalCount),
      speciesSummary: Object.values(totalBySpecies).sort((a, b) => b.count - a.count),
    })

  } catch (error) {
    console.error('Aggregation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Aggregation failed' },
      { status: 500 }
    )
  }
}
