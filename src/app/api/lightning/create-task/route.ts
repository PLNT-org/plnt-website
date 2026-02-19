import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PROCESSING_PRESETS } from '@/lib/webodm/types'
import { BUCKETS } from '@/lib/supabase/storage'

// Allow up to 5 minutes for large uploads
export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const LIGHTNING_MAX_IMAGES = 337
const BATCH_SIZE = 10

export async function POST(request: NextRequest) {
  let orthomosaicId: string | null = null
  const lightningToken = process.env.WEBODM_LIGHTNING_TOKEN
  const lightningHost = process.env.WEBODM_LIGHTNING_HOST || 'spark1.webodm.net'
  const lightningBase = `https://${lightningHost}`

  try {
    const { flightId, storagePaths, name, quality } = await request.json()

    if (!flightId && (!storagePaths || storagePaths.length === 0)) {
      return NextResponse.json(
        { error: 'Either flightId or storagePaths is required' },
        { status: 400 }
      )
    }

    // --- Authenticate user ---
    let userId: string | null = null
    const cookies = request.headers.get('cookie') || ''
    // Match both regular and chunked Supabase auth cookies
    const accessTokenMatch = cookies.match(/sb-[^-]+-auth-token(?:\.0)?=([^;]+)/)
    if (accessTokenMatch) {
      try {
        const tokenData = JSON.parse(decodeURIComponent(accessTokenMatch[1]))
        const token = tokenData.access_token || tokenData
        if (token && typeof token === 'string') {
          const { data } = await supabaseAdmin.auth.getUser(token)
          userId = data.user?.id || null
        }
      } catch {
        console.log('[Lightning] Could not extract user from cookies')
      }
    }

    // --- Resolve image paths ---
    let imagePaths: { id: string; storage_path: string }[]

    if (flightId) {
      const { data: imageRows, error: imgError } = await supabaseAdmin
        .from('flight_images')
        .select('id, storage_path')
        .eq('flight_id', flightId)
        .order('created_at', { ascending: true })

      if (imgError) {
        console.error('[Lightning] Error fetching images:', imgError)
        return NextResponse.json({ error: 'Failed to look up flight images' }, { status: 500 })
      }

      imagePaths = imageRows || []
      console.log(`[Lightning] Found ${imagePaths.length} images for flight ${flightId}`)
    } else {
      imagePaths = (storagePaths as string[]).map((p: string, i: number) => ({
        id: String(i),
        storage_path: p,
      }))
    }

    if (imagePaths.length < 3) {
      return NextResponse.json(
        { error: `At least 3 images are required (found ${imagePaths.length}). Make sure images were uploaded successfully.` },
        { status: 400 }
      )
    }

    if (imagePaths.length > LIGHTNING_MAX_IMAGES) {
      return NextResponse.json(
        { error: `Lightning supports up to ${LIGHTNING_MAX_IMAGES} images (found ${imagePaths.length})` },
        { status: 400 }
      )
    }

    if (!lightningToken) {
      return NextResponse.json(
        { error: 'WebODM Lightning is not configured. Please add WEBODM_LIGHTNING_TOKEN to environment variables.' },
        { status: 503 }
      )
    }

    // --- Determine processing options ---
    const presetKey = quality === 'height-mapping' ? 'heightMapping'
      : quality === 'high' ? 'highQuality'
      : quality === 'fast' ? 'fast'
      : quality === 'plant-counting' ? 'plantCounting'
      : 'balanced'
    const options = PROCESSING_PRESETS[presetKey]
    const isHeightMapping = quality === 'height-mapping'
    const taskName = name || `Orthomosaic - ${new Date().toLocaleDateString()}`

    // --- Create DB record FIRST so it exists even if upload times out ---
    console.log(`[Lightning] Creating DB record for "${taskName}"...`)
    const { data: orthomosaic, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .insert({
        flight_id: flightId || null,
        user_id: userId,
        name: taskName,
        webodm_project_id: 'lightning',
        status: 'pending',
        processing_type: isHeightMapping ? 'height-mapping' : 'orthomosaic',
        has_dsm: isHeightMapping,
        has_dtm: isHeightMapping,
      })
      .select()
      .single()

    if (orthoError) {
      console.error('[Lightning] Error creating orthomosaic record:', orthoError)
      return NextResponse.json(
        { error: `Failed to create orthomosaic record: ${orthoError.message}` },
        { status: 500 }
      )
    }

    orthomosaicId = orthomosaic.id
    console.log(`[Lightning] DB record created: ${orthomosaicId}`)

    // --- Step 1: Initialize Lightning task ---
    console.log(`[Lightning] Initializing task "${taskName}" with ${imagePaths.length} images...`)

    const optionsArray = Object.entries(options).map(([key, value]) => ({
      name: key,
      value: String(value),
    }))

    const initForm = new FormData()
    initForm.append('name', taskName)
    initForm.append('options', JSON.stringify(optionsArray))

    const initRes = await fetch(
      `${lightningBase}/task/new/init?token=${lightningToken}`,
      { method: 'POST', body: initForm }
    )

    if (!initRes.ok) {
      const errText = await initRes.text()
      throw new Error(`Lightning init failed (${initRes.status}): ${errText}`)
    }

    const initData = await initRes.json()
    const lightningUuid = initData.uuid
    console.log(`[Lightning] Task initialized: ${lightningUuid}`)

    // Save the Lightning UUID immediately so we can track/recover
    await supabaseAdmin
      .from('orthomosaics')
      .update({ webodm_task_id: lightningUuid })
      .eq('id', orthomosaicId)

    // --- Step 2: Download from Supabase + upload to Lightning in batches ---
    for (let i = 0; i < imagePaths.length; i += BATCH_SIZE) {
      const batch = imagePaths.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(imagePaths.length / BATCH_SIZE)
      console.log(`[Lightning] Uploading batch ${batchNum}/${totalBatches} (${batch.length} images)...`)

      const downloadResults = await Promise.all(
        batch.map(async (row) => {
          const { data, error } = await supabaseAdmin.storage
            .from(BUCKETS.FLIGHT_IMAGES)
            .download(row.storage_path)

          if (error || !data) {
            throw new Error(`Failed to download image ${row.storage_path}: ${error?.message}`)
          }

          const filename = row.storage_path.split('/').pop() || `image_${row.id}.jpg`
          return { blob: data, filename }
        })
      )

      const uploadForm = new FormData()
      for (const { blob, filename } of downloadResults) {
        uploadForm.append('images', blob, filename)
      }

      const uploadRes = await fetch(
        `${lightningBase}/task/new/upload/${lightningUuid}?token=${lightningToken}`,
        { method: 'POST', body: uploadForm }
      )

      if (!uploadRes.ok) {
        const errText = await uploadRes.text()
        throw new Error(`Lightning upload failed on batch ${batchNum}: ${errText}`)
      }
    }

    // --- Step 3: Commit task to start processing ---
    console.log(`[Lightning] Committing task ${lightningUuid}...`)
    const commitRes = await fetch(
      `${lightningBase}/task/new/commit/${lightningUuid}?token=${lightningToken}`,
      { method: 'POST' }
    )

    if (!commitRes.ok) {
      const errText = await commitRes.text()
      throw new Error(`Lightning commit failed: ${errText}`)
    }

    // --- Update DB record to processing ---
    await supabaseAdmin
      .from('orthomosaics')
      .update({ status: 'processing' })
      .eq('id', orthomosaicId)

    console.log(`[Lightning] Task committed and DB updated. UUID: ${lightningUuid}, orthoId: ${orthomosaicId}`)

    return NextResponse.json({
      success: true,
      uuid: lightningUuid,
      orthomosaicId: orthomosaicId,
      imagesCount: imagePaths.length,
    })
  } catch (error) {
    console.error('[Lightning] Error:', error)

    // Update DB record to failed (don't delete it — user can see the error)
    if (orthomosaicId) {
      try {
        await supabaseAdmin
          .from('orthomosaics')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', orthomosaicId)
      } catch (dbErr) {
        console.error('[Lightning] Failed to update error status:', dbErr)
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    )
  }
}
