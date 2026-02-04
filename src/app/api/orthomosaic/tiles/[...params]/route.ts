import { NextRequest, NextResponse } from 'next/server'

// Tile proxy for WebODM orthomosaic tiles
// Route: /api/orthomosaic/tiles/[projectId]/[taskId]/[z]/[x]/[y]
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

    const webodmUrl = process.env.WEBODM_URL || 'http://localhost:8000'
    const webodmToken = process.env.WEBODM_TOKEN

    if (!webodmToken) {
      return NextResponse.json(
        { error: 'WebODM token not configured' },
        { status: 500 }
      )
    }

    // Fetch tile from WebODM
    const tileUrl = `${webodmUrl}/api/projects/${projectId}/tasks/${taskId}/orthophoto/tiles/${z}/${x}/${y}`

    const response = await fetch(tileUrl, {
      headers: {
        Authorization: `JWT ${webodmToken}`,
      },
    })

    if (!response.ok) {
      // Return transparent tile for 404 (tile doesn't exist at this location)
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

    // Return the tile with appropriate headers
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // Cache for 1 day
      },
    })
  } catch (error) {
    console.error('Tile proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tile' },
      { status: 500 }
    )
  }
}
