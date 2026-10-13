'use client'
// Admin: create upload links for contract pilots and watch what arrives.
import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/auth/auth-fetch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Check, Copy, Loader2, Lock, Trash2, Unlock } from 'lucide-react'

interface PilotLink {
  id: string; token: string; pilot_name: string | null; pilot_email: string | null; client_name: string; site_name: string | null
  instructions: string | null; status: 'open' | 'submitted' | 'closed'; max_files: number; expires_at: string | null
  submitted_at: string | null; submitted_notes: string | null; file_count: number; total_bytes: number; last_upload_at: string | null; created_at: string
}
interface PilotFile { file_name: string; size_bytes: number; lat: number | null; lon: number | null; rel_alt_m: number | null; gimbal_pitch_deg: number | null; captured_at: string | null; camera_model: string | null; gps_status: string | null }

const fmtGB = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`
const DEFAULT_INSTRUCTIONS = `Please upload every image from the flight exactly as it came off the SD card (DJI_XXXX.JPG and any .TIF files). Don't rename, resize or export through another app.
Flight spec: nadir (camera straight down), 75% front / 70% side overlap, altitude as agreed, RTK on if available.`

export default function PilotUploadsAdmin() {
  const [links, setLinks] = useState<PilotLink[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, PilotFile[]>>({})
  const [form, setForm] = useState({ client_name: '', site_name: '', pilot_name: '', pilot_email: '', expires_in_days: '30', instructions: DEFAULT_INSTRUCTIONS })

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/pilot-uploads')
    const data = await res.json()
    if (res.ok) setLinks(data.links)
    setLoading(false)
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  const create = async () => {
    if (!form.client_name.trim()) return
    setCreating(true)
    const res = await authFetch('/api/admin/pilot-uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setCreating(false)
    if (res.ok) { setForm((f) => ({ ...f, client_name: '', site_name: '', pilot_name: '', pilot_email: '' })); load() }
    else alert((await res.json()).error || 'Could not create link')
  }
  const setStatus = async (id: string, status: PilotLink['status']) => {
    await authFetch('/api/admin/pilot-uploads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); load()
  }
  const remove = async (l: PilotLink) => {
    if (!confirm(`Delete the link for ${l.client_name} and all ${l.file_count} received files? This cannot be undone.`)) return
    await authFetch(`/api/admin/pilot-uploads?id=${l.id}`, { method: 'DELETE' }); load()
  }
  const copyLink = (token: string) => { navigator.clipboard.writeText(`${window.location.origin}/upload/${token}`); setCopied(token); setTimeout(() => setCopied(''), 1500) }
  const toggleFiles = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (!files[id]) { const res = await authFetch(`/api/admin/pilot-uploads/files?id=${id}`); const d = await res.json(); if (res.ok) setFiles((f) => ({ ...f, [id]: d.files })) }
  }
  const summary = (fs: PilotFile[]) => {
    const gps = fs.filter((f) => f.lat != null).length; const alts = fs.map((f) => f.rel_alt_m).filter((v): v is number => v != null)
    const nadir = fs.filter((f) => (f.gimbal_pitch_deg ?? 0) <= -80).length; const t = fs.map((f) => f.captured_at).filter(Boolean).sort() as string[]
    const rtk = fs.filter((f) => f.gps_status === 'RTK').length
    return `${fs.length} files · ${gps} with GPS${rtk ? ` (${rtk} RTK)` : ''} · ${nadir} nadir · ${alts.length ? `${Math.min(...alts).toFixed(0)}–${Math.max(...alts).toFixed(0)} m AGL` : 'no altitude'}${t.length ? ` · ${t[0].slice(0, 10)} ${t[0].slice(11, 16)}–${t[t.length - 1].slice(11, 16)} UTC` : ''}`
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Pilot uploads</h1><p className="text-gray-600">Links for contract pilots to deliver raw DJI imagery. Fetch a finished upload with <code className="rounded bg-gray-100 px-1">node scripts/fetch-pilot-upload.mjs &lt;token&gt; &lt;folder&gt;</code>.</p></div>
      <Card>
        <CardHeader><CardTitle>New upload link</CardTitle><CardDescription>One link per flight or site. The pilot needs no account; the link is the credential, so send it privately.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Client / property (required)" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
            <Input placeholder="Site or block (optional)" value={form.site_name} onChange={(e) => setForm({ ...form, site_name: e.target.value })} />
            <Input placeholder="Pilot name" value={form.pilot_name} onChange={(e) => setForm({ ...form, pilot_name: e.target.value })} />
            <Input placeholder="Pilot email" type="email" value={form.pilot_email} onChange={(e) => setForm({ ...form, pilot_email: e.target.value })} />
            <Input placeholder="Expires in days (blank = never)" value={form.expires_in_days} onChange={(e) => setForm({ ...form, expires_in_days: e.target.value })} />
          </div>
          <textarea className="w-full rounded-md border px-3 py-2 text-sm" rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="Instructions shown to the pilot" />
          <Button onClick={create} disabled={creating || !form.client_name.trim()}>{creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create link</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Links</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : links.length === 0 ? <p className="text-sm text-gray-500">No links yet.</p> : (
            <div className="divide-y">
              {links.map((l) => (
                <div key={l.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.status === 'submitted' ? 'bg-green-100 text-green-800' : l.status === 'closed' ? 'bg-gray-200 text-gray-700' : 'bg-blue-100 text-blue-800'}`}>{l.status}</span>
                    <span className="font-medium">{l.client_name}</span>{l.site_name && <span className="text-gray-500">· {l.site_name}</span>}
                    {l.pilot_name && <span className="text-gray-500">· {l.pilot_name}{l.pilot_email ? ` <${l.pilot_email}>` : ''}</span>}
                    <span className="ml-auto text-sm text-gray-600">{l.file_count} files · {fmtGB(Number(l.total_bytes))}{l.last_upload_at ? ` · last ${new Date(l.last_upload_at).toLocaleString()}` : ''}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                    <code className="rounded bg-gray-100 px-1">/upload/{l.token}</code>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy link" onClick={() => copyLink(l.token)}>{copied === l.token ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</Button>
                    <span>created {new Date(l.created_at).toLocaleDateString()}{l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleDateString()}` : ''}{l.submitted_at ? ` · submitted ${new Date(l.submitted_at).toLocaleString()}` : ''}</span>
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => toggleFiles(l.id)}>{open === l.id ? 'Hide files' : 'Files'}</Button>
                      {l.status === 'closed' ? <Button size="sm" variant="ghost" onClick={() => setStatus(l.id, 'open')}><Unlock className="mr-1 h-3 w-3" />Reopen</Button> : <Button size="sm" variant="ghost" onClick={() => setStatus(l.id, 'closed')}><Lock className="mr-1 h-3 w-3" />Close</Button>}
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(l)}><Trash2 className="h-3 w-3" /></Button>
                    </span>
                  </div>
                  {l.submitted_notes && <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-sm text-gray-700">{l.submitted_notes}</p>}
                  {open === l.id && (
                    <div className="mt-2 text-sm">
                      {!files[l.id] ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : files[l.id].length === 0 ? <span className="text-gray-500">No files yet.</span> : (
                        <><p className="text-gray-700">{summary(files[l.id])}</p>
                        <div className="mt-1 max-h-48 overflow-auto rounded border font-mono text-xs">
                          {files[l.id].map((f) => <div key={f.file_name} className="flex gap-3 border-b px-2 py-0.5 last:border-0"><span className="w-64 truncate">{f.file_name}</span><span className="w-16 text-right">{(Number(f.size_bytes) / 1e6).toFixed(1)} MB</span><span className="w-40">{f.lat != null ? `${f.lat.toFixed(6)}, ${f.lon!.toFixed(6)}` : 'no GPS'}</span><span className="w-16">{f.rel_alt_m != null ? `${f.rel_alt_m.toFixed(0)} m` : ''}</span><span className="w-12">{f.gimbal_pitch_deg != null ? `${f.gimbal_pitch_deg.toFixed(0)}°` : ''}</span></div>)}
                        </div></>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
