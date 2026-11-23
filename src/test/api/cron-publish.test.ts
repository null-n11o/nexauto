// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const { mockPublishAndLog, mockCreateServiceClient, mockClaim } = vi.hoisted(() => ({
  mockPublishAndLog: vi.fn(),
  mockCreateServiceClient: vi.fn(),
  mockClaim: vi.fn(),
}))

vi.mock('@/lib/publish-log', () => ({ publishAndLog: mockPublishAndLog }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: mockCreateServiceClient }))
vi.mock('@/lib/cron-publish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cron-publish')>()
  return { ...actual, claimPostForPublish: mockClaim }
})

import { GET, maxDuration } from '@/app/api/cron/publish/route'
import { CRON_PUBLISH_MAX_DURATION } from '@/lib/cron-publish'

function makeRequest(secret = 'test-secret') {
  return new Request('http://localhost/api/cron/publish', {
    headers: { authorization: `Bearer ${secret}` },
  })
}

function threadsPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    account_id: 'acc-1',
    content: 'hello',
    image_url: null,
    publish_retry_count: 0,
    accounts: {
      platform: 'threads',
      publishing_policy: 'legacy',
      access_token: 'tok',
      access_token_secret: null,
      api_key: null,
      api_secret: null,
      platform_user_id: 'user-1',
    },
    ...overrides,
  }
}

function makeSupabaseMock(posts: object[]) {
  const updates: Record<string, unknown>[] = []
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn((row: Record<string, unknown>) => {
    updates.push(row)
    return { eq: updateEq }
  })
  const postsSelect = {
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: object[] }) => void) => resolve({ data: posts }),
  }
  const logsDelete = {
    lt: vi.fn().mockResolvedValue({ error: null }),
  }
  const from = vi.fn((table: string) => {
    if (table === 'posts') return { select: vi.fn(() => postsSelect), update }
    if (table === 'publish_logs') return { delete: vi.fn(() => logsDelete) }
    return {}
  })
  mockCreateServiceClient.mockResolvedValue({ from })
  return { update, updates, updateEq }
}

describe('GET /api/cron/publish', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockClaim.mockResolvedValue(true)
  })

  it('exports maxDuration from the cron publish budget', () => {
    expect(maxDuration).toBe(CRON_PUBLISH_MAX_DURATION)
    expect(maxDuration).toBe(120)
  })

  it('returns 401 when the cron secret does not match', async () => {
    const res = await GET(makeRequest('wrong'))
    expect(res.status).toBe(401)
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('skips a post that another invocation already claimed', async () => {
    mockClaim.mockResolvedValue(false)
    makeSupabaseMock([threadsPost()])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.published).toBe(0)
    expect(mockPublishAndLog).not.toHaveBeenCalled()
  })

  it('marks a successful post published', async () => {
    mockPublishAndLog.mockResolvedValue({ platformPostId: 'media-1', error: null, transient: false })
    const { updates } = makeSupabaseMock([threadsPost()])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.published).toBe(1)
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'published',
      platform_post_id: 'media-1',
    }))
  })

  it('requeues a transient failure instead of marking it failed', async () => {
    mockPublishAndLog.mockResolvedValue({
      platformPostId: null,
      error: 'Threads publish error: The requested resource does not exist',
      transient: true,
    })
    const { updates } = makeSupabaseMock([threadsPost({ publish_retry_count: 0 })])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.published).toBe(0)
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'ready',
      publish_retry_count: 1,
      publish_claimed_at: null,
    }))
    expect(updates.some((row) => row.status === 'failed')).toBe(false)
  })

  it('marks a post failed after the last cron retry', async () => {
    mockPublishAndLog.mockResolvedValue({
      platformPostId: null,
      error: 'Threads publish error: The requested resource does not exist',
      transient: true,
    })
    const { updates } = makeSupabaseMock([threadsPost({ publish_retry_count: 3 })])

    await GET(makeRequest())

    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      error_message: 'Threads publish error: The requested resource does not exist',
    }))
  })
})
