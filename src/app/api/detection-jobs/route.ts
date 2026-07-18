import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'
import { getArucoAuthHeaders, getArucoAccessToken } from '@/lib/aruco/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUCO_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'

// Full-ortho YOLO detection runs as a Cloud Run Job so long runs complete — the
// service's fire-after-response background task gets reclaimed on big orthos.
// SAM 3 and region-bounded runs are light/fast and stay on the service.
const GCP_PROJECT_NUMBER = process.env.GCP_PROJECT_NUMBER
const GCP_REGION = process.env.GCP_REGION || 'us-central1'
const DETECTION_JOB_NAME = process.env.DETECTION_JOB_NAME || 'plnt-detect-job'

async function runDetectionJob(params: {
  jobRowId: string
  geotiffUrl: string
  bounds: any
  orthomosaicId: string
  userId: string
  confidence_threshold: number
  include_classes: string[]
}) {
  const accessToken = await getArucoAccessToken()
  if (!accessToken || !GCP_PROJECT_NUMBER) {
    throw new Error('Cloud Run Job trigger unavailable (WIF / GCP_PROJECT_NUMBER not configured)')
  }
  const url = `https://run.googleapis.com/v2/projects/${GCP_PROJECT_NUMBER}/locations/${GCP_REGION}/jobs/${DETECTION_JOB_NAME}:run`
  // All env the Job needs, so it works whether overrides merge or replace.
  const env = [
    { name: 'JOB_ID', value: params.jobRowId },
    { name: 'GEOTIFF_URL', value: params.geotiffUrl },
    { name: 'BOUNDS', value: JSON.stringify(params.bounds) },
    { name: 'ORTHO_ID', value: params.orthomosaicId },
    { name: 'USER_ID', value: params.userId },
    { name: 'ENGINE', value: 'yolo' },
    { name: 'CONF', value: String(params.confidence_threshold) },
    { name: 'INCLUDE_CLASSES', value: JSON.stringify(params.include_classes) },
    { name: 'WEIGHTS_PATH', value: '/app/weights/plnt_v3.pt' },
    { name: 'SUPABASE_URL', value: process.env.NEXT_PUBLIC_SUPABASE_URL || '' },
    { name: 'SUPABASE_SERVICE_KEY', value: process.env.SUPABASE_SERVICE_ROLE_KEY || '' },
  ]
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides: { containerOverrides: [{ env }] } }),
  })
  if (!res.ok) {
    throw new Error(`Cloud Run Job run API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

// POST: Create a new detection job and kick it off in Docker
export async function POST(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  const body = await request.json()
  const {
    orthomosaicId,
    method = 'orthomosaic',
    confidence_threshold = 0.25,
    include_classes = ['plant', 'plants'],
    engine = 'yolo',
    sam3_prompt = 'plant',
    region = null,
  } = body

  if (!orthomosaicId) {
    return NextResponse.json({ error: 'orthomosaicId is required' }, { status: 400 })
  }

  if (engine !== 'yolo' && engine !== 'sam3') {
    return NextResponse.json({ error: "engine must be 'yolo' or 'sam3'" }, { status: 400 })
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
      config: { confidence_threshold, include_classes, engine },
    })
    .select()
    .single()

  if (jobError || !job) {
    console.error('[DetectionJob] Failed to create job:', jobError)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }

  // Fire-and-forget: kick off detection. Full-ortho YOLO goes to the Cloud Run
  // Job (runs to completion — the service's background task gets reclaimed on
  // big orthos); SAM 3 and region-bounded runs stay on the service (light/fast).
  const orthoUrl = orthomosaic.original_tif_url || orthomosaic.orthomosaic_url
  const useJob = engine === 'yolo' && !region

  const markFailed = (msg: string) => (err: unknown) => {
    console.error(`[DetectionJob] ${msg}:`, err)
    supabase.from('detection_jobs').update({ status: 'failed', error_message: msg }).eq('id', job.id)
  }

  if (useJob) {
    runDetectionJob({
      jobRowId: job.id,
      geotiffUrl: orthoUrl,
      bounds: orthomosaic.bounds,
      orthomosaicId,
      userId: user.id,
      confidence_threshold,
      include_classes,
    }).catch(markFailed('Failed to start detection job'))
  } else {
    fetch(`${ARUCO_SERVICE_URL}/detect-plants-async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getArucoAuthHeaders(ARUCO_SERVICE_URL)) },
      body: JSON.stringify({
        job_id: job.id,
        geotiff_url: orthoUrl,
        confidence_threshold,
        include_classes,
        bounds: orthomosaic.bounds,
        orthomosaic_id: orthomosaicId,
        user_id: user.id,
        supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabase_service_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
        engine,
        sam3_prompt,
        region,
      }),
    }).catch(markFailed('Failed to reach Docker service'))
  }

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
