// poll-detection.mjs — print a detection job's current status/progress/result.
// Usage: set -a; source .env.local; set +a
//        node scripts/poll-detection.mjs <job_id>
import { createClient } from '@supabase/supabase-js'

const jobId = process.argv[2]
if (!jobId) { console.error('Usage: node scripts/poll-detection.mjs <job_id>'); process.exit(1) }
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data: j, error } = await s.from('detection_jobs').select('*').eq('id', jobId).single()
if (error || !j) { console.error('Job not found:', error?.message); process.exit(1) }
const dur = j.completed_at ? Math.round((new Date(j.completed_at) - new Date(j.created_at)) / 1000) + 's' : 'running'
console.log(`status=${j.status}  (${dur})`)
if (j.progress) console.log('progress:', JSON.stringify(j.progress))
if (j.result) console.log('result:', JSON.stringify(j.result))
if (j.error_message) console.log('error:', j.error_message)
