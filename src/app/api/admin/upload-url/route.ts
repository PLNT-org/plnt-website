import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST - Generate a signed upload URL for direct browser upload to Supabase Storage
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const { orthomosaicId, filename } = await request.json()

    if (!orthomosaicId) {
      return NextResponse.json({ error: 'orthomosaicId is required' }, { status: 400 })
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

    const storagePath = `${orthomosaicId}/${filename || 'orthophoto.tif'}`

    // Create a signed upload URL (valid for 10 minutes)
    const { data, error } = await supabaseAdmin.storage
      .from('orthomosaics')
      .createSignedUploadUrl(storagePath, { upsert: true })

    if (error) {
      console.error('Signed URL error:', error)
      return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      storagePath,
    })
  } catch (error) {
    console.error('Upload URL error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create upload URL' },
      { status: 500 }
    )
  }
}
