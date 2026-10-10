import type { SupabaseClient } from '@supabase/supabase-js'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Upload } from 'tus-js-client'
import { beginUpload, verifyAsset } from './assets.ts'
import {
  approvePost,
  getJob,
  previewPost,
  publicJob,
  runJob,
  publishingRpc,
  type PublishingContext,
  type PublishJob,
} from './jobs.ts'
import { registerToken, refreshConnection } from './accounts.ts'

const string = { type: 'string' }
function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  }
}

export const publishingTools = [
  tool(
    'upload_media',
    'Upload a local MP4 or JPEG into private storage and verify it. Does not publish.',
    { path: string, kind: { type: 'string', enum: ['video', 'image'] } },
    ['path', 'kind'],
  ),
  tool(
    'preview_post',
    'Review the exact account, caption, media hashes, options and execution time. Returns the approval digest.',
    { id: string },
    ['id'],
  ),
  tool(
    'approve_post',
    'Only after an explicit CEO instruction for this reviewed post. Bind the instruction to the exact preview digest. Does not publish.',
    { id: string, digest: string, instruction_ref: string },
    ['id', 'digest', 'instruction_ref'],
  ),
  tool(
    'publish_approved_post',
    'Execute one bounded step of an approved job. Never authorizes a draft. Repeat to resume media processing.',
    { job_id: string },
    ['job_id'],
  ),
  tool(
    'get_publish_job',
    'Read a job result without publication.',
    { job_id: string },
    ['job_id'],
  ),
  tool(
    'recover_publish_job',
    'Admin recovery after checking the actual platform outcome. Requires evidence and an explicit recovery instruction. Do not guess a failed write outcome.',
    {
      job_id: string,
      outcome: { type: 'string', enum: ['published', 'not_published'] },
      evidence: string,
      media_id: string,
    },
    ['job_id', 'outcome', 'evidence'],
  ),
  tool(
    'configure_meta_token',
    'Validate and encrypt a token from a named local environment variable. Never returns the token.',
    { account_id: string, credential_env: string },
    ['account_id', 'credential_env'],
  ),
  tool(
    'refresh_meta_token',
    'Refresh a valid long-lived token. Preserves current credential on failure.',
    { account_id: string },
    ['account_id'],
  ),
]

export async function mcpPublishingContext(
  db: SupabaseClient,
): Promise<PublishingContext> {
  const companyId = process.env.NEXAUTO_COMPANY_ID
  const actorId = process.env.NEXAUTO_OPERATOR_ID
  if (!companyId || !actorId) throw new Error('mcp_scope_required')
  const { data } = await db
    .from('users')
    .select('id')
    .eq('id', actorId)
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .single()
  if (!data) throw new Error('mcp_admin_scope_rejected')
  return { companyId, actorId, source: 'mcp' }
}

export async function assertAccountScope(
  db: SupabaseClient,
  ctx: PublishingContext,
  id: unknown,
) {
  if (typeof id !== 'string') throw new Error('account_scope_required')
  const { data } = await db
    .from('accounts')
    .select('id')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .single()
  if (!data) throw new Error('account_scope_rejected')
}

async function uploadLocal(
  db: SupabaseClient,
  ctx: PublishingContext,
  path: string,
  kind: 'video' | 'image',
) {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('asset_file_required')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const asset = await beginUpload(db, ctx, {
    kind,
    size_bytes: info.size,
    sha256: hash.digest('hex'),
  })
  await new Promise<void>((resolve, reject) => {
    const uploader = new Upload(createReadStream(path), {
      endpoint: asset.endpoint,
      uploadSize: info.size,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000],
      headers: { 'x-signature': asset.upload_token },
      metadata: {
        bucketName: asset.bucket,
        objectName: asset.path,
        contentType: asset.mime_type,
      },
      onSuccess: () => resolve(),
      onError: () => reject(new Error('asset_upload_failed')),
    })
    uploader.start()
  })
  return verifyAsset(db, ctx, asset.id)
}

export async function callPublishingTool(
  db: SupabaseClient,
  ctx: PublishingContext,
  name: string,
  args: Record<string, unknown>,
) {
  switch (name) {
    case 'upload_media':
      return uploadLocal(
        db,
        ctx,
        args.path as string,
        args.kind as 'video' | 'image',
      )
    case 'preview_post':
      return previewPost(db, ctx, args.id as string)
    case 'approve_post':
      return publicJob(
        await approvePost(
          db,
          ctx,
          args.id as string,
          args.digest as string,
          args.instruction_ref as string,
        ),
      )
    case 'publish_approved_post':
      return publicJob(await runJob(db, ctx, args.job_id as string))
    case 'get_publish_job':
      return publicJob(await getJob(db, ctx, args.job_id as string))
    case 'recover_publish_job':
      return publicJob(
        await publishingRpc<PublishJob>(db, 'recover_publication', {
          p_job: args.job_id,
          p_company: ctx.companyId,
          p_actor: ctx.actorId,
          p_outcome: args.outcome,
          p_evidence: args.evidence,
          p_media: args.media_id ?? null,
        }),
      )
    case 'configure_meta_token': {
      await assertAccountScope(db, ctx, args.account_id)
      const envName = args.credential_env as string
      if (!/^[A-Z][A-Z0-9_]*$/.test(envName))
        throw new Error('credential_name_required')
      const token = process.env[envName]
      if (!token) throw new Error('credential_not_configured')
      return registerToken(db, ctx, args.account_id as string, token)
    }
    case 'refresh_meta_token':
      return refreshConnection(db, ctx, args.account_id as string)
    default:
      throw new Error('unknown_publishing_tool')
  }
}
