import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { publishAndLog } from '@/lib/publish-log'
import { claimPostForPublish, cronPublishDisposition, CRON_PUBLISH_MAX_DURATION } from '@/lib/cron-publish'

// Settle delay + 3 publish retries (5/10/15s) plus status rechecks must fit
// inside one invocation. Posts in a run are processed in parallel.
export const maxDuration = CRON_PUBLISH_MAX_DURATION

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const now = new Date().toISOString()

  const { data: posts } = await supabase
    .from('posts')
    .select('*, accounts(*)')
    .eq('status', 'ready')
    .lte('scheduled_date', now)

  if (!posts?.length) {
    await cleanupOldLogs(supabase)
    return NextResponse.json({ published: 0 })
  }

  const results = await Promise.allSettled(
    posts.filter(post => post.accounts.platform !== 'instagram' && post.accounts.publishing_policy !== 'explicit').map(async post => {
      const claimed = await claimPostForPublish(supabase, post.id)
      if (!claimed) return { id: post.id, ok: false, skipped: true }

      const account = post.accounts as Record<string, string | null>
      const { platformPostId, error, transient } = await publishAndLog(supabase, {
        post: { id: post.id, account_id: post.account_id, content: post.content, image_url: post.image_url ?? null },
        account: {
          platform: account.platform as never,
          access_token: account.access_token,
          access_token_secret: account.access_token_secret,
          api_key: account.api_key,
          api_secret: account.api_secret,
          platform_user_id: account.platform_user_id,
        },
        trigger: 'cron',
      })

      const retryCount = typeof post.publish_retry_count === 'number' ? post.publish_retry_count : 0
      const disposition = cronPublishDisposition({ error, transient, retryCount })

      if (disposition === 'published') {
        await supabase
          .from('posts')
          .update({ status: 'published', published_at: new Date().toISOString(), platform_post_id: platformPostId, error_message: null })
          .eq('id', post.id)
        return { id: post.id, ok: true }
      }

      if (disposition === 'requeue') {
        const requeue = await supabase
          .from('posts')
          .update({
            status: 'ready',
            publish_retry_count: retryCount + 1,
            publish_claimed_at: null,
            error_message: error,
          })
          .eq('id', post.id)
        if (requeue.error) {
          console.error('publish requeue failed', requeue.error.message)
          await supabase.from('posts').update({ status: 'failed', error_message: error }).eq('id', post.id)
        }
        return { id: post.id, ok: false, error }
      }

      await supabase.from('posts').update({ status: 'failed', error_message: error }).eq('id', post.id)
      return { id: post.id, ok: false, error }
    })
  )

  await cleanupOldLogs(supabase)

  const published = results.filter(r => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length
  return NextResponse.json({ published, total: posts.length })
}

async function cleanupOldLogs(supabase: Awaited<ReturnType<typeof createServiceClient>>) {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase.from('publish_logs').delete().lt('created_at', cutoff)
    if (error?.message) {
      console.error('publish_logs cleanup failed', error.message)
    }
  } catch {
    // クリーンアップ失敗はpublishに影響させない
  }
}
