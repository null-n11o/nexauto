export const PUBLISH_CLAIM_LEASE_MS = 3 * 60 * 1000
export const MAX_CRON_PUBLISH_RETRIES = 3
export const CRON_PUBLISH_MAX_DURATION = 120

type ClaimFilter = {
  eq: (column: string, value: string) => ClaimFilter
  or: (filter: string) => ClaimFilter
  select: (columns: string) => PromiseLike<{ data: { id: string }[] | null; error: { message?: string } | null }>
}

type ClaimClient = {
  from: (table: string) => {
    update: (row: { publish_claimed_at: string }) => ClaimFilter
  }
}

export type CronPublishDisposition = 'published' | 'requeue' | 'failed'

export function cronPublishDisposition({
  error,
  transient,
  retryCount,
}: {
  error: string | null
  transient: boolean
  retryCount: number
}): CronPublishDisposition {
  if (!error) return 'published'
  if (transient && retryCount < MAX_CRON_PUBLISH_RETRIES) return 'requeue'
  return 'failed'
}

export async function claimPostForPublish(
  supabase: ClaimClient,
  postId: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const claimedAt = new Date(nowMs).toISOString()
  const leaseExpiry = new Date(nowMs - PUBLISH_CLAIM_LEASE_MS).toISOString()
  const { data, error } = await supabase
    .from('posts')
    .update({ publish_claimed_at: claimedAt })
    .eq('id', postId)
    .eq('status', 'ready')
    .or(`publish_claimed_at.is.null,publish_claimed_at.lt."${leaseExpiry}"`)
    .select('id')

  if (error) {
    console.error('publish claim failed', error.message)
    return true
  }

  return Boolean(data?.length)
}
