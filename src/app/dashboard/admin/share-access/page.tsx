'use client'

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/auth/auth-fetch'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RefreshCw } from 'lucide-react'

interface Entry {
  id: string
  link_type: 'share' | 'portal'
  token: string
  share_id: string | null
  share_label: string | null
  email: string | null
  outcome: 'granted' | 'denied_email' | 'expired' | 'not_found' | 'invalid_email'
  ip: string | null
  user_agent: string | null
  created_at: string
}

const OUTCOME_LABEL: Record<Entry['outcome'], string> = {
  granted: 'Opened',
  denied_email: 'Wrong email',
  expired: 'Expired link',
  not_found: 'Unknown link',
  invalid_email: 'No email entered',
}

const OUTCOME_STYLE: Record<Entry['outcome'], string> = {
  granted: 'bg-green-100 text-green-800',
  denied_email: 'bg-amber-100 text-amber-800',
  expired: 'bg-gray-100 text-gray-700',
  not_found: 'bg-red-100 text-red-800',
  invalid_email: 'bg-gray-100 text-gray-700',
}

export default function ShareAccessPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch('/api/admin/share-access?limit=200')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load access log')
      setEntries(json.entries || [])
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const q = filter.trim().toLowerCase()
  const shown = q
    ? entries.filter((e) =>
        [e.email, e.share_label, e.token].some((v) => (v || '').toLowerCase().includes(q))
      )
    : entries

  const opens = entries.filter((e) => e.outcome === 'granted').length
  const failures = entries.length - opens

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Share link access</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every attempt to open a gated client link — {opens} opened, {failures} failed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by email, client, or token"
            className="w-64"
          />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-500">
          {entries.length === 0
            ? 'No access recorded yet. Entries appear here the first time a client opens a link.'
            : 'Nothing matches that filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Outcome</th>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Link</th>
                <th className="px-3 py-2 text-left font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {formatDistanceToNow(new Date(e.created_at))} ago
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLE[e.outcome]}`}>
                      {OUTCOME_LABEL[e.outcome]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-900">{e.email || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {e.share_label || (
                      <span className="font-mono text-xs text-gray-500">
                        {e.link_type}/{e.token.slice(0, 12)}…
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
                    {e.ip || <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
