export type MetaPlatform = 'threads' | 'instagram'
export interface MetaContent {
  platform: MetaPlatform
  platform_user_id: string
  content: string
  asset: {
    id: string
    path: string
    sha256: string
    kind: 'video' | 'image'
  } | null
  cover: { id: string; path: string; sha256: string; kind: 'image' } | null
  image_url: string | null
  share_to_feed: boolean
  is_ai_generated: boolean
  account_id: string
  account_name: string
  post_id: string
  revision: number
  execution_at: string | null
}

export class MetaError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
  ) {
    super(code)
  }
}

const bases: Record<MetaPlatform, string> = {
  instagram: 'https://graph.instagram.com/v26.0',
  threads: 'https://graph.threads.net/v1.0',
}

export class MetaProvider {
  constructor(
    private platform: MetaPlatform,
    private token: string,
    private userId: string,
  ) {}

  private async request(
    path: string,
    params: Record<string, string>,
    write = false,
    base = bases[this.platform],
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${base}/${path}`)
    const body = new URLSearchParams(params)
    if (!write) url.search = body.toString()
    let response: Response
    try {
      response = await fetch(url, {
        method: write ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
        body: write ? body : undefined,
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      throw new MetaError('meta_network_error', write)
    }
    let data: Record<string, unknown>
    try {
      data = await response.json()
    } catch {
      throw new MetaError('meta_invalid_response', write)
    }
    if (!response.ok)
      throw new MetaError(
        `meta_http_${response.status}`,
        write && response.status >= 500,
      )
    return data
  }

  async checkIdentity() {
    const fields =
      this.platform === 'instagram' ? 'user_id,username' : 'id,username'
    const data = await this.request('me', { fields })
    if (String(data.user_id ?? data.id) !== this.userId)
      throw new MetaError('account_identity_mismatch')
    await this.checkQuota()
    return {
      id: this.userId,
      username: typeof data.username === 'string' ? data.username : '',
    }
  }

  async checkQuota() {
    const path =
      this.platform === 'instagram'
        ? 'content_publishing_limit'
        : 'threads_publishing_limit'
    const data = await this.request(`${this.userId}/${path}`, {
      fields: 'quota_usage,config',
    })
    const rows = data.data as
      | { quota_usage?: number; config?: { quota_total?: number } }[]
      | undefined
    const quota = rows?.[0]
    if (
      typeof quota?.quota_usage !== 'number' ||
      typeof quota?.config?.quota_total !== 'number'
    )
      throw new MetaError('quota_unavailable')
    if (quota.quota_usage >= quota.config.quota_total)
      throw new MetaError('publishing_quota_exhausted')
  }

  async create(
    content: MetaContent,
    mediaUrl: string | null,
    coverUrl: string | null,
  ) {
    const params: Record<string, string> =
      this.platform === 'instagram'
        ? {
            media_type: 'REELS',
            caption: content.content,
            share_to_feed: String(content.share_to_feed),
            is_ai_generated: String(content.is_ai_generated),
          }
        : {
            media_type:
              content.asset?.kind === 'video'
                ? 'VIDEO'
                : mediaUrl || content.image_url
                  ? 'IMAGE'
                  : 'TEXT',
            text: content.content,
          }
    if (content.asset?.kind === 'video') params.video_url = mediaUrl ?? ''
    else if (mediaUrl || content.image_url)
      params.image_url = mediaUrl ?? content.image_url ?? ''
    if (coverUrl && this.platform === 'instagram') params.cover_url = coverUrl
    const path = this.platform === 'instagram' ? 'media' : 'threads'
    const data = await this.request(`${this.userId}/${path}`, params, true)
    if (typeof data.id !== 'string')
      throw new MetaError('missing_container_id', true)
    return data.id
  }

  async status(containerId: string) {
    const field = this.platform === 'instagram' ? 'status_code' : 'status'
    const data = await this.request(containerId, { fields: field })
    const status = data[field]
    if (typeof status !== 'string')
      throw new MetaError('missing_container_status')
    return status
  }

  async publish(containerId: string) {
    const path =
      this.platform === 'instagram' ? 'media_publish' : 'threads_publish'
    const data = await this.request(
      `${this.userId}/${path}`,
      { creation_id: containerId },
      true,
    )
    if (typeof data.id !== 'string')
      throw new MetaError('missing_media_id', true)
    return data.id
  }

  async permalink(mediaId: string) {
    const data = await this.request(mediaId, { fields: 'permalink' })
    return typeof data.permalink === 'string' &&
      /^https:\/\/(www\.)?(instagram\.com|threads\.(net|com))\//.test(
        data.permalink,
      )
      ? data.permalink
      : null
  }

  async refresh() {
    const path =
      this.platform === 'instagram'
        ? 'refresh_access_token'
        : 'refresh_access_token'
    const grant_type =
      this.platform === 'instagram' ? 'ig_refresh_token' : 'th_refresh_token'
    const base =
      this.platform === 'instagram'
        ? 'https://graph.instagram.com'
        : 'https://graph.threads.net'
    const data = await this.request(
      path,
      { grant_type, access_token: this.token },
      false,
      base,
    )
    if (
      typeof data.access_token !== 'string' ||
      typeof data.expires_in !== 'number' ||
      data.expires_in <= 0
    )
      throw new MetaError('invalid_refresh_response')
    return { token: data.access_token, expiresIn: data.expires_in }
  }
}
