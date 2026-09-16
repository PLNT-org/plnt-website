// middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isAllowedEmail } from '@/lib/auth/allowlist'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Check for demo mode FIRST, before any auth checks
  const isDemoMode = req.nextUrl.searchParams.get('demo') === 'true' || 
                     req.cookies.get('isDemoMode')?.value === 'true'
  
  // If in demo mode, allow access to dashboard (but not admin routes)
  if (isDemoMode) {
    // Still protect admin-only routes even in demo mode
    const adminOnlyPaths = [
      '/dashboard/upload-images',
      '/dashboard/annotate',
      '/dashboard/verify',
      '/dashboard/admin',
      '/sales'
    ]
    
    const isAdminPath = adminOnlyPaths.some(path => 
      req.nextUrl.pathname.startsWith(path)
    )
    
    if (isAdminPath) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    
    return res // Allow demo access to regular dashboard
  }
  
  // For non-demo users, check authentication
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()
  
  // If no session and trying to access a protected area (and not in demo mode)
  const protectedArea =
    req.nextUrl.pathname.startsWith('/dashboard') || req.nextUrl.pathname.startsWith('/sales')
  if (!session && protectedArea) {
    // Remember where they were headed so sign-in can send them back there.
    const signin = new URL('/auth/signin', req.url)
    signin.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(signin)
  }

  // Allowlist: only approved emails get past this point. Any other session is
  // terminated so a stale or self-created account can't reach the dashboard.
  if (session && !isAllowedEmail(session.user.email)) {
    await supabase.auth.signOut()
    const denied = NextResponse.redirect(new URL('/auth/signin?error=not_authorized', req.url))
    // signOut() cleared the auth cookies on `res`; carry them onto the redirect
    // or the stale session survives.
    res.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie))
    return denied
  }

  // Admin-only paths protection for logged-in users
  const adminOnlyPaths = [
    '/dashboard/upload-images',
    '/dashboard/annotate', 
    '/dashboard/verify',
    '/dashboard/admin',
    '/sales' // Sales Desk (src/app/sales) — admins only
  ]
  
  const isAdminPath = adminOnlyPaths.some(path => 
    req.nextUrl.pathname.startsWith(path)
  )
  
  if (isAdminPath && session) {
    // Check if user is admin
    // `profiles` — same table api-auth.ts and auth-context.tsx read. This
    // previously queried a non-existent `user_profiles`, so the lookup always
    // failed and every user was bounced off the admin routes.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
    
    if (profile?.role !== 'admin') {
      // Not admin - redirect to dashboard home
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }
  
  return res
}

export const config = {
  matcher: ['/dashboard/:path*', '/sales/:path*']
}