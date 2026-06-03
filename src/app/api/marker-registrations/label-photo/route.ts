import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'marker-labels'

// POST /api/marker-registrations/label-photo
// Failsafe upload: when a barcode can't be scanned, the client sends a photo of
// the label (multipart form field "file"). Returns the storage path to attach
// to the registration.
export async function POST(request: NextRequest) {
  try {
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }

    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const path = `${user.id}/${randomUUID()}.${ext}`
    const bytes = new Uint8Array(await file.arrayBuffer())

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false })

    if (error) {
      console.error('Error uploading label photo:', error)
      return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 })
    }

    return NextResponse.json({ path }, { status: 201 })
  } catch (error) {
    console.error('Error in label-photo POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
