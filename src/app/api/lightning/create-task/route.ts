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
  let lightningUuid: string | null = null
  const lightningToken = process.env.WEBODM_LIGHTNING_TOKEN
  const lightningHost = process.env.WEBODM_LIGHTNING_HOST || 'spark1.webodm.net'
  const lightningBase = `https://${lightningHost}`

  try {
    // --- Parse request body ---
    // Supports two modes:
    //   1. { flightId } — looks up images from flight_images table
    //   2. { storagePaths } — uses provided Supabase Storage paths directly
    const { flightId, storagePaths, name, quality } = await request.json()

    if (!flightId && (!storagePaths || storagePaths.length === 0)) {
      return NextResponse.json(
        { error: 'Either flightId or storagePaths is required' },
        { status: 400 }
      )
    }

    // --- Authenticate user ---
    let user = null
    const cookies = request.headers.get('cookie') || ''
    const accessTokenMatch = cookies.match(/sb-[^-]+-auth-token=([^;]+)/)
    if (accessTokenMatch) {
      try {
        const tokenData = JSON.parse(decodeURIComponent(accessTokenMatch[1]))
        if (tokenData.access_token) {
          const { data } = await supabaseAdmin.auth.getUser(tokenData.access_token)
          user = data.user
        }
      } catch {
        // Token parsing failed
      }
    }

    // --- Resolve image paths ---
    let imagePaths: { id: string; storage_path: string }[]

    if (flightId) {
      // Mode 1: Look up images from flight_images table
      const { data: imageRows, error: imgError } = await supabaseAdmin
        .from('flight_images')
        .select('id, storage_path')
        .eq('flight_id', flightId)
        .order('created_at', { ascending: true })

      if (imgError) {
        console.error('Error fetching images:', imgError)
        return NextResponse.json({ error: 'Failed to look up flight images' }, { status: 500 })
      }

      imagePaths = imageRows || []
    } else {
      // Mode 2: Use provided storage paths directly
      imagePaths = (storagePaths as string[]).map((p: string, i: number) => ({
        id: String(i),
        storage_path: p,
      }))
    }

    if (imagePaths.length < 3) {
      return NextResponse.json(
        { error: `At least 3 images are required (found ${imagePaths.length})` },
        { status: 400 }
      )
    }

    if (imagePaths.length > LIGHTNING_MAX_IMAGES) {
      return NextResponse.json(
        { error: `Lightning supports up to ${LIGHTNING_MAX_IMAGES} images (found ${imagePaths.length})` },
        { status: 400 }
      )
    }

    // --- Verify Lightning is configured ---
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
    lightningUuid = initData.uuid
    console.log(`[Lightning] Task initialized: ${lightningUuid}`)

    // --- Step 2: Download from Supabase + upload to Lightning in batches ---
    for (let i = 0; i < imagePaths.length; i += BATCH_SIZE) {
      const batch = imagePaths.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(imagePaths.length / BATCH_SIZE)
      console.log(`[Lightning] Uploading batch ${batchNum}/${totalBatches} (${batch.length} images)...`)

      // Download all images in this batch from Supabase concurrently
      const downloadResults = await Promise.all(
        batch.map(async (row) => {
          const { data, error } = await supabaseAdmin.storage
            .from(BUCKETS.FLIGHT_IMAGES)
            .download(row.storage_path)

          if (error || !data) {
            throw new Error(`Failed to download image ${row.storage_path}: ${error?.message}`)
          }

          // Extract filename from the storage path
          const filename = row.storage_path.split('/').pop() || `image_${row.id}.jpg`
          return { blob: data, filename }
        })
      )

      // Build form data for this batch and upload to Lightning
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

    console.log(`[Lightning] Task committed successfully`)

    // --- Create orthomosaics DB record ---
    const { data: orthomosaic, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .insert({
        flight_id: flightId || null,
        user_id: user?.id || null,
        name: taskName,
        webodm_task_id: lightningUuid,
        webodm_project_id: 'lightning',
        status: 'processing',
        processing_type: isHeightMapping ? 'height-mapping' : 'orthomosaic',
        has_dsm: isHeightMapping,
        has_dtm: isHeightMapping,
      })
      .select()
      .single()

    if (orthoError) {
      console.error('Error creating orthomosaic record:', orthoError)
      return NextResponse.json({ error: 'Failed to create orthomosaic record' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      uuid: lightningUuid,
      orthomosaicId: orthomosaic?.id,
      imagesCount: imagePaths.length,
    })
  } catch (error) {
    console.error('Error creating Lightning task:', error)

    // Clean up the Lightning task if it was created
    if (lightningUuid && lightningToken) {
      try {
        await fetch(`${lightningBase}/task/remove?token=${lightningToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: lightningUuid }),
        })
        console.log(`[Lightning] Cleaned up failed task ${lightningUuid}`)
      } catch (cleanupErr) {
        console.error('[Lightning] Cleanup failed:', cleanupErr)
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    )
  }
}
