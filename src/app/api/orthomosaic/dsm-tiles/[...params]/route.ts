import { NextRequest, NextResponse } from 'next/server'
import { fetchWithWebODMAuth } from '@/lib/webodm/token-manager'

// Simple in-memory tile cache
const tileCache = new Map<string, { data: ArrayBuffer; timestamp: number }>()
const MAX_CACHE_SIZE = 500
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function getCachedTile(key: string): ArrayBuffer | null {
  const entry = tileCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    tileCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedTile(key: string, data: ArrayBuffer) {
  // Evict oldest entries if cache is full
  if (tileCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tileCache.keys().next().value
    if (firstKey) tileCache.delete(firstKey)
  }
  tileCache.set(key, { data, timestamp: Date.now() })
}

// DSM tile proxy for WebODM
// Route: /api/orthomosaic/dsm-tiles/[projectId]/[taskId]/[z]/[x]/[y]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ params: string[] }> }
) {
  try {
    const { params: pathParams } = await params

    // Expect: [projectId, taskId, z, x, y]
    if (pathParams.length !== 5) {
      return NextResponse.json(
        { error: 'Invalid tile path. Expected: /projectId/taskId/z/x/y' },
        { status: 400 }
      )
    }

    const [projectId, taskId, z, x, y] = pathParams

    // Check cache first
    const cacheKey = `dsm-${projectId}-${taskId}-${z}-${x}-${y}`
    const cached = getCachedTile(cacheKey)
    if (cached) {
      return new NextResponse(cached, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
          'X-Cache': 'HIT',
        },
      })
    }

    const webodmUrl = (process.env.WEBODM_URL || 'http://localhost:8000').replace(/\/$/, '')

    // Fetch DSM tile from WebODM
    const tileUrl = `${webodmUrl}/api/projects/${projectId}/tasks/${taskId}/dsm/tiles/${z}/${x}/${y}.png`

    const response = await fetchWithWebODMAuth(tileUrl)

    if (!response.ok) {
      // Return empty response for 404 (tile doesn't exist at this location)
      if (response.status === 404) {
        return new NextResponse(null, { status: 204 })
      }
      return NextResponse.json(
        { error: `WebODM error: ${response.status}` },
        { status: response.status }
      )
    }

    // Get the image data
    const imageBuffer = await response.arrayBuffer()

    // Cache the tile
    setCachedTile(cacheKey, imageBuffer)

    // Return the tile with appropriate headers
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('DSM tile proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch DSM tile' },
      { status: 500 }
    )
  }
}
