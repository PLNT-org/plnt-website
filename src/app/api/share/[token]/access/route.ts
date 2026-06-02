import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { BUCKETS, getSignedUrl } from '@/lib/supabase/storage'
import { signAccessToken } from '@/lib/share/access-token'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SIGNED_URL_TTL = 21600 // 6 hours — covers a long viewing session before tiles need re-auth

interface StoredLayer {
  type: 'rgb' | 'ndvi' | 'chm'
  storage_path: string
  bounds: { north: number; south: number; east: number; west: number }
  value_min?: number
  value_max?: number
  tiled?: boolean
  plant_count?: number
}

// Gated XYZ tile URL template — served through the proxy that validates the
// access token and streams from the private property-shares bucket.
function tileUrlTemplate(layerType: string, accessToken: string): string {
  return `/api/share/tiles/${layerType}/{z}/{x}/{y}?k=${accessToken}`
}

// POST - Redeem a share link. Requires an email on the share's allowlist.
// On success, returns short-lived signed URLs for each layer's COG.
export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { email } = await request.json()
    const normalizedEmail = String(email || '').trim().toLowerCase()

    if (!normalizedEmail.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const { data: share, error } = await supabaseAdmin
      .from('property_shares')
      .select('id, title, client_name, bounds, layers, allowed_emails, expires_at')
      .eq('token', params.token)
      .single()

    if (error || !share) {
      return NextResponse.json({ error: 'This share link is invalid.' }, { status: 404 })
    }

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This share link has expired.' }, { status: 410 })
    }

    const allowed: string[] = share.allowed_emails || []
    if (!allowed.includes(normalizedEmail)) {
      return NextResponse.json(
        { error: 'This email is not authorized to view this survey.' },
        { status: 403 }
      )
    }

    const accessToken = signAccessToken(share.id)
    const storedLayers: StoredLayer[] = Array.isArray(share.layers) ? share.layers : []
    const layers = await Promise.all(
      storedLayers.map(async (layer) => {
        const base = {
          type: layer.type,
          bounds: layer.bounds,
          value_min: layer.value_min,
          value_max: layer.value_max,
          plant_count: layer.plant_count,
        }
        // For tiled layers: tilesUrl is the fast path. Also include a signed COG
        // URL so the viewer can switch to live client-side recoloring when the
        // user drags the legend range away from the baked default.
        if (layer.tiled) {
          const out: Record<string, any> = {
            ...base,
            tilesUrl: tileUrlTemplate(layer.type, accessToken),
          }
          if (layer.storage_path) {
            try {
              out.url = await getSignedUrl(BUCKETS.PROPERTY_SHARES, layer.storage_path, SIGNED_URL_TTL)
            } catch {
              // COG not archived for this share — that's fine, slider just won't recolor live.
            }
          }
          return out
        }
        return { ...base, url: await getSignedUrl(BUCKETS.PROPERTY_SHARES, layer.storage_path, SIGNED_URL_TTL) }
      })
    )

    return NextResponse.json({
      title: share.title,
      client_name: share.client_name,
      bounds: share.bounds,
      layers,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load share' },
      { status: 500 }
    )
  }
}
