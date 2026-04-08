import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUCO_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com'

// POST: Create a new detection job and kick it off in Docker
export async function POST(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  const body = await request.json()
  const {
    orthomosaicId,
    method = 'orthomosaic',
    confidence_threshold = 0.17,
    include_classes = ['plant', 'plants'],
  } = body

  if (!orthomosaicId) {
    return NextResponse.json({ error: 'orthomosaicId is required' }, { status: 400 })
  }

  if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) {
    return NextResponse.json({ error: 'Roboflow API not configured' }, { status: 500 })
  }

  const ownershipError = await verifyOrthomosaicOwnership(supabase, orthomosaicId, user.id, isAdmin)
  if (ownershipError) return ownershipError

  // Get orthomosaic
  const { data: orthomosaic, error: orthoError } = await supabase
    .from('orthomosaics')
    .select('*')
    .eq('id', orthomosaicId)
    .single()

  if (orthoError || !orthomosaic) {
    return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
  }

  if (orthomosaic.status !== 'completed' || !orthomosaic.bounds) {
    return NextResponse.json({ error: 'Orthomosaic is not ready' }, { status: 400 })
  }

  // Check for existing active job
  const { data: existingJobs } = await supabase
    .from('detection_jobs')
    .select('id, status')
    .eq('orthomosaic_id', orthomosaicId)
    .in('status', ['pending', 'downloading', 'detecting'])

  if (existingJobs && existingJobs.length > 0) {
    return NextResponse.json({
      error: 'A detection job is already running for this orthomosaic',
      jobId: existingJobs[0].id,
    }, { status: 409 })
  }

  // Create job record
  const { data: job, error: jobError } = await supabase
    .from('detection_jobs')
    .insert({
      orthomosaic_id: orthomosaicId,
      user_id: user.id,
      method,
      status: 'pending',
      config: { confidence_threshold, include_classes },
    })
    .select()
    .single()

  if (jobError || !job) {
    console.error('[DetectionJob] Failed to create job:', jobError)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }

  // Fire-and-forget: kick off detection in Docker
  const orthoUrl = orthomosaic.original_tif_url || orthomosaic.orthomosaic_url

  fetch(`${ARUCO_SERVICE_URL}/detect-plants-async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: job.id,
      geotiff_url: orthoUrl,
      roboflow_api_key: ROBOFLOW_API_KEY,
      roboflow_model_id: ROBOFLOW_MODEL_ID,
      roboflow_api_url: ROBOFLOW_API_URL,
      confidence_threshold,
      include_classes,
      bounds: orthomosaic.bounds,
      orthomosaic_id: orthomosaicId,
      user_id: user.id,
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabase_service_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
  }).catch(err => {
    console.error('[DetectionJob] Failed to start Docker job:', err)
    // Update job as failed
    supabase
      .from('detection_jobs')
      .update({ status: 'failed', error_message: 'Failed to reach Docker service' })
      .eq('id', job.id)
  })

  return NextResponse.json({
    success: true,
    jobId: job.id,
    status: 'pending',
  })
}

// GET: Poll job status
export async function GET(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  const orthomosaicId = searchParams.get('orthomosaicId')

  if (!jobId && !orthomosaicId) {
    return NextResponse.json({ error: 'jobId or orthomosaicId required' }, { status: 400 })
  }

  let query = supabase.from('detection_jobs').select('*')

  if (jobId) {
    query = query.eq('id', jobId)
  } else {
    query = query.eq('orthomosaic_id', orthomosaicId!).order('created_at', { ascending: false }).limit(1)
  }

  const { data: jobs, error } = await query

  if (error || !jobs || jobs.length === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const job = jobs[0]

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    result: job.result,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    completedAt: job.completed_at,
  })
}
