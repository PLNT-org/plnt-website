'use client'
// Pilot upload portal: /upload/<token>
// A contract pilot drops a DJI flight folder here. Files go straight from the
// browser to Supabase Storage via per-file signed URLs (minted by /sign), four
// at a time, with retries; completed files are recorded via /files with the GPS
// and altitude read from each file's DJI XMP. Re-dropping the same folder after
// a dropped connection skips everything already received.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import { useDropzone } from 'react-dropzone'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { AlertCircle, CheckCircle2, FolderUp, Loader2, Pause, Play, Plane, Satellite, Mountain, Camera } from 'lucide-react'
import {
  PILOT_UPLOAD_BUCKET, MAX_FILES_PER_BATCH, isAcceptedName, safeFileName, contentTypeFor, parseDjiXmp,
  type DjiMeta, type PilotLinkPublic,
} from '@/lib/pilot-upload/shared'

type FileState = 'queued' | 'uploading' | 'done' | 'skipped' | 'rejected' | 'failed'
interface Item { file: File; name: string; size: number; state: FileState; reason?: string; meta?: DjiMeta }

const CONCURRENCY = 4
const fmtGB = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`

async function readXmp(file: File): Promise<DjiMeta> {
  try {
    const head = await file.slice(0, 1_200_000).text()
    return parseDjiXmp(head)
  } catch { return {} }
}

export default function PilotUploadPage() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string)
  const [link, setLink] = useState<PilotLinkPublic | null>(null)
  const [loadError, setLoadError] = useState('')
  const [received, setReceived] = useState<Map<string, number>>(new Map())
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [doneBytes, setDoneBytes] = useState(0)
  const [pilotName, setPilotName] = useState('')
  const [pilotEmail, setPilotEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{ file_count: number; total_bytes: number } | null>(null)
  const [error, setError] = useState('')
  const pausedRef = useRef(false)
  const itemsRef = useRef<Item[]>([])
  itemsRef.current = items

  const load = useCallback(async () => {
    const res = await fetch(`/api/pilot-upload/${token}`, { cache: 'no-store' })
    const data = await res.json()
    if (!res.ok) { setLoadError(data.error || 'This upload link is invalid.'); return }
    setLink(data.link)
    setReceived(new Map((data.uploaded as { name: string; size: number }[]).map((u) => [u.name, u.size])))
    if (data.link.pilot_name) setPilotName((p) => p || data.link.pilot_name)
  }, [token])
  useEffect(() => { load() }, [load])

  const closedReason = useMemo(() => {
    if (!link) return ''
    if (link.status === 'closed') return 'This upload link has been closed.'
    if (link.expires_at && new Date(link.expires_at) < new Date()) return 'This upload link has expired.'
    return ''
  }, [link])

  const onDrop = useCallback((accepted: File[]) => {
    setError('')
    const seen = new Set(itemsRef.current.map((i) => i.name))
    const fresh: Item[] = []
    for (const f of accepted) {
      const name = safeFileName(f.name)
      if (seen.has(name)) continue
      seen.add(name)
      if (!isAcceptedName(name)) { fresh.push({ file: f, name, size: f.size, state: 'rejected', reason: 'not a DJI image' }); continue }
      const got = received.get(name)
      if (got !== undefined && got === f.size) { fresh.push({ file: f, name, size: f.size, state: 'skipped', reason: 'already received' }); continue }
      fresh.push({ file: f, name, size: f.size, state: 'queued' })
    }
    setItems((prev) => [...prev, ...fresh])
  }, [received])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop, noClick: true, noKeyboard: true, useFsAccessApi: false, disabled: !!closedReason || !!submitted,
  })

  // Upload loop: sign a batch, run CONCURRENCY workers, record the finished ones.
  const start = useCallback(async () => {
    if (running) return
    setRunning(true); setPaused(false); pausedRef.current = false; setError('')
    const update = (name: string, patch: Partial<Item>) =>
      setItems((prev) => prev.map((i) => (i.name === name ? { ...i, ...patch } : i)))
    try {
      for (;;) {
        if (pausedRef.current) break
        const queued = itemsRef.current.filter((i) => i.state === 'queued' || i.state === 'failed').slice(0, MAX_FILES_PER_BATCH)
        if (!queued.length) break
        const res = await fetch(`/api/pilot-upload/${token}/sign`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: queued.map((q) => ({ name: q.name, size: q.size })) }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not prepare the upload')
        for (const r of data.rejected as { name: string; reason: string }[]) update(r.name, { state: 'rejected', reason: r.reason })
        const signed = data.signed as { name: string; path: string; token: string }[]
        const byName = new Map(queued.map((q) => [q.name, q]))
        const finished: { name: string; size: number; meta: DjiMeta }[] = []
        let idx = 0
        const worker = async () => {
          for (;;) {
            if (pausedRef.current) return
            const s = signed[idx++]
            if (!s) return
            const it = byName.get(s.name)!
            update(s.name, { state: 'uploading' })
            const meta = it.meta || (await readXmp(it.file))
            let ok = false
            for (let attempt = 0; attempt < 3 && !ok; attempt++) {
              const { error: upErr } = await supabase.storage
                .from(PILOT_UPLOAD_BUCKET)
                .uploadToSignedUrl(s.path, s.token, it.file, { contentType: contentTypeFor(s.name), upsert: true })
              ok = !upErr
              if (!ok) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
            }
            if (ok) { finished.push({ name: s.name, size: it.size, meta }); update(s.name, { state: 'done', meta }); setDoneBytes((b) => b + it.size) }
            else update(s.name, { state: 'failed', reason: 'upload failed, will retry' })
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker))
        if (finished.length) {
          const rec = await fetch(`/api/pilot-upload/${token}/files`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: finished }),
          })
          const rd = await rec.json()
          for (const m of (rd.missing || []) as string[]) update(m, { state: 'failed', reason: 'not found after upload, will retry' })
          setReceived((prev) => { const n = new Map(prev); finished.forEach((f) => n.set(f.name, f.size)); return n })
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload stopped unexpectedly. Press Resume to continue.')
    } finally {
      setRunning(false)
    }
  }, [running, token])

  // Auto-start whenever new queued files appear and nothing is running.
  useEffect(() => {
    if (!running && !paused && !submitted && items.some((i) => i.state === 'queued')) start()
  }, [items, running, paused, submitted, start])

  const submit = async () => {
    setSubmitting(true); setError('')
    try {
      const res = await fetch(`/api/pilot-upload/${token}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pilot_name: pilotName, pilot_email: pilotEmail, notes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not submit')
      setSubmitted({ file_count: data.file_count, total_bytes: data.total_bytes })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit')
    } finally { setSubmitting(false) }
  }

  const counts = useMemo(() => {
    const c = { queued: 0, uploading: 0, done: 0, skipped: 0, rejected: 0, failed: 0, bytes: 0 }
    for (const i of items) { c[i.state]++; if (i.state !== 'rejected' && i.state !== 'skipped') c.bytes += i.size }
    return c
  }, [items])
  const totalReceived = received.size
  const pct = counts.bytes ? Math.min(100, (doneBytes / counts.bytes) * 100) : 0
  const allLanded = items.length > 0 && counts.queued + counts.uploading + counts.failed === 0
  // Coverage sanity from the metadata we parsed on the way through.
  const metaStats = useMemo(() => {
    const m = items.filter((i) => i.state === 'done' && i.meta)
    const gps = m.filter((i) => i.meta!.lat != null).length
    const alts = m.map((i) => i.meta!.rel_alt_m).filter((v): v is number => typeof v === 'number')
    const nadir = m.filter((i) => (i.meta!.gimbal_pitch_deg ?? 0) <= -80).length
    const rtk = m.filter((i) => i.meta!.gps_status === 'RTK').length
    return { n: m.length, gps, nadir, rtk, altMin: alts.length ? Math.min(...alts) : null, altMax: alts.length ? Math.max(...alts) : null }
  }, [items])

  const header = (
    <header className="bg-[#0f2e1d] text-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Image src="/images/plnt-logo-darkbg.svg" alt="PLNT" width={120} height={40} className="h-9 w-auto" priority />
        <span className="text-sm text-green-200/80">Pilot imagery upload</span>
      </div>
    </header>
  )

  if (loadError) return (
    <div className="min-h-screen bg-gray-50">{header}
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
        <h1 className="mt-4 text-xl font-semibold text-[#0f2e1d]">{loadError}</h1>
        <p className="mt-2 text-gray-600">Check the link you were sent, or contact PLNT at porter@plnt.net.</p>
      </main>
    </div>
  )
  if (!link) return (
    <div className="min-h-screen bg-gray-50">{header}<main className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></main></div>
  )
  if (submitted) return (
    <div className="min-h-screen bg-gray-50">{header}
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h1 className="mt-4 text-2xl font-semibold text-[#0f2e1d]">Upload received — thank you</h1>
        <p className="mt-3 text-gray-700">{submitted.file_count} files ({fmtGB(submitted.total_bytes)}) for <strong>{link.client_name}</strong>{link.site_name ? `, ${link.site_name}` : ''} are with PLNT. We&apos;ll process the flight and be in touch if anything is missing.</p>
        <p className="mt-6 text-sm text-gray-500">Found another folder? This link still works — just come back and drop it in.</p>
        <Button variant="outline" className="mt-4" onClick={() => setSubmitted(null)}>Upload more files</Button>
      </main>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">{header}
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#0f2e1d]">{link.client_name}{link.site_name ? <span className="text-gray-500 font-normal"> · {link.site_name}</span> : null}</h1>
          <p className="mt-1 text-gray-600">Upload the complete DJI flight folder{link.pilot_name ? `, ${link.pilot_name}` : ''}. Hundreds of files are fine; keep this tab open until the bar reaches 100%.</p>
          {link.instructions && <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-[#0f2e1d] whitespace-pre-wrap">{link.instructions}</div>}
          {totalReceived > 0 && items.length === 0 && <p className="mt-3 text-sm text-gray-600">{totalReceived} files already received on this link. Dropping the same folder again will only send what&apos;s missing.</p>}
        </div>

        {closedReason ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">{closedReason} Contact porter@plnt.net if you still need to deliver files.</div>
        ) : (
          <div {...getRootProps()} className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${isDragActive ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white'}`}>
            <input {...getInputProps()} />
            <FolderUp className="mx-auto h-10 w-10 text-[#0f2e1d]" />
            <p className="mt-3 text-lg font-medium text-[#0f2e1d]">Drag the flight folder here</p>
            <p className="mt-1 text-sm text-gray-500">DJI .JPG and .TIF files · everything else is ignored · nothing leaves this page except to PLNT&apos;s storage</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={open} className="bg-[#0f2e1d] hover:bg-[#143d27]">Choose files</Button>
              <label className="inline-flex cursor-pointer items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50">
                Choose a folder
                {/* webkitdirectory lets Chrome/Edge/Safari pick a whole folder at once */}
                <input type="file" multiple className="hidden" onChange={(e) => onDrop(Array.from(e.target.files || []))}
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
              </label>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <section className="mt-6 rounded-xl border bg-white p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                <strong className="text-[#0f2e1d]">{counts.done + counts.skipped}</strong> of {items.length - counts.rejected} files received · {fmtGB(doneBytes)} of {fmtGB(counts.bytes)} sent
                {counts.skipped > 0 && <span className="text-gray-500"> · {counts.skipped} already on file</span>}
                {counts.rejected > 0 && <span className="text-amber-700"> · {counts.rejected} ignored (not DJI images)</span>}
                {counts.failed > 0 && <span className="text-red-700"> · {counts.failed} to retry</span>}
              </div>
              <div className="flex items-center gap-2">
                {running && !paused && <Button size="sm" variant="outline" onClick={() => { pausedRef.current = true; setPaused(true) }}><Pause className="mr-1 h-4 w-4" />Pause</Button>}
                {!running && (counts.queued + counts.failed > 0) && <Button size="sm" onClick={start} className="bg-[#0f2e1d] hover:bg-[#143d27]"><Play className="mr-1 h-4 w-4" />{paused ? 'Resume' : 'Retry'}</Button>}
                {running && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              </div>
            </div>
            <Progress value={allLanded ? 100 : pct} className="mt-3 h-3" />
            {metaStats.n > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"><Camera className="h-4 w-4 text-gray-500" /><span>{metaStats.n} checked</span></div>
                <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"><Satellite className="h-4 w-4 text-gray-500" /><span>{metaStats.gps} with GPS{metaStats.rtk ? ` (${metaStats.rtk} RTK)` : ''}</span></div>
                <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"><Mountain className="h-4 w-4 text-gray-500" /><span>{metaStats.altMin != null ? `${metaStats.altMin.toFixed(0)}–${metaStats.altMax!.toFixed(0)} m AGL` : 'altitude —'}</span></div>
                <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"><Plane className="h-4 w-4 text-gray-500" /><span>{metaStats.nadir} nadir frames</span></div>
              </div>
            )}
            {metaStats.n > 20 && metaStats.gps < metaStats.n * 0.9 && (
              <p className="mt-3 text-sm text-amber-700">Many files have no GPS position. Check the drone was recording position and that these are the original files from the SD card, not copies exported by an app.</p>
            )}
          </section>
        )}

        {error && <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        {(allLanded || totalReceived > 0) && !closedReason && (
          <section className="mt-6 rounded-xl border bg-white p-5">
            <h2 className="font-semibold text-[#0f2e1d]">Finish</h2>
            <p className="mt-1 text-sm text-gray-600">When every folder from the flight is in, tell us it&apos;s complete and we&apos;ll start processing.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input placeholder="Your name" value={pilotName} onChange={(e) => setPilotName(e.target.value)} />
              <Input placeholder="Your email (for questions about the flight)" type="email" value={pilotEmail} onChange={(e) => setPilotEmail(e.target.value)} />
            </div>
            <textarea className="mt-3 w-full rounded-md border px-3 py-2 text-sm" rows={3} placeholder="Notes: flight altitude, overlap, anything that went wrong, areas you couldn't cover…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button className="mt-3 bg-[#0f2e1d] hover:bg-[#143d27]" disabled={submitting || running || (!allLanded && items.length > 0)} onClick={submit}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Mark upload complete
            </Button>
          </section>
        )}
        <footer className="mt-10 text-center text-xs text-gray-400">&copy; 2024&ndash;2026 PLNT Network LLC · Questions: porter@plnt.net</footer>
      </main>
    </div>
  )
}
