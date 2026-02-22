// app/api/process-images/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(req, supabaseAdmin)
    if (errorResponse) return errorResponse

    const { images, flightId } = await req.json()
    
    // Validate input
    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: 'No images provided' },
        { status: 400 }
      )
    }

    // In production, you would call your Python ML service here
    // For example:
    /*
    const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000'
    const response = await fetch(`${mlServiceUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        images,
        flight_id: flightId 
      })
    })
    
    if (!response.ok) {
      throw new Error('ML service error')
    }
    
    const result = await response.json()
    */

    // For now, return mock data with realistic variation
    const baseCount = 1200
    const variation = Math.floor(Math.random() * 300)
    const count = baseCount + variation
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    return NextResponse.json({
      count,
      confidence: 0.90 + Math.random() * 0.08,
      processingTime: 8 + Math.random() * 10,
      individualPlants: generateMockPlantLocations(count),
      densityMap: null, // Would be a URL to generated heatmap
      summary: {
        totalImages: images.length,
        processedImages: images.length,
        failedImages: 0,
        averagePlantsPerImage: Math.floor(count / images.length)
      }
    })
  } catch (error) {
    console.error('Process images error:', error)
    return NextResponse.json(
      { error: 'Failed to process images' },
      { status: 500 }
    )
  }
}

function generateMockPlantLocations(count: number) {
  // Generate mock individual plant locations for first 100 plants
  const locations = []
  const maxPlants = Math.min(count, 100)
  
  for (let i = 0; i < maxPlants; i++) {
    locations.push({
      id: i,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      confidence: 0.85 + Math.random() * 0.15,
      size: 'medium'
    })
  }
  
  return locations
}