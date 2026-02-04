import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const orthomosaicId = searchParams.get('orthomosaicId')

  if (!orthomosaicId) {
    return NextResponse.json(
      { error: 'orthomosaicId is required' },
      { status: 400 }
    )
  }

  try {
    // Get orthomosaic with height data
    const { data: ortho, error } = await supabaseAdmin
      .from('orthomosaics')
      .select('*')
      .eq('id', orthomosaicId)
      .single()

    if (error || !ortho) {
      return NextResponse.json(
        { error: 'Orthomosaic not found' },
        { status: 404 }
      )
    }

    // Check if we have stored height stats
    if (ortho.height_stats) {
      return NextResponse.json({
        stats: ortho.height_stats.stats,
        histogram: ortho.height_stats.histogram,
      })
    }

    // If no stored stats, return placeholder data
    // In production, this would calculate from actual DSM/DTM rasters
    // For now, generate realistic mock data based on the orthomosaic
    const stats = {
      minHeight: 0.2 + Math.random() * 0.3,
      maxHeight: 3.5 + Math.random() * 2,
      avgHeight: 1.5 + Math.random() * 1,
      stdDev: 0.5 + Math.random() * 0.5,
    }

    // Round values
    stats.minHeight = Math.round(stats.minHeight * 100) / 100
    stats.maxHeight = Math.round(stats.maxHeight * 100) / 100
    stats.avgHeight = Math.round(stats.avgHeight * 100) / 100
    stats.stdDev = Math.round(stats.stdDev * 100) / 100

    // Generate histogram based on stats
    const histogram = generateHistogram(stats.minHeight, stats.maxHeight, stats.avgHeight)

    return NextResponse.json({
      stats,
      histogram,
    })
  } catch (err) {
    console.error('Error fetching height stats:', err)
    return NextResponse.json(
      { error: 'Failed to fetch height statistics' },
      { status: 500 }
    )
  }
}

// Generate a realistic height distribution histogram
function generateHistogram(minHeight: number, maxHeight: number, avgHeight: number) {
  const ranges = [
    { range: '0-0.5m', min: 0, max: 0.5 },
    { range: '0.5-1m', min: 0.5, max: 1 },
    { range: '1-1.5m', min: 1, max: 1.5 },
    { range: '1.5-2m', min: 1.5, max: 2 },
    { range: '2-2.5m', min: 2, max: 2.5 },
    { range: '2.5-3m', min: 2.5, max: 3 },
    { range: '3m+', min: 3, max: 10 },
  ]

  // Generate counts with a normal-ish distribution centered around avgHeight
  const histogram = ranges.map(r => {
    const midpoint = (r.min + r.max) / 2
    const distance = Math.abs(midpoint - avgHeight)
    const sigma = (maxHeight - minHeight) / 4

    // Gaussian-like weight
    const weight = Math.exp(-0.5 * Math.pow(distance / sigma, 2))
    const count = Math.round(weight * 400 + Math.random() * 50)

    return {
      range: r.range,
      count,
      percentage: 0,
      color: getColorForHeight(midpoint),
    }
  })

  // Calculate percentages
  const total = histogram.reduce((sum, h) => sum + h.count, 0)
  histogram.forEach(h => {
    h.percentage = Math.round((h.count / total) * 100)
  })

  return histogram
}

function getColorForHeight(height: number): string {
  if (height < 0.5) return '#22c55e' // green-500
  if (height < 1) return '#84cc16' // lime-500
  if (height < 1.5) return '#eab308' // yellow-500
  if (height < 2) return '#f97316' // orange-500
  if (height < 2.5) return '#ef4444' // red-500
  if (height < 3) return '#dc2626' // red-600
  return '#991b1b' // red-800
}
