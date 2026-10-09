// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveThreadsPosts } from '../../../packages/mcp-server/src/threads-import'
import type { Movie } from 'mp4box'
import { encrypt } from '../../../packages/mcp-server/src/crypto'
import { MetaProvider } from '../../../packages/mcp-server/src/publishing/provider'
import {
  runJob,
  approvePost,
  type PublishJob,
  publicJob,
} from '../../../packages/mcp-server/src/publishing/jobs'
import {
  beginUpload,
  validateAssetInput,
  validateMovie,
} from '../../../packages/mcp-server/src/publishing/assets'
import { refreshConnection } from '../../../packages/mcp-server/src/publishing/accounts'
import { mcpPublishingContext } from '../../../packages/mcp-server/src/publishing/mcp'

const ctx = { companyId: 'company', actorId: 'admin', source: 'mcp' as const }
const content = {
  post_id: 'post',
  revision: 1,
  account_id: 'account',
  account_name: 'Dober',
  platform: 'instagram' as const,
  platform_user_id: '123',
  content: 'Reviewed caption',
  asset: {
    id: 'video',
    path: 'company/video.mp4',
    kind: 'video' as const,
    sha256: 'a'.repeat(64),
  },
  cover: {
    id: 'cover',
    path: 'company/cover.jpg',
    kind: 'image' as const,
    sha256: 'b'.repeat(64),
  },
  image_url: null,
  share_to_feed: true,
  is_ai_generated: true,
  execution_at: null,
}

function fixture() {
  let job: PublishJob = {
    id: 'job',
    post_id: 'post',
    company_id: 'company',
    state: 'queued',
    fence: 0,
    container_id: null,
    platform_post_id: null,
    permalink: null,
    error_code: null,
    run_at: new Date().toISOString(),
    snapshot: content,
  }
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_publication') {
      if (!['queued', 'processing'].includes(job.state))
        return { data: null, error: null }
      job = { ...job, fence: job.fence + 1 }
      return { data: { ...job }, error: null }
    }
    if (name === 'advance_publication') {
      job = {
        ...job,
        state: args.p_state as PublishJob['state'],
        container_id: (args.p_container as string) ?? job.container_id,
        platform_post_id: (args.p_media as string) ?? job.platform_post_id,
        error_code: (args.p_error as string) ?? null,
      }
      return { data: { ...job }, error: null }
    }
    return { data: null, error: null }
  })
  const db = {
    rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        update: () => query,
        eq: () => query,
        single: async () => ({
          data:
            table === 'accounts'
              ? {
                  access_token: encrypt('fixture-token'),
                  platform_user_id: '123',
                  platform: 'instagram',
                  connection_status: 'connected',
                  token_expires_at: null,
                }
              : { ...job },
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: null, error: null }),
      }
      return query
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: {
            signedUrl:
              'https://storage.example.test/video?token=signed-fixture',
          },
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient
  return { db, rpc, get: () => job }
}

