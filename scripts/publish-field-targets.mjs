// publish-field-targets.mjs — attach a small set of named field targets (points
// you intend to walk to and measure) to a published flight on a gated share.
//
//   set -a; source .env.local; set +a
//   node scripts/publish-field-targets.mjs scripts/field-targets.example.json
//
// Unlike plant_labels (thousands of anonymous dots), field targets are a handful
// of *identified* specimens carrying per-plant attributes — the ground-truth list
// for a verification walk. They're stored as their own JSON next to the flight's
// points.json and rendered by the share viewer's Field mode (numbered pins +
// live GPS navigation).
//
// Visibility: `viewer_emails` restricts the layer to specific addresses on the
// share's allowlist. Omit it and every authorized viewer sees the targets — for
// internal QA points (confidence scores, "lowest confidence" groupings) you
// almost always want it set.
//
// Side outputs (offline backups for the field): a .gpx of the same waypoints for
// any handheld/phone GPS app, and a printable field sheet with blank columns for
// the measured values.

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const SHARE_BUCKET = 'property-shares'

function extractToken(s) {
  const m = String(s).match(/\/share\/([^/?#\s]+)/)
  return (m ? m[1] : String(s)).trim()
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---- Geometry -------------------------------------------------------------

const R_EARTH = 6371000

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.sqrt(h))
}

// Greedy nearest-neighbour chain — a sane walking order for ~20 scattered
// points. Starts at the north-west-most target so the sheet's order matches
// walking in from one corner rather than criss-crossing the block.
function walkingOrder(targets) {
  if (targets.length === 0) return []
  const remaining = targets.slice()
  let current = remaining.reduce((best, t) =>
    t.lat > best.lat + 1e-9 || (Math.abs(t.lat - best.lat) < 1e-9 && t.lng < best.lng) ? t : best
  )
  remaining.splice(remaining.indexOf(current), 1)
  const route = [{ ...current, legM: 0 }]
  while (remaining.length) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(current, remaining[i])
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    current = remaining.splice(bestIdx, 1)[0]
    route.push({ ...current, legM: bestD })
  }
  return route
}

// ---- Input normalisation --------------------------------------------------

// Pull our target shape out of a GeoJSON FeatureCollection of Points. Property
// names follow the height-validation export; each is optional.
function targetsFromGeoJSON(gj) {
  if (gj?.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
    throw new Error('targets file must be a GeoJSON FeatureCollection of Point features')
  }
  return gj.features.map((f, i) => {
    const p = f.properties || {}
    const g = f.geometry || {}
    if (g.type !== 'Point' || !Array.isArray(g.coordinates)) {
      throw new Error(`feature ${i} is not a Point`)
    }
    const [lng, lat] = g.coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new Error(`feature ${i} has non-numeric coordinates`)
    }
    // "HIGH-01 | MR-B03-0905 | 1.33 m" -> code "HIGH-01"
    const code = String(p.label || '').split('|')[0].trim() || p.plant_id || f.id || `T-${i + 1}`
    return {
      id: String(p.plant_id ?? f.id ?? code),
      code,
      lat: Math.round(lat * 1e7) / 1e7,
      lng: Math.round(lng * 1e7) / 1e7,
      color: p.marker_color || '#2E7D32',
      group: p.confidence_group ?? null,
      block: p.block ?? null,
      species: p.species && p.species !== 'Unknown' ? p.species : null,
      heightM: typeof p.estimated_height_m === 'number' ? p.estimated_height_m : null,
      heightFt: typeof p.estimated_height_ft === 'number' ? p.estimated_height_ft : null,
      confidence: typeof p.confidence_score === 'number' ? p.confidence_score : null,
      status: p.height_status ?? null,
    }
  })
}

// ---- Side outputs ---------------------------------------------------------

