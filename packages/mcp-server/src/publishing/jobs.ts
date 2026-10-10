import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../crypto.ts'
import { MetaError, MetaProvider, type MetaContent } from './provider.ts'

export interface PublishingContext {
  companyId: string
  actorId: string
  source: 'ui' | 'mcp'
}
export interface PublishJob {
  id: string
  post_id: string
  company_id: string
  state:
    | 'queued'
    | 'creating'
    | 'processing'
    | 'publishing'
    | 'published'
    | 'failed'
    | 'unknown'
  fence: number
  container_id: string | null
  platform_post_id: string | null
  permalink: string | null
  error_code: string | null
  run_at: string
  snapshot: MetaContent
}

export async function publishingRpc<T>(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args)
  if (error) throw new Error(`publishing_${name}_rejected`)
  return data as T
}

export async function previewPost(
  db: SupabaseClient,
  ctx: PublishingContext,
  postId: string,
) {
  return publishingRpc<{ snapshot: MetaContent; digest: string }>(
    db,
    'publishing_preview',
    { p_id: postId, p_company: ctx.companyId },
  )
}

export async function approvePost(
  db: SupabaseClient,
  ctx: PublishingContext,
  postId: string,
  digest: string,
  instruction: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    !instruction.trim() ||
    instruction.length > 2000
  )
    throw new Error('approval_required')
  return publishingRpc<PublishJob>(db, 'approve_publication', {
    p_id: postId,
    p_company: ctx.companyId,
    p_actor: ctx.actorId,
    p_digest: digest,
    p_instruction: instruction,
    p_source: ctx.source,
  })
}

export async function getJob(
  db: SupabaseClient,
  ctx: PublishingContext,
  id: string,
) {
  const { data, error } = await db
    .from('publish_jobs')
    .select('*')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .single()
  if (error || !data) throw new Error('job_not_found')
  return data as PublishJob
}

async function advance(
  db: SupabaseClient,
  job: PublishJob,
  state: PublishJob['state'],
  extra: Record<string, string> = {},
) {
  return publishingRpc<PublishJob>(db, 'advance_publication', {
    p_job: job.id,
    p_fence: job.fence,
    p_state: state,
    ...extra,
  })
}

async function signedMedia(db: SupabaseClient, path: string | undefined) {
  if (!path) return null
  const { data, error } = await db.storage
    .from('post-media')
    .createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw new Error('media_unavailable')
  return data.signedUrl
}

export async function runJob(
  db: SupabaseClient,
  ctx: PublishingContext,
  jobId: string,
): Promise<PublishJob> {
  const claimed = await publishingRpc<PublishJob | null>(
    db,
    'claim_publication',
    { p_job: jobId, p_company: ctx.companyId },
  )
  if (!claimed) return getJob(db, ctx, jobId)
  if (claimed.state === 'unknown') return claimed
  let job = claimed
  try {
    const { data: account, error } = await db
      .from('accounts')
      .select(
        'access_token,platform_user_id,platform,token_expires_at,connection_status',
      )
      .eq('id', job.snapshot.account_id)
      .eq('company_id', ctx.companyId)
      .single()
    if (
      error ||
      !account?.access_token ||
      account.platform_user_id !== job.snapshot.platform_user_id ||
      account.platform !== job.snapshot.platform
    )
      throw new Error('account_unavailable')
    if (
      account.connection_status === 'invalid' ||
      (account.token_expires_at &&
        new Date(account.token_expires_at).getTime() <= Date.now())
    )
      throw new Error('token_expired')
    const provider = new MetaProvider(
      job.snapshot.platform,
      decrypt(account.access_token),
      account.platform_user_id,
    )
    if (job.state === 'queued') {
      await provider.checkIdentity()
      const media = await signedMedia(db, job.snapshot.asset?.path)
      const cover = await signedMedia(db, job.snapshot.cover?.path)
      job = await advance(db, job, 'creating')
      const container = await provider.create(job.snapshot, media, cover)
      return advance(db, job, 'processing', { p_container: container })
    }
    if (!job.container_id) throw new Error('container_unavailable')
    const status = await provider.status(job.container_id)
    if (status === 'ERROR' || status === 'EXPIRED')
      return advance(db, job, 'failed', {
        p_error: `container_${status.toLowerCase()}`,
      })
    if (status === 'PUBLISHED')
      return advance(db, job, 'unknown', {
        p_error: 'container_already_published_requires_recovery',
      })
    if (status !== 'FINISHED') return advance(db, job, 'processing')
    await provider.checkIdentity()
    const containerId = job.container_id
    job = await advance(db, job, 'publishing')
    const mediaId = await provider.publish(containerId)
    job = await advance(db, job, 'published', { p_media: mediaId })
    try {
      const permalink = await provider.permalink(mediaId)
      if (permalink) {
        const { error } = await db
          .from('publish_jobs')
          .update({ permalink })
          .eq('id', job.id)
          .eq('state', 'published')
        if (!error) job.permalink = permalink
      }
    } catch {
      /* A stored media ID is the publication result. */
    }
    return job
  } catch (error) {
    if (job.state === 'published') return job
    const uncertain =
      (job.state === 'creating' || job.state === 'publishing') &&
      (!(error instanceof MetaError) || error.uncertain)
    const code =
      error instanceof MetaError ? error.code : 'publishing_operation_failed'
    try {
      return await advance(db, job, uncertain ? 'unknown' : 'failed', {
        p_error: code,
      })
    } catch {
      throw new Error('job_result_requires_reconciliation')
    }
  }
}

export function publicJob(job: PublishJob) {
  return {
    id: job.id,
    post_id: job.post_id,
    state: job.state,
    run_at: job.run_at,
    platform_post_id: job.platform_post_id,
    permalink: job.permalink,
    error_code: job.error_code,
  }
}
