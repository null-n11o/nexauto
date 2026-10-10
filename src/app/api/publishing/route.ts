import { NextResponse } from 'next/server'
import {
  publishingSession,
  beginUpload,
  verifyAsset,
  previewPost,
  approvePost,
  runJob,
  getJob,
  publicJob,
  publishingRpc,
  assetPreview,
  registerToken,
  refreshConnection,
  type PublishJob,
} from '@/lib/meta-publishing'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin)
      return NextResponse.json({ error: 'origin_rejected' }, { status: 403 })
    const { db, ctx } = await publishingSession()
    const body = await request.json()
    switch (body.action) {
      case 'upload':
        return NextResponse.json(await beginUpload(db, ctx, body.asset))
      case 'verify':
        return NextResponse.json(await verifyAsset(db, ctx, body.id))
      case 'asset-preview':
        return NextResponse.json({ url: await assetPreview(db, ctx, body.id) })
      case 'preview':
        return NextResponse.json(await previewPost(db, ctx, body.id))
      case 'approve':
        return NextResponse.json(
          publicJob(
            await approvePost(db, ctx, body.id, body.digest, body.instruction),
          ),
        )
      case 'run':
        return NextResponse.json(publicJob(await runJob(db, ctx, body.id)))
      case 'status':
        return NextResponse.json(publicJob(await getJob(db, ctx, body.id)))
      case 'recover':
        return NextResponse.json(
          publicJob(
            await publishingRpc<PublishJob>(db, 'recover_publication', {
              p_job: body.id,
              p_company: ctx.companyId,
              p_actor: ctx.actorId,
              p_outcome: body.outcome,
              p_evidence: body.evidence,
              p_media: body.media_id ?? null,
            }),
          ),
        )
      case 'token':
        return NextResponse.json(
          await registerToken(db, ctx, body.id, body.token),
        )
      case 'refresh':
        return NextResponse.json(await refreshConnection(db, ctx, body.id))
      default:
        return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
    }
  } catch (error) {
    const unauthorized =
      error instanceof Error && error.message === 'Unauthorized'
    const code =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : 'publishing_request_failed'
    return NextResponse.json(
      { error: code },
      { status: unauthorized ? 401 : 400 },
    )
  }
}
