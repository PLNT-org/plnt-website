// fetch-pilot-upload.mjs — download every file a pilot delivered through an
// upload link into a local folder, ready for the ortho pipeline.
//
//   set -a; source .env.local; set +a
//   node scripts/fetch-pilot-upload.mjs <token or link id> <destination folder> [--concurrency 6]
//
// Skips files already present locally with the same size, so it can be re-run.
// Writes <dest>/manifest.csv with the per-file metadata captured at upload time.
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, statSync, writeFileSync, createWriteStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const BUCKET = 'pilot-uploads'
const [, , ref, dest, ...rest] = process.argv
if (!ref || !dest) { console.error('Usage: node scripts/fetch-pilot-upload.mjs <token|id> <dest> [--concurrency N]'); process.exit(1) }
const conc = Number(rest[rest.indexOf('--concurrency') + 1]) || 6
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Source .env.local first: `set -a; source .env.local; set +a`')
const sb = createClient(url, key)

const col = /^[0-9a-f-]{36}$/i.test(ref) ? 'id' : 'token'
const { data: link, error } = await sb.from('pilot_upload_links').select('*').eq(col, ref).single()
if (error || !link) throw new Error(`No upload link for ${ref}`)
const { data: files } = await sb.from('pilot_upload_files').select('*').eq('link_id', link.id).order('file_name')
console.log(`${link.client_name}${link.site_name ? ' / ' + link.site_name : ''} — ${files.length} files, ${(Number(link.total_bytes) / 1e9).toFixed(2)} GB, status ${link.status}`)
mkdirSync(dest, { recursive: true })
writeFileSync(join(dest, 'manifest.csv'), ['file_name,size_bytes,lat,lon,rel_alt_m,gimbal_pitch_deg,captured_at,camera_model,gps_status,uploaded_at',
  ...files.map((f) => [f.file_name, f.size_bytes, f.lat ?? '', f.lon ?? '', f.rel_alt_m ?? '', f.gimbal_pitch_deg ?? '', f.captured_at ?? '', f.camera_model ?? '', f.gps_status ?? '', f.uploaded_at].join(','))].join('\n'))

let done = 0, skipped = 0, failed = []
const queue = [...files]
async function worker() {
  for (;;) {
    const f = queue.shift(); if (!f) return
    const out = join(dest, f.file_name)
    if (existsSync(out) && statSync(out).size === Number(f.size_bytes)) { skipped++; continue }
    const { data: s, error: e } = await sb.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600)
    if (e || !s) { failed.push(f.file_name); continue }
    try {
      const res = await fetch(s.signedUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await pipeline(Readable.fromWeb(res.body), createWriteStream(out))
      done++
      if ((done + skipped) % 50 === 0) console.log(`  ${done + skipped}/${files.length}`)
    } catch (err) { failed.push(f.file_name); console.error(`  ${f.file_name}: ${err.message}`) }
  }
}
await Promise.all(Array.from({ length: conc }, worker))
console.log(`downloaded ${done}, already present ${skipped}, failed ${failed.length}${failed.length ? ': ' + failed.slice(0, 5).join(', ') : ''}`)
console.log(`next: cd ~/Desktop/PLNT/ortho && ./ortho.sh rgb "${dest}" -o out/<name>`)
