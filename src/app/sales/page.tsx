'use client'

/**
 * plnt.net/sales — the PLNT Sales Desk.
 *
 * Admin-only (middleware enforces session + allowlist + admin role; this page
 * re-checks on the client so a stale tab degrades to a message, not a blank
 * screen). The desk itself is a vanilla-JS app (sales-desk.js) that renders
 * into the static markup in shell.ts; this component mounts it once with a
 * Supabase-backed store and the signed-in user's identity.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bricolage_Grotesque, IBM_Plex_Sans } from 'next/font/google'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth/auth-context'
import { SHELL } from './shell'
import { makeSupabaseDb, browserDownloads } from './supabase-db'
import { mountSalesDesk } from './sales-desk'
import './sales-desk.css'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--sd-display-font',
  display: 'swap',
})
const body = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--sd-body-font',
  display: 'swap',
})

function displayName(profile: any, email: string | undefined) {
  const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
  return full || profile?.display_name || email || ''
}

export default function SalesDeskPage() {
  const { user, userProfile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  // Middleware already redirects anonymous visitors; this covers a session
  // that expired after the page loaded.
  useEffect(() => {
    if (!loading && !user) router.replace('/auth/signin')
  }, [loading, user, router])

  // Mount the desk once we know who is signed in and that they are an admin.
  // The profile can arrive a beat after the user does, so wait for it.
  useEffect(() => {
    if (loading || !user || !userProfile || !isAdmin || !rootRef.current || mounted) return
    const unmount = mountSalesDesk({
      root: rootRef.current,
      db: makeSupabaseDb(supabase),
      downloads: browserDownloads,
      me: displayName(userProfile, user.email),
      email: user.email || '',
    })
    setMounted(true)
    return () => {
      unmount()
      setMounted(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id, userProfile?.id, isAdmin])

  if (loading || (user && !userProfile)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700" />
      </div>
    )
  }

  if (!user) return null

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-gray-900">Sales Desk is for the PLNT sales team</h1>
          <p className="text-gray-600">
            Your account is signed in but does not have admin access. Ask porter@plnt.net if you need it.
          </p>
          <Link href="/dashboard" className="text-green-700 underline">
            Back to the dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`sd ${display.variable} ${body.variable}`}
      dangerouslySetInnerHTML={{ __html: SHELL }}
    />
  )
}
