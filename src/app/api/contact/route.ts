import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Create a Supabase client with the service role key for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // You'll need to add this to your .env.local
)

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  )

type ContactRow = {
  first_name: string
  last_name: string
  email: string
  nursery_name?: string | null
  nursery_size?: string | null
  message?: string | null
}

// Email Porter when a lead comes in. Submissions are already saved by the time
// this runs, so a failure here must never fail the request — it only means the
// lead has to be found in /dashboard/admin/contacts instead of the inbox.
async function sendNotificationEmail(contact: ContactRow) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[contact] RESEND_API_KEY not set — skipping notification email')
    return
  }

  // Until plnt.net is verified in Resend, only onboarding@resend.dev will send.
  const from = process.env.CONTACT_NOTIFY_FROM || 'PLNT <onboarding@resend.dev>'
  const to = process.env.CONTACT_NOTIFY_TO || 'porter@plnt.net'

  const name = `${contact.first_name} ${contact.last_name}`.trim()
  const row = (label: string, value?: string | null) =>
    value ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${label}</td><td>${escapeHtml(value)}</td></tr>` : ''

  const html = `
    <div style="font-family:system-ui,sans-serif;color:#0f2e1d">
      <h2 style="margin:0 0 16px">New inventory request</h2>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Name', name)}
        ${row('Email', contact.email)}
        ${row('Nursery', contact.nursery_name)}
        ${row('Size', contact.nursery_size)}
      </table>
      ${contact.message ? `<p style="margin:16px 0 4px;color:#6b7280;font-size:14px">Message</p>
      <p style="margin:0;white-space:pre-wrap">${escapeHtml(contact.message)}</p>` : ''}
    </div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: contact.email, // replying goes straight back to the grower
        subject: `New inventory request — ${name}${contact.nursery_name ? ` (${contact.nursery_name})` : ''}`,
        html,
      }),
    })
    if (!res.ok) {
      console.error('[contact] Resend failed:', res.status, await res.text())
    }
  } catch (err) {
    console.error('[contact] Resend threw:', err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate required fields
    const { first_name, last_name, email, nursery_name, nursery_size, message } = body
    
    if (!first_name || !last_name || !email) {
      return NextResponse.json(
        { error: 'First name, last name, and email are required' },
        { status: 400 }
      )
    }
    
    // Insert contact into database
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        first_name,
        last_name,
        email,
        nursery_name,
        nursery_size,
        message,
      })
      .select()
      .single()
    
    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to submit contact form' },
        { status: 500 }
      )
    }
    
    // Awaited so it runs before the serverless function is frozen on Vercel.
    await sendNotificationEmail({ first_name, last_name, email, nursery_name, nursery_size, message })

    return NextResponse.json({ 
      success: true, 
      message: 'Contact form submitted successfully',
      data 
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}