function writeGpx(file, name, route) {
  const wpts = route
    .map((t, i) => {
      const desc = [
        t.heightM != null ? `est ${t.heightM.toFixed(2)} m (${(t.heightFt ?? t.heightM * 3.28084).toFixed(1)} ft)` : null,
        t.block != null ? `block ${t.block}` : null,
        t.group,
        t.status,
      ]
        .filter(Boolean)
        .join(' · ')
      return `  <wpt lat="${t.lat}" lon="${t.lng}">
    <name>${esc(`${i + 1}. ${t.code}`)}</name>
    <cmt>${esc(t.id)}</cmt>
    <desc>${esc(desc)}</desc>
    <sym>Flag, Green</sym>
  </wpt>`
    })
    .join('\n')
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PLNT" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
${wpts}
</gpx>
`
  fs.writeFileSync(file, gpx)
}

function writeFieldSheet(file, name, route) {
  const totalM = route.reduce((s, t) => s + t.legM, 0)
  const rows = route
    .map((t, i) => {
      const est =
        t.heightM != null
          ? `${t.heightM.toFixed(2)} m<span class="sub"> / ${(t.heightFt ?? t.heightM * 3.28084).toFixed(1)} ft</span>`
          : '—'
      return `<tr>
  <td class="n">${i + 1}</td>
  <td><span class="chip" style="background:${esc(t.color)}">${esc(t.code)}</span></td>
  <td class="mono">${esc(t.id)}</td>
  <td>${t.block != null ? `B${esc(t.block)}` : '—'}</td>
  <td>${est}</td>
  <td class="mono sm">${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}</td>
  <td class="walk">${i === 0 ? 'start' : `${Math.round(t.legM * 3.28084)} ft`}</td>
  <td class="blank"></td>
  <td class="blank wide"></td>
</tr>`
    })
    .join('\n')

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(name)} — field sheet</title>
<style>
  @page { size: letter portrait; margin: 0.5in; }
  body { font: 12px/1.4 -apple-system, system-ui, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em;
       color: #666; border-bottom: 1.5px solid #333; padding: 4px 5px; }
  td { border-bottom: 1px solid #ddd; padding: 6px 5px; vertical-align: middle; }
  tr:nth-child(even) td { background: #fafafa; }
  .n { font-weight: 700; color: #666; width: 18px; }
  .chip { display: inline-block; color: #fff; font-weight: 700; font-size: 10px;
          padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
  .mono { font-family: ui-monospace, Menlo, monospace; }
  .sm { font-size: 10px; color: #555; }
  .sub { color: #888; font-size: 10px; }
  .walk { font-size: 10px; color: #777; white-space: nowrap; }
  .blank { border-bottom: 1px solid #999; min-width: 60px; }
  .blank.wide { min-width: 130px; }
  .foot { margin-top: 10px; font-size: 10px; color: #777; }
</style></head><body>
<h1>${esc(name)} — height verification</h1>
<div class="meta">${route.length} specimens · walking chain ≈ ${Math.round(totalM * 3.28084).toLocaleString()} ft
  (${Math.round(totalM).toLocaleString()} m) · order is nearest-neighbour from the NW corner</div>
<table>
  <thead><tr>
    <th>#</th><th>Target</th><th>Plant ID</th><th>Blk</th><th>Est. height</th>
    <th>Lat, Lon</th><th>Walk</th><th>Measured</th><th>Notes</th>
  </tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<div class="foot">Measured height in the same unit each time — write "m" or "ft" at the top of the column before you start.</div>
</body></html>
`
  fs.writeFileSync(file, html)
}

// ---- Main -----------------------------------------------------------------

