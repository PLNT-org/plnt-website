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
  points_path?: string
  max_zoom?: number // deepest zoom level tiles were generated for (default 22)
}

interface StoredFlight {
  key: string
  date: string | null
  label?: string | null // shown in the dropdown instead of the date when set
  bounds?: { north: number; south: number; east: number; west: number }
  layers: StoredLayer[]
}

// Gated XYZ tile URL template — served through the proxy that validates the
// access token and streams from the private property-shares bucket. `flightKey`
// selects the dated orthophoto within the share.
function tileUrlTemplate(flightKey: string, layerType: string, accessToken: string): string {
  return `/api/share/tiles/${flightKey}/${layerType}/{z}/{x}/{y}?k=${accessToken}`
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
      .select('id, title, client_name, bounds, layers, flights, allowed_emails, expires_at')
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

    // Resolve a stored layer into client-ready URLs for a given flight.
    const resolveLayer = async (flightKey: string, layer: StoredLayer) => {
      const base = {
        type: layer.type,
        bounds: layer.bounds,
        value_min: layer.value_min,
        value_max: layer.value_max,
        plant_count: layer.plant_count,
        maxNativeZoom: layer.max_zoom ?? 22,
      }
      if (layer.tiled) {
        const out: Record<string, any> = { ...base, tilesUrl: tileUrlTemplate(flightKey, layer.type, accessToken) }
        if (layer.storage_path) {
          try {
            out.url = await getSignedUrl(BUCKETS.PROPERTY_SHARES, layer.storage_path, SIGNED_URL_TTL)
          } catch {
            // COG not archived — fine, the legend slider just won't recolor live.
          }
        }
        if (layer.points_path) {
          try {
            out.pointsUrl = await getSignedUrl(BUCKETS.PROPERTY_SHARES, layer.points_path, SIGNED_URL_TTL)
          } catch {
            // No points file — map just won't draw per-plant dots.
          }
        }
        return out
      }
      return { ...base, url: await getSignedUrl(BUCKETS.PROPERTY_SHARES, layer.storage_path, SIGNED_URL_TTL) }
    }

    // Build the dated flights. Fall back to a single 'legacy' flight from the
    // share's top-level layers if it hasn't been backfilled yet.
    const storedFlights: StoredFlight[] =
      Array.isArray(share.flights) && share.flights.length > 0
        ? share.flights
        : [{ key: 'legacy', date: null, bounds: share.bounds, layers: Array.isArray(share.layers) ? share.layers : [] }]

    const flights = await Promise.all(
      storedFlights.map(async (f) => ({
        key: f.key,
        date: f.date ?? null,
        label: f.label ?? null,
        bounds: f.bounds ?? share.bounds,
        layers: await Promise.all((f.layers || []).map((l) => resolveLayer(f.key, l))),
      }))
    )
    // Newest first (nulls last).
    flights.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    const latest = flights[0]
    const layers = latest?.layers ?? []

    // Locations for the switcher: other parcels this email can view, scoped to
    // the SAME client as this share so one client's link never lists another
    // client's parcels (e.g. the operator, who is on everything). Gated by having
    // just cleared this share's email check above.
    const sameClient = (share.client_name || '').trim().toLowerCase()
    const { data: locShares } = await supabaseAdmin
      .from('property_shares')
      .select('token, title, client_name, expires_at, flights')
      .contains('allowed_emails', [normalizedEmail])
    const now = Date.now()
    const locations = (locShares || [])
      .filter((s) => (s.client_name || '').trim().toLowerCase() === sameClient)
      .filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now)
      .map((s) => {
        const fl: StoredFlight[] =
          Array.isArray(s.flights) && s.flights.length > 0 ? s.flights : [{ key: 'legacy', date: null, layers: [] }]
        return {
          token: s.token,
          title: s.title,
          client_name: s.client_name,
          // Just keys + dates + labels for the per-parcel dropdown (newest first).
          flights: fl
            .map((f) => ({ key: f.key, date: f.date ?? null, label: f.label ?? null }))
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
        }
      })

    return NextResponse.json({
      title: share.title,
      client_name: share.client_name,
      bounds: latest?.bounds ?? share.bounds,
      layers, // latest flight's layers (back-compat)
      // Lets the viewer call the gated plots API (draw/save boundary plots).
      accessToken,
      // All locations (shares) this email can view; powers the location dropdown.
      locations,
      // Dated orthophoto sets; powers the flight-date dropdown.
      flights,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load share' },
      { status: 500 }
    )
  }
}
