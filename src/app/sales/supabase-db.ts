/**
 * Storage adapter for the Sales Desk.
 *
 * The desk was written against a small document-store API (doc/collection,
 * set/delete, onSnapshot). This file implements that same API on top of the
 * three Supabase tables from supabase/migrations/20260916_add_sales_desk.sql,
 * so the app code did not have to change when it moved to plnt.net/sales.
 *
 * Each table holds one row per document: `id` plus a `doc` JSONB body.
 * Live updates ride Supabase Realtime (postgres_changes); a 60 s poll and a
 * refresh-on-focus cover the case where Realtime is unavailable.
 */
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

const TABLES: Record<string, string> = {
  orgs: 'sales_orgs',
  templates: 'sales_templates',
  settings: 'sales_settings',
}

type Doc = Record<string, unknown>
interface Snap {
  id: string
  exists: boolean
  data(): Doc | undefined
}
interface QuerySnap {
  docs: Snap[]
  size: number
  empty: boolean
}
type Unsub = () => void
type ErrCb = (e: { code: string; message: string }) => void

function snap(id: string, doc: Doc | null | undefined): Snap {
  return { id, exists: !!doc, data: () => doc ?? undefined }
}

function wrap(error: { code?: string; message: string }) {
  // 42501 is Postgres "insufficient privilege" — what RLS returns to a non-admin.
  const code = error.code === '42501' ? 'invalid_argument' : 'unavailable'
  return { code, message: error.message }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function makeSupabaseDb(sb: SupabaseClient) {
  const table = (col: string) => {
    const t = TABLES[col]
    if (!t) throw new TypeError(`Unknown collection "${col}"`)
    return t
  }

  async function fetchAll(t: string) {
    const rows: { id: string; doc: Doc }[] = []
    let from = 0
    const page = 1000
    for (;;) {
      const { data, error } = await sb.from(t).select('id,doc').range(from, from + page - 1)
      if (error) throw wrap(error)
      rows.push(...((data as { id: string; doc: Doc }[]) || []))
      if (!data || data.length < page) break
      from += page
    }
    return rows
  }

  /** Subscribe to a table (optionally one row) and re-run `load` on every change. */
  function watch(t: string, filter: string | null, load: () => Promise<void>, onErr?: ErrCb): Unsub {
    let stopped = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (stopped) return
      try {
        await load()
      } catch (e: any) {
        onErr?.(e?.code ? e : { code: 'unavailable', message: e?.message || String(e) })
      }
    }
    refresh()
    const channel: RealtimeChannel = sb
      .channel(`sales-desk:${t}:${filter || 'all'}:${uid()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: t, ...(filter ? { filter } : {}) },
        () => {
          clearTimeout(debounce)
          debounce = setTimeout(refresh, 250)
        }
      )
      .subscribe()
    const poll = setInterval(refresh, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(debounce)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      sb.removeChannel(channel)
    }
  }

  function docRef(path: string) {
    const parts = path.split('/')
    if (parts.length !== 2) throw new TypeError(`Document path must be collection/id, got "${path}"`)
    const [col, id] = parts
    const t = table(col)
    const ref = {
      id,
      path,
      async get(): Promise<Snap> {
        const { data, error } = await sb.from(t).select('id,doc').eq('id', id).maybeSingle()
        if (error) throw wrap(error)
        return snap(id, (data as { doc: Doc } | null)?.doc)
      },
      async set(doc: Doc): Promise<void> {
        const { error } = await sb
          .from(t)
          .upsert({ id, doc, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        if (error) throw wrap(error)
      },
      async update(partial: Doc): Promise<void> {
        const cur = await ref.get()
        if (!cur.exists) throw { code: 'invalid_argument', message: 'Document does not exist' }
        await ref.set({ ...(cur.data() as Doc), ...partial })
      },
      async delete(): Promise<void> {
        const { error } = await sb.from(t).delete().eq('id', id)
        if (error) throw wrap(error)
      },
      onSnapshot(next: (s: Snap) => void, onErr?: ErrCb): Unsub {
        return watch(t, `id=eq.${id}`, async () => next(await ref.get()), onErr)
      },
    }
    return ref
  }

  function collectionRef(col: string) {
    const t = table(col)
    return {
      path: col,
      doc(id?: string) {
        return docRef(`${col}/${id || uid()}`)
      },
      async add(doc: Doc) {
        const ref = docRef(`${col}/${uid()}`)
        await ref.set(doc)
        return ref
      },
      async get(): Promise<QuerySnap> {
        const rows = await fetchAll(t)
        const docs = rows.map((r) => snap(r.id, r.doc))
        return { docs, size: docs.length, empty: !docs.length }
      },
      onSnapshot(next: (q: QuerySnap) => void, onErr?: ErrCb): Unsub {
        return watch(
          t,
          null,
          async () => {
            const rows = await fetchAll(t)
            const docs = rows.map((r) => snap(r.id, r.doc))
            next({ docs, size: docs.length, empty: !docs.length })
          },
          onErr
        )
      },
    }
  }

  return { doc: docRef, collection: collectionRef }
}

/** Browser download used by the desk's CSV export. */
export const browserDownloads = {
  async save({ filename, data }: { filename: string; data: string | Blob }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