const quota = { data: [{ quota_usage: 0, config: { quota_total: 100 } }] }
function responses(values: (object | Error)[]) {
  const fetchMock = vi.fn(async () => {
    const next = values.shift()
    if (next instanceof Error) throw next
    if (!next) throw new Error('unexpected_request')
    return Response.json(next)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = '1'.repeat(64)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('approved publication behavior', () => {
  it('creates one container, resumes processing, and stores the media result', async () => {
    const { db, get } = fixture()
    const fetchMock = responses([
      { user_id: '123' },
      quota,
      { id: 'container' },
      { status_code: 'FINISHED' },
      { user_id: '123' },
      quota,
      { id: 'media' },
      { permalink: 'https://www.instagram.com/reel/fixture/' },
    ])
    expect((await runJob(db, ctx, 'job')).state).toBe('processing')
    expect(publicJob(await runJob(db, ctx, 'job'))).toMatchObject({
      state: 'published',
      platform_post_id: 'media',
      permalink: 'https://www.instagram.com/reel/fixture/',
    })
    expect((await runJob(db, ctx, 'job')).state).toBe('published')
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(get().platform_post_id).toBe('media')
    const [url, request] = fetchMock.mock.calls[2] as unknown as [
      string,
      RequestInit,
    ]
    expect(String(url)).toBe('https://graph.instagram.com/v26.0/123/media')
    expect(request.body?.toString()).toContain('media_type=REELS')
    expect(request.body?.toString()).toContain('is_ai_generated=true')
    expect(request.body?.toString()).toContain('cover_url=')
    expect(String(url)).not.toContain('fixture-token')
  })

  it('does not retry an uncertain container write', async () => {
    const { db } = fixture()
    const fetchMock = responses([
      { user_id: '123' },
      quota,
      new Error('timeout includes fixture-token'),
    ])
    const job = await runJob(db, ctx, 'job')
    expect(job.state).toBe('unknown')
    expect(JSON.stringify(publicJob(job))).not.toContain('fixture-token')
    await runJob(db, ctx, 'job')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry an uncertain publish request', async () => {
    const { db } = fixture()
    const fetchMock = responses([
      { user_id: '123' },
      quota,
      { id: 'container' },
      { status_code: 'FINISHED' },
      { user_id: '123' },
      quota,
      new Error('timeout'),
    ])
    await runJob(db, ctx, 'job')
    expect((await runJob(db, ctx, 'job')).state).toBe('unknown')
    await runJob(db, ctx, 'job')
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })

  it('keeps processing without sending a publication request', async () => {
    const { db } = fixture()
    const fetchMock = responses([
      { user_id: '123' },
      quota,
      { id: 'container' },
      { status_code: 'IN_PROGRESS' },
    ])
    await runJob(db, ctx, 'job')
    expect((await runJob(db, ctx, 'job')).state).toBe('processing')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('preserves a confirmed publication if permalink lookup fails', async () => {
    const { db } = fixture()
    responses([
      { user_id: '123' },
      quota,
      { id: 'container' },
      { status_code: 'FINISHED' },
      { user_id: '123' },
      quota,
      { id: 'media' },
      new Error('lookup failed'),
    ])
    await runJob(db, ctx, 'job')
    expect(publicJob(await runJob(db, ctx, 'job'))).toMatchObject({
      state: 'published',
      platform_post_id: 'media',
      permalink: null,
    })
  })

  it('keeps an already published container locked until recovery', async () => {
    const { db } = fixture()
    const fetchMock = responses([
      { user_id: '123' },
      quota,
      { id: 'container' },
      { status_code: 'PUBLISHED' },
    ])
    await runJob(db, ctx, 'job')
    expect((await runJob(db, ctx, 'job')).state).toBe('unknown')
    await runJob(db, ctx, 'job')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('refuses an account mismatch before creating a container', async () => {
    const { db } = fixture()
    const fetchMock = responses([{ user_id: 'other' }])
    expect((await runJob(db, ctx, 'job')).state).toBe('failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses exhausted publishing quota', async () => {
    const { db } = fixture()
    responses([
      { user_id: '123' },
      { data: [{ quota_usage: 100, config: { quota_total: 100 } }] },
    ])
    expect((await runJob(db, ctx, 'job')).error_code).toBe(
      'publishing_quota_exhausted',
    )
  })

  it('requires explicit approval data before invoking the database', async () => {
    const { db, rpc } = fixture()
    await expect(
      approvePost(db, ctx, 'post', 'invalid', 'instruction'),
    ).rejects.toThrow('approval_required')
    await expect(
      approvePost(db, ctx, 'post', 'a'.repeat(64), ''),
    ).rejects.toThrow('approval_required')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('creates Threads VIDEO with the same shared adapter', async () => {
    const fetchMock = responses([{ id: 'threads-container' }])
    const provider = new MetaProvider('threads', 'fixture-token', '123')
    await provider.create(
      { ...content, platform: 'threads' },
      'https://media.example.test/video.mp4',
      null,
    )
    const [url, request] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(String(url)).toBe('https://graph.threads.net/v1.0/123/threads')
    expect(request.body?.toString()).toContain('media_type=VIDEO')
    expect(request.body?.toString()).toContain('video_url=')
  })

  it('fails closed when an MCP company or operator is missing', async () => {
    const { db } = fixture()
    vi.stubEnv('NEXAUTO_COMPANY_ID', '')
    vi.stubEnv('NEXAUTO_OPERATOR_ID', '')
    await expect(mcpPublishingContext(db)).rejects.toThrow('mcp_scope_required')
  })
})

describe('asset validation', () => {
  it('does not accept caller-supplied verification or tenant fields', async () => {
    const insert = vi.fn(async (row: unknown) => ({
      error: row ? null : 'empty',
    }))
    const db = {
      from: () => ({ insert }),
      storage: {
        from: () => ({
          createSignedUploadUrl: async () => ({
            data: {
              signedUrl: 'https://storage.example.test/upload',
              token: 'upload',
            },
            error: null,
          }),
        }),
      },
    } as unknown as SupabaseClient
    const input = {
      kind: 'video' as const,
      size_bytes: 1,
      sha256: 'a'.repeat(64),
      status: 'verified',
      company_id: 'other',
      object_path: 'other/secret.mp4',
      id: 'attacker',
    }
    const result = await beginUpload(db, ctx, input)
    expect(insert.mock.calls[0][0]).toMatchObject({
      status: 'uploading',
      company_id: 'company',
      object_path: result.path,
      id: result.id,
    })
    expect(result.path).toMatch(/^company\//)
  })
  it('rejects oversized covers and invalid checksums', () => {
    expect(() =>
      validateAssetInput({
        kind: 'image',
        size_bytes: 8000001,
        sha256: 'a'.repeat(64),
      }),
    ).toThrow('invalid_asset')
    expect(() =>
      validateAssetInput({
        kind: 'video',
        size_bytes: 1,
        sha256: 'not-a-hash',
      }),
    ).toThrow('invalid_asset')
  })
  it('checks server-parsed duration, codecs and frame rate', () => {
    const movie = {
      hasMoov: true,
      isFragmented: false,
      duration: 84000,
      timescale: 1000,
      videoTracks: [
        {
          codec: 'avc1.640028',
          video: { width: 1080, height: 1920 },
          duration: 84000,
          timescale: 1000,
          nb_samples: 2520,
          bitrate: 3000000,
        },
      ],
      audioTracks: [],
    } as unknown as Movie
    expect(() => validateMovie(movie)).not.toThrow()
    expect(() => validateMovie({ ...movie, duration: 400000 })).toThrow(
      'unsupported_video',
    )
    expect(() =>
      validateMovie({
        ...movie,
        videoTracks: [{ ...movie.videoTracks[0], codec: 'vp09' }],
      }),
    ).toThrow('unsupported_video')
  })
})

describe('connection refresh', () => {
  function connection() {
    const credential = encrypt('old-fixture-token')
    const update = vi.fn()
    const query = {
      select: () => query,
      eq: () => query,
      update: (row: unknown) => {
        update(row)
        return query
      },
      single: async () => ({
        data: {
          id: 'account',
          platform: 'instagram',
          platform_user_id: '123',
          access_token: credential,
          token_refreshed_at: null,
        },
        error: null,
      }),
    }
    return { db: { from: () => query } as unknown as SupabaseClient, update }
  }
  it('preserves the current encrypted credential when refresh fails', async () => {
    const { db, update } = connection()
    responses([{ user_id: '123' }, quota, new Error('refresh failed')])
    await expect(refreshConnection(db, ctx, 'account')).rejects.toThrow(
      'meta_network_error',
    )
    expect(update).not.toHaveBeenCalled()
  })
  it('checks the new identity and returns expiry without returning tokens', async () => {
    const { db, update } = connection()
    responses([
      { user_id: '123' },
      quota,
      { access_token: 'new-fixture-token', expires_in: 5184000 },
      { user_id: '123' },
      quota,
    ])
    const result = await refreshConnection(db, ctx, 'account')
    expect(result.connected).toBe(true)
    expect(Date.parse(result.expires_at)).toBeGreaterThan(Date.now())
    expect(JSON.stringify(result)).not.toContain('token')
    expect(update.mock.calls[0][0].access_token).not.toContain(
      'new-fixture-token',
    )
  })
})

it('imports historical Threads posts without changing approved publications', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexauto-import-test-'))
  const updates: string[] = []
  const insert = vi.fn(async () => ({ error: null }))
  let updating = false
  const query = {
    select: () => query,
    eq: (_field: string, id: string) => {
      if (updating) updates.push(id)
      return query
    },
    range: async () => ({
      data: [
        {
          id: 'approved',
          platform_post_id: 'media-approved',
          publish_jobs: [{ state: 'published' }],
        },
        { id: 'legacy', platform_post_id: 'media-legacy', publish_jobs: [] },
      ],
      error: null,
    }),
    update: () => {
      updating = true
      return query
    },
    insert,
    then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
  }
  try {
    const result = await saveThreadsPosts(
      { from: () => query } as unknown as SupabaseClient,
      root,
      'account',
      'Dober fixture',
      ['media-approved', 'media-legacy', 'media-new'].map((id) => ({
        id,
        text: 'Imported caption',
        timestamp: '2026-10-09T00:00:00Z',
      })),
      { pages: 1, dryRun: false },
    )
    expect(result).toMatchObject({ inserted: 1, updated: 1, unchanged: 1 })
    expect(updates).toEqual(['legacy'])
    expect(insert).toHaveBeenCalledTimes(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
