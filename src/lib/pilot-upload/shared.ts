// Shared rules for the pilot upload portal — used by the browser page, the
// public API routes and the admin page, so the three never disagree.

export const PILOT_UPLOAD_BUCKET = 'pilot-uploads'

/** File types a DJI drone produces that the processing pipeline can use. */
export const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.tif', '.tiff', '.dng'] as const
export const MAX_FILE_BYTES = 200 * 1024 * 1024
export const MAX_FILES_PER_BATCH = 200 // per /sign request; the page loops batches

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

export function isAcceptedName(name: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(fileExtension(name))
}

/** Storage object names: keep the DJI filename, strip anything that isn't safe. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || name
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180)
}

export function contentTypeFor(name: string): string {
  const ext = fileExtension(name)
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff'
  if (ext === '.dng') return 'image/x-adobe-dng'
  return 'application/octet-stream'
}

/** Metadata the browser pulls from the DJI XMP packet before uploading. */
export interface DjiMeta {
  lat?: number
  lon?: number
  rel_alt_m?: number
  gimbal_pitch_deg?: number
  captured_at?: string
  camera_model?: string
  gps_status?: string
}

/**
 * Parse the drone-dji XMP attributes from the head of a DJI file. The packet is
 * plain XML inside the first ~100 kB of every Mavic/Matrice JPG and TIF, so a
 * 1 MB slice + regex is all it takes — no EXIF library.
 */
export function parseDjiXmp(head: string): DjiMeta {
  const get = (k: string) => {
    const m = head.match(new RegExp(`drone-dji:${k}="([^"]*)"`))
    return m ? m[1] : undefined
  }
  const num = (k: string) => {
    const v = get(k)
    if (v === undefined) return undefined
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : undefined
  }
  const model = head.match(/tiff:Model="([^"]*)"/)?.[1]
  const utc = get('UTCAtExposure')
  let captured_at: string | undefined
  if (utc) {
    // DJI writes "2026-09-21T18:02:04.133650" or "2023:03:09 02:47:57.725671"
    const iso = utc.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T')
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    if (!Number.isNaN(d.getTime())) captured_at = d.toISOString()
  }
  return {
    lat: num('GpsLatitude'),
    lon: num('GpsLongitude'),
    rel_alt_m: num('RelativeAltitude'),
    gimbal_pitch_deg: num('GimbalPitchDegree'),
    captured_at,
    camera_model: model,
    gps_status: get('GpsStatus'),
  }
}

export interface PilotLinkPublic {
  id: string
  client_name: string
  site_name: string | null
  pilot_name: string | null
  instructions: string | null
  status: 'open' | 'submitted' | 'closed'
  max_files: number
  expires_at: string | null
  file_count: number
  total_bytes: number
}
