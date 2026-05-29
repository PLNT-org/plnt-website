import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { BUCKETS } from '@/lib/supabase/storage'
import { verifyAccessToken } from '@/lib/share/access-token'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const LAYERS = new Set(['rgb', 'ndvi', 'chm'])

// Gated tile proxy: streams a private XYZ tile only when the request carries a
// valid access token (minted after the email gate). The token also tells us
// which share's tiles to serve, so no per-tile DB lookup is needed.
export async function GET(
  request: NextRequest,
  { params }: { params: { layer: string; z: string; x: string; y: string } }
) {
  const k = request.nextUrl.searchParams.get('k') || ''
  const verified = verifyAccessToken(k)
  if (!verified) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { layer, z, x, y } = params
  if (!LAYERS.has(layer) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return new NextResponse('Bad request', { status: 400 })
  }

  const path = `${verified.shareId}/tiles/${layer}/${z}/${x}/${y}.webp`
  const { data, error } = await supabaseAdmin.storage.from(BUCKETS.PROPERTY_SHARES).download(path)
  if (error || !data) {
    // Missing tile (outside coverage) — Leaflet treats a 404 as a blank tile.
    return new NextResponse(null, { status: 404 })
  }

  const bytes = new Uint8Array(await data.arrayBuffer())
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
