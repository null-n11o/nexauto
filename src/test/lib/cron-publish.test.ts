// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  claimPostForPublish,
  cronPublishDisposition,
  CRON_PUBLISH_MAX_DURATION,
  MAX_CRON_PUBLISH_RETRIES,
} from '@/lib/cron-publish'

describe('cron publish budget', () => {
  it('allows 120s so settle delay and publish retries fit in one invocation', () => {
    expect(CRON_PUBLISH_MAX_DURATION).toBe(120)
  })
})

describe('cronPublishDisposition', () => {
  it('publishes when there is no error', () => {
    expect(cronPublishDisposition({ error: null, transient: false, retryCount: 0 })).toBe('published')
  })

  it('requeues a transient error while retries remain', () => {
    expect(cronPublishDisposition({ error: 'Threads publish error', transient: true, retryCount: 0 })).toBe('requeue')
    expect(cronPublishDisposition({
      error: 'Threads publish error',
      transient: true,
      retryCount: MAX_CRON_PUBLISH_RETRIES - 1,
    })).toBe('requeue')
  })

  it('fails after the last cron retry of a transient error', () => {
    expect(cronPublishDisposition({
      error: 'Threads publish error',
      transient: true,
      retryCount: MAX_CRON_PUBLISH_RETRIES,
    })).toBe('failed')
  })

  it('fails immediately on a non-transient error', () => {
    expect(cronPublishDisposition({ error: 'Rate limit exceeded', transient: false, retryCount: 0 })).toBe('failed')
  })
})

describe('claimPostForPublish', () => {
  it('claims a ready post that has no active lease', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: 'post-1' }], error: null })
    const or = vi.fn(() => ({ select }))
    const eqStatus = vi.fn(() => ({ or }))
    const eqId = vi.fn(() => ({ eq: eqStatus }))
    const update = vi.fn(() => ({ eq: eqId }))
    const from = vi.fn(() => ({ update }))
    const claimed = await claimPostForPublish({ from } as never, 'post-1', Date.parse('2026-11-23T00:00:00.000Z'))

    expect(claimed).toBe(true)
    expect(update).toHaveBeenCalledWith({ publish_claimed_at: '2026-11-23T00:00:00.000Z' })
    expect(eqId).toHaveBeenCalledWith('id', 'post-1')
    expect(eqStatus).toHaveBeenCalledWith('status', 'ready')
    expect(or).toHaveBeenCalledWith(expect.stringMatching(/publish_claimed_at\.is\.null/))
  })

  it('skips a post already claimed by another run', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const or = vi.fn(() => ({ select }))
    const eqStatus = vi.fn(() => ({ or }))
    const eqId = vi.fn(() => ({ eq: eqStatus }))
    const update = vi.fn(() => ({ eq: eqId }))
    const from = vi.fn(() => ({ update }))
    const claimed = await claimPostForPublish({ from } as never, 'post-1')

    expect(claimed).toBe(false)
  })

  it('fails open when the claim column is missing so publish still proceeds', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: 'column publish_claimed_at does not exist' } })
    const or = vi.fn(() => ({ select }))
    const eqStatus = vi.fn(() => ({ or }))
    const eqId = vi.fn(() => ({ eq: eqStatus }))
    const update = vi.fn(() => ({ eq: eqId }))
    const from = vi.fn(() => ({ update }))
    const claimed = await claimPostForPublish({ from } as never, 'post-1')

    expect(claimed).toBe(true)
  })
})
