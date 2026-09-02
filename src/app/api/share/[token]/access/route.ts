import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { BUCKETS, getSignedUrl } from '@/lib/supabase/storage'
import { signAccessToken } from '@/lib/share/access-token'
import { logShareAccess } from '@/lib/share/access-log'

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
  // A handful of identified specimens to walk to and verify in the field.
  field_targets_path?: string
  field_targets_label?: string
  // When present, only these addresses get the targets — the rest of the
  // allowlist never learns the layer exists (internal QA points, ground truth).
  field_targets_emails?: string[]
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
      await logShareAccess({ request, linkType: 'share', token: params.token, outcome: 'invalid_email' })
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const { data: share, error } = await supabaseAdmin
      .from('property_shares')
      .select('id, title, client_name, bounds, layers, flights, allowed_emails, expires_at')
      .eq('token', params.token)
      .single()

    if (error || !share) {
      await logShareAccess({
        request, linkType: 'share', token: params.token, outcome: 'not_found', email: normalizedEmail,
      })
      return NextResponse.json({ error: 'This share link is invalid.' }, { status: 404 })
    }

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      await logShareAccess({
        request, linkType: 'share', token: params.token, outcome: 'expired',
        email: normalizedEmail, shareId: share.id,
      })
      return NextResponse.json({ error: 'This share link has expired.' }, { status: 410 })
    }

    const allowed: string[] = share.allowed_emails || []
    if (!allowed.includes(normalizedEmail)) {
      await logShareAccess({
        request, linkType: 'share', token: params.token, outcome: 'denied_email',
        email: normalizedEmail, shareId: share.id,
      })
      return NextResponse.json(
        { error: 'This email is not authorized to view this survey.' },
        { status: 403 }
      )
    }

    await logShareAccess({
      request, linkType: 'share', token: params.token, outcome: 'granted',
      email: normalizedEmail, shareId: share.id,
    })

    const accessToken = signAccessToken(share.id)

    // Field targets can be scoped to a subset of the allowlist; an absent list
    // means "everyone who can open this share".
    const canSeeFieldTargets = (layer: StoredLayer) =>
      !layer.field_targets_emails?.length ||
      layer.field_targets_emails.map((e) => e.trim().toLowerCase()).includes(normalizedEmail)

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
        if (layer.field_targets_path && canSeeFieldTargets(layer)) {
          try {
            out.fieldTargetsUrl = await getSignedUrl(
              BUCKETS.PROPERTY_SHARES,
              layer.field_targets_path,
              SIGNED_URL_TTL
            )
            out.fieldTargetsLabel = layer.field_targets_label || 'Field targets'
          } catch {
            // No targets file — Field mode just won't be offered.
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

    // Per-share view policy: confine the map to the surveyed parcel — the
    // landing view is the zoom floor and panning is clamped to it. Stored on
    // the layer JSON (same place the field-targets policy lives).
    const lockToParcel =
      (Array.isArray(share.layers) ? share.layers : []).some((l: any) => l?.lock_to_parcel) ||
      storedFlights.some((f) => (f.layers || []).some((l: any) => (l as any)?.lock_to_parcel))

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
      // When true the map won't zoom or pan beyond the surveyed parcel.
      lockToParcel,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load share' },
      { status: 500 }
    )
  }
}
