import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const email = request.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'Email parameter required' }, { status: 400 })
  }

  // Query auth.users directly via service role
  const { data: users, error } = await supabaseAdmin
    .rpc('get_user_by_email', { lookup_email: email.toLowerCase() })

  if (error) {
    // Fallback: query auth.users table directly (requires service role)
    const { data: authUser, error: directError } = await supabaseAdmin
      .from('auth.users' as any)
      .select('id, email')
      .ilike('email', email)
      .single()

    if (directError || !authUser) {
      // Final fallback: paginate through all users
      let page = 1
      const perPage = 100
      while (true) {
        const { data: { users: batch }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
        if (listError || !batch || batch.length === 0) break
        const found = batch.find(u => u.email?.toLowerCase() === email.toLowerCase())
        if (found) {
          return NextResponse.json({ id: found.id, email: found.email })
        }
        if (batch.length < perPage) break
        page++
      }
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ id: authUser.id, email: authUser.email })
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({ id: users[0].id, email: users[0].email })
}