async function main() {
  const cfgPath = process.argv[2]
  if (!cfgPath) throw new Error('Usage: publish-field-targets.mjs <config.json>')
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
  const supabase = createClient(url, key)

  if (!cfg.targets_geojson) throw new Error('config needs "targets_geojson": path to a Point FeatureCollection')
  if (!cfg.flight_key) throw new Error('config needs "flight_key" (e.g. "2026-05-27")')
  const ref = cfg.share_url || cfg.token || cfg.share_id
  if (!ref) throw new Error('config needs one of "share_url" / "token" / "share_id"')

  const gjPath = path.resolve(path.dirname(cfgPath), cfg.targets_geojson)
  const targets = targetsFromGeoJSON(JSON.parse(fs.readFileSync(gjPath, 'utf8')))
  if (!targets.length) throw new Error('no point features in the targets file')

  // Find the share by id or token.
  const q = supabase.from('property_shares').select('id, token, title, flights, layers, allowed_emails')
  const { data: share, error } = cfg.share_id
    ? await q.eq('id', cfg.share_id).single()
    : await q.eq('token', extractToken(ref)).single()
  if (error || !share) throw new Error(`Share not found for ${ref}`)

  const flights = Array.isArray(share.flights) ? share.flights : []
  const flight = flights.find((f) => f.key === cfg.flight_key)
  if (!flight) {
    throw new Error(
      `Flight "${cfg.flight_key}" not found on "${share.title}". Available: ${flights.map((f) => f.key).join(', ')}`
    )
  }
  const rgb = (flight.layers || []).find((l) => l.type === 'rgb')
  if (!rgb) throw new Error(`Flight ${cfg.flight_key} has no rgb layer to hang the targets off`)

  // Restricting to viewer_emails only works for addresses already on the gate.
  const viewerEmails = (cfg.viewer_emails || []).map((e) => String(e).trim().toLowerCase())
  const notAllowed = viewerEmails.filter((e) => !(share.allowed_emails || []).includes(e))
  if (notAllowed.length) {
    throw new Error(
      `These viewer_emails are not on the share's allowlist, so they could never see the layer: ${notAllowed.join(', ')}`
    )
  }

  // Publish in walking order so a pin's number on the map, the row number on the
  // printed sheet, and the GPX waypoint name all refer to the same stop.
  const route = walkingOrder(targets)
  const label = cfg.label || 'Field targets'
  const payload = {
    label,
    flight_key: cfg.flight_key,
    source: path.basename(gjPath),
    order: 'walking',
    targets: route.map(({ legM, ...t }) => t),
  }

  const targetsPath = `${share.id}/${cfg.flight_key}/field-targets.json`
  const body = Buffer.from(JSON.stringify(payload))
  const { error: upErr } = await supabase.storage
    .from(SHARE_BUCKET)
    .upload(targetsPath, body, { contentType: 'application/json', upsert: true })
  if (upErr) throw new Error(`upload field-targets.json: ${upErr.message}`)
  console.log(`  uploaded ${targets.length} targets -> ${targetsPath} (${(body.length / 1e3).toFixed(1)} KB)`)

  rgb.field_targets_path = targetsPath
  rgb.field_targets_label = label
  if (viewerEmails.length) rgb.field_targets_emails = viewerEmails
  else delete rgb.field_targets_emails

  // Mirror to the top-level layers when this is the newest flight (same rule
  // publish-survey/refresh-flight-points use).
  const newest = [...flights].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
  const topLayers = newest && newest.key === cfg.flight_key ? flight.layers : share.layers
  const { error: updErr } = await supabase
    .from('property_shares')
    .update({ flights, layers: topLayers, updated_at: new Date().toISOString() })
    .eq('id', share.id)
  if (updErr) throw new Error(`update share: ${updErr.message}`)

  const outDir = cfg.out_dir ? path.resolve(path.dirname(cfgPath), cfg.out_dir) : path.dirname(gjPath)
  const stem = path.basename(gjPath).replace(/\.geojson$/i, '')
  if (cfg.write_gpx !== false) {
    const gpxFile = path.join(outDir, `${stem}.gpx`)
    writeGpx(gpxFile, `${share.title} — ${label}`, route)
    console.log(`  wrote ${gpxFile}`)
  }
  if (cfg.write_sheet !== false) {
    const sheetFile = path.join(outDir, `${stem}-field-sheet.html`)
    writeFieldSheet(sheetFile, `${share.title} · ${cfg.flight_key}`, route)
    console.log(`  wrote ${sheetFile}`)
  }

  console.log(
    `\n✅ "${label}" attached to ${share.title} · flight ${cfg.flight_key}.` +
      `\n   Visible to: ${viewerEmails.length ? viewerEmails.join(', ') : 'every authorized viewer'}` +
      `\n   Open https://plnt.net/share/${share.token} and pick ${cfg.flight_key}, then "Field mode".`
  )
}

main().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
