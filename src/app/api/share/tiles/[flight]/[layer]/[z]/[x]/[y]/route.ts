import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { BUCKETS } from '@/lib/supabase/storage'
import { verifyAccessToken, verifyTileSource } from '@/lib/share/access-token'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const LAYERS = new Set(['rgb', 'ndvi', 'chm'])

// Gated tile proxy: streams a private XYZ tile only when the request carries a
// valid access token (minted after the email gate). The token tells us which
// share, and the `flight` segment selects the dated orthophoto within it — so no
// per-tile DB lookup is needed. The 'legacy' flight keeps the pre-flights layout
// (tiles directly under the share folder, no date subfolder).
export async function GET(
  request: NextRequest,
  { params }: { params: { flight: string; layer: string; z: string; x: string; y: string } }
) {
  const k = request.nextUrl.searchParams.get('k') || ''
  const verified = verifyAccessToken(k)
  if (!verified) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { flight, layer, z, x, y } = params
  if (
    !LAYERS.has(layer) ||
    !/^[\w.-]+$/.test(flight) ||
    !/^\d+$/.test(z) ||
    !/^\d+$/.test(x) ||
    !/^\d+$/.test(y)
  ) {
    return new NextResponse('Bad request', { status: 400 })
  }

  // `s` = a signed, borrowed tile folder (another share's flight); see signTileSource.
  const src = request.nextUrl.searchParams.get('s')
  let prefix = flight === 'legacy' ? verified.shareId : `${verified.shareId}/${flight}`
  if (src) {
    const borrowed = verifyTileSource(verified.shareId, flight, src)
    if (!borrowed) return new NextResponse('Forbidden', { status: 403 })
    prefix = borrowed
  }
  const path = `${prefix}/tiles/${layer}/${z}/${x}/${y}.webp`
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
