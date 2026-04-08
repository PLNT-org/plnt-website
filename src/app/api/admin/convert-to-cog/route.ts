import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUCO_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'

// POST - Trigger COG conversion via the aruco-service Docker container
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const { orthomosaicId, tifStoragePath } = await request.json()

    if (!orthomosaicId || !tifStoragePath) {
      return NextResponse.json(
        { error: 'orthomosaicId and tifStoragePath are required' },
        { status: 400 }
      )
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

    // Get the public URL for the source TIF
    const { data: tifUrlData } = supabaseAdmin.storage
      .from('orthomosaics')
      .getPublicUrl(tifStoragePath)

    // Create a signed upload URL for the COG
    const cogPath = `${orthomosaicId}/orthophoto_cog.tif`
    const { data: cogUploadData, error: cogUploadError } = await supabaseAdmin.storage
      .from('orthomosaics')
      .createSignedUploadUrl(cogPath, { upsert: true })

    if (cogUploadError || !cogUploadData) {
      console.error('[ConvertCOG] Failed to create signed URL:', cogUploadError)
      return NextResponse.json({ error: 'Failed to create upload URL for COG' }, { status: 500 })
    }

    // Call the aruco-service to convert and upload
    console.log(`[ConvertCOG] Calling aruco-service to convert ${tifStoragePath} to COG...`)
    const convertRes = await fetch(`${ARUCO_SERVICE_URL}/convert-cog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geotiff_url: tifUrlData.publicUrl,
        upload_url: cogUploadData.signedUrl,
      }),
    })

    if (!convertRes.ok) {
      const errText = await convertRes.text()
      console.error(`[ConvertCOG] Service error (${convertRes.status}):`, errText)
      return NextResponse.json({ error: 'COG conversion service failed' }, { status: 502 })
    }

    const convertData = await convertRes.json()

    if (!convertData.success) {
      console.error('[ConvertCOG] Conversion failed:', convertData.error)
      return NextResponse.json({ error: convertData.error || 'COG conversion failed' }, { status: 500 })
    }

    // Get the public URL for the COG
    const { data: cogUrlData } = supabaseAdmin.storage
      .from('orthomosaics')
      .getPublicUrl(cogPath)

    // Update the orthomosaic record with the COG URL
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update({
        orthomosaic_url: cogUrlData.publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('[ConvertCOG] DB update error:', updateError)
      return NextResponse.json({ error: 'Failed to update database' }, { status: 500 })
    }

    console.log(`[ConvertCOG] Done. COG: ${convertData.file_size_mb} MB`)

    return NextResponse.json({
      success: true,
      cogUrl: cogUrlData.publicUrl,
      fileSizeMb: convertData.file_size_mb,
    })
  } catch (error) {
    console.error('[ConvertCOG] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'COG conversion failed' },
      { status: 500 }
    )
  }
}
