'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { authFetch } from '@/lib/auth/auth-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  ArrowLeft, Copy, Check, Trash2, Users, Pencil, Terminal, Loader2,
} from 'lucide-react'

type LayerType = 'rgb' | 'ndvi' | 'chm'

interface ShareRow {
  id: string
  token: string
  title: string
  client_name: string | null
  allowed_emails: string[]
  layers: { type: LayerType }[]
  expires_at: string | null
  created_at: string
}

interface EditState {
  id: string
  title: string
  client_name: string
  emails: string
  expires_at: string // YYYY-MM-DD or ''
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isoToDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export default function ShareLinksPage() {
  const [shares, setShares] = useState<ShareRow[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  const SNIPPET = 'node scripts/publish-survey.mjs scripts/north-field.json'

  const loadShares = async () => {
    const res = await authFetch('/api/admin/property-shares')
    if (res.ok) {
      const data = await res.json()
      setShares(data.shares || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadShares()
  }, [])

  const startEdit = (s: ShareRow) => {
    setEditError('')
    setEditing({
      id: s.id,
      title: s.title,
      client_name: s.client_name || '',
      emails: (s.allowed_emails || []).join('\n'),
      expires_at: isoToDateInput(s.expires_at),
    })
  }

  const save = async () => {
    if (!editing) return
    setEditError('')
    if (!editing.title.trim()) return setEditError('Title is required.')
    if (!editing.emails.trim()) return setEditError('At least one authorized email is required.')

    setSaving(true)
    const res = await authFetch('/api/admin/property-shares', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing.id,
        title: editing.title,
        client_name: editing.client_name,
        allowed_emails: editing.emails,
        expires_at: editing.expires_at ? new Date(editing.expires_at + 'T23:59:59').toISOString() : null,
      }),
    })
    if (res.ok) {
      await loadShares()
      setEditing(null)
    } else {
      const e = await res.json()
      setEditError(e.error || 'Failed to save')
    }
    setSaving(false)
  }

  const deleteShare = async (id: string, title: string) => {
    if (!UUID_RE.test(id)) return
    if (!confirm(`Delete "${title}" and all its tiles? This cannot be undone.`)) return
    await authFetch(`/api/admin/property-shares?id=${id}`, { method: 'DELETE' })
    await loadShares()
  }

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/share/${token}`
    navigator.clipboard.writeText(url)
    setCopied(token)
    setTimeout(() => setCopied(null), 1500)
  }

  const copySnippet = () => {
    navigator.clipboard.writeText(SNIPPET)
    setSnippetCopied(true)
    setTimeout(() => setSnippetCopied(false), 1500)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/admin/share">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Shareable Survey Links</h1>
          <p className="text-sm text-gray-500">
            Email-gated client maps. Publish via the CLI; manage existing links here.
          </p>
        </div>
        <Link href="/dashboard/admin/share">
          <Button variant="outline" size="sm">
            <Users className="h-4 w-4 mr-2" />
            Account sharing
          </Button>
        </Link>
      </div>

      {/* How to publish */}
      <Card className="mb-6 border-green-200 bg-green-50/50">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-3">
            <Terminal className="h-5 w-5 text-green-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">Publish a new survey</h2>
              <p className="text-sm text-gray-600 mt-1">
                Fill in a config from <code className="text-xs bg-white px-1 py-0.5 rounded border">scripts/survey.example.json</code> (paths, title, authorized emails), then run:
              </p>
              <div className="mt-2 flex items-stretch gap-2">
                <code className="flex-1 text-xs bg-white border border-gray-200 rounded px-2.5 py-2 font-mono overflow-x-auto whitespace-nowrap">
                  {SNIPPET}
                </code>
                <Button size="sm" variant="outline" onClick={copySnippet} className="shrink-0">
                  {snippetCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                The pipeline converts your raw GeoTIFFs to COGs, computes NDVI, generates WebP tile pyramids,
                and creates the share — printing the link when it&rsquo;s done.
                To re-tile an existing survey in place, set <code className="text-xs bg-white px-1 rounded border">&quot;share_id&quot;</code> in the config.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Existing links */}
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold mb-4">Existing links</h2>
          {loading ? (
            <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : shares.length === 0 ? (
            <p className="text-sm text-gray-500">No share links yet — publish your first survey with the command above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Layers</TableHead>
                  <TableHead className="text-center">Emails</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shares.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.title}
                      {s.client_name && <div className="text-xs text-gray-400">{s.client_name}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(s.layers || []).map((l) => (
                          <Badge key={l.type} variant="secondary" className="uppercase text-[10px]">{l.type}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 text-center tabular-nums">
                      {(s.allowed_emails || []).length}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {s.expires_at ? new Date(s.expires_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit metadata" onClick={() => startEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Copy link" onClick={() => copyLink(s.token)}>
                          {copied === s.token ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700" title="Delete" onClick={() => deleteShare(s.id, s.title)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit share metadata</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Title</label>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Client name (optional)</label>
                <Input value={editing.client_name} onChange={(e) => setEditing({ ...editing, client_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Authorized emails</label>
                <Textarea
                  rows={4}
                  value={editing.emails}
                  onChange={(e) => setEditing({ ...editing, emails: e.target.value })}
                  placeholder="client@example.com, manager@example.com"
                />
                <p className="text-xs text-gray-400 mt-1">Separate with commas or new lines.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Expires (optional)</label>
                <Input type="date" value={editing.expires_at} onChange={(e) => setEditing({ ...editing, expires_at: e.target.value })} />
              </div>
              {editError && <p className="text-sm text-red-600">{editError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
