import { createServiceClient } from '@/lib/supabase/server'
import { runJob, publicJob, refreshConnection } from '@/lib/meta-publishing'
import { NextResponse } from 'next/server'

export const maxDuration = 60

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = await createServiceClient()
  const now = new Date().toISOString()
  const { data: jobs, error } = await db
    .from('publish_jobs')
    .select('id,company_id,approved_by')
    .in('state', ['queued', 'processing', 'creating', 'publishing'])
    .lte('run_at', now)
    .order('run_at')
    .limit(1)
  if (error)
    return NextResponse.json({ error: 'jobs_unavailable' }, { status: 500 })
  const results = []
  for (const job of jobs ?? []) {
    try {
      results.push(
        publicJob(
          await runJob(
            db,
            {
              companyId: job.company_id,
              actorId: job.approved_by,
              source: 'ui',
            },
            job.id,
          ),
        ),
      )
    } catch {
      results.push({ id: job.id, error: 'job_requires_reconciliation' })
    }
  }
  if (results.length) return NextResponse.json({ jobs: results })
  const { data: accounts } = await db
    .from('accounts')
    .select('id,company_id')
    .in('platform', ['instagram', 'threads'])
    .gt('token_expires_at', now)
    .lt('token_expires_at', new Date(Date.now() + 7 * 86400000).toISOString())
    .limit(1)
  for (const account of accounts ?? []) {
    try {
      await refreshConnection(
        db,
        { companyId: account.company_id, actorId: 'worker', source: 'ui' },
        account.id,
      )
    } catch {
      /* Keep the current credential on refresh failure. */
    }
  }
  return NextResponse.json({ jobs: results })
}
