const THREADS_API_BASE = 'https://graph.threads.net/v1.0'

interface ThreadsPostOptions {
  accessToken: string
  userId: string
  content: string
  imageUrl?: string | null
  replyToId?: string | null
}

export interface PublishStepMeta {
  httpStatus: number | null
  ms: number | null
  response: unknown | null
}

export interface PublishMeta {
  containerId: string | null
  create: PublishStepMeta | null
  status: PublishStepMeta | null
  publish: PublishStepMeta | null
  failedStep: 'create' | 'status' | 'publish' | null
}

export class PublishError extends Error {
  meta: PublishMeta
  transient: boolean
  constructor(message: string, meta: PublishMeta, transient = false) {
    super(message)
    this.name = 'PublishError'
    this.meta = meta
    this.transient = transient
  }
}

const CONTAINER_POLL_MAX_ATTEMPTS = 10
const CONTAINER_POLL_INTERVAL_MS = 1000
export const PUBLISH_SETTLE_MS = 3000
export const PUBLISH_RETRY_BACKOFF_MS = [5000, 10000, 15000] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type ThreadsErrorBody = {
  code?: number
  error_subcode?: number
  is_transient?: boolean
  message?: string
  error_user_title?: string
  error_user_msg?: string
}

export function isTransientThreadsPublishError(errorBody: unknown): boolean {
  if (!errorBody || typeof errorBody !== 'object') return false
  const wrapped = errorBody as { error?: unknown }
  const raw = wrapped.error && typeof wrapped.error === 'object' ? wrapped.error : errorBody
  const error = raw as ThreadsErrorBody
  if (error.is_transient === true) return true
  if (error.code === 24 && error.error_subcode === 4279009) return true
  const text = `${error.message ?? ''} ${error.error_user_title ?? ''} ${error.error_user_msg ?? ''}`
  return /does not exist|cannot be found|Media Not Found/i.test(text)
}

type ContainerStatusBody = {
  status?: string
  error_message?: string
  error?: { message?: string }
  id?: string
}

async function fetchContainerStatus(
  containerId: string,
  accessToken: string,
  startedAt: number,
): Promise<PublishStepMeta> {
  const statusUrl = new URL(`${THREADS_API_BASE}/${containerId}`)
  statusUrl.searchParams.set('fields', 'status,error_message')
  statusUrl.searchParams.set('access_token', accessToken)

  const res = await fetch(statusUrl.toString())
  const data = await res.json()
  return { httpStatus: res.status, ms: Date.now() - startedAt, response: data }
}

// コンテナ作成は非同期で処理されるため、status=FINISHED を待たずに
// threads_publish を呼ぶと "The requested resource does not exist" で失敗する。
async function waitForContainerFinished(
  containerId: string,
  accessToken: string,
): Promise<PublishStepMeta> {
  const start = Date.now()
  let lastMeta: PublishStepMeta = { httpStatus: null, ms: null, response: null }

  for (let attempt = 1; attempt <= CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
    lastMeta = await fetchContainerStatus(containerId, accessToken, start)
    const data = lastMeta.response as ContainerStatusBody | null

    if (lastMeta.httpStatus !== 200 || data?.status === 'FINISHED' || data?.status === 'ERROR' || data?.status === 'EXPIRED') {
      return lastMeta
    }

    if (attempt < CONTAINER_POLL_MAX_ATTEMPTS) {
      await sleep(CONTAINER_POLL_INTERVAL_MS)
    }
  }

  return lastMeta
}

function containerStatusReason(statusData: ContainerStatusBody | null): string {
  return statusData?.error_message
    ?? statusData?.error?.message
    ?? `Threads container did not finish processing in time (status: ${statusData?.status ?? 'unknown'})`
}

export async function postToThreads(
  { accessToken, userId, content, imageUrl, replyToId }: ThreadsPostOptions,
): Promise<{ platformPostId: string; meta: PublishMeta }> {
  const meta: PublishMeta = { containerId: null, create: null, status: null, publish: null, failedStep: null }

  // Step 1: Create media container
  const createUrl = new URL(`${THREADS_API_BASE}/${userId}/threads`)
  createUrl.searchParams.set('media_type', imageUrl ? 'IMAGE' : 'TEXT')
  createUrl.searchParams.set('text', content)
  if (imageUrl) createUrl.searchParams.set('image_url', imageUrl)
  if (replyToId) createUrl.searchParams.set('reply_to_id', replyToId)
  createUrl.searchParams.set('access_token', accessToken)

  const createStart = Date.now()
  const createRes = await fetch(createUrl.toString(), { method: 'POST' })
  const createData = await createRes.json()
  meta.create = { httpStatus: createRes.status, ms: Date.now() - createStart, response: createData }

  if (!createRes.ok) {
    meta.failedStep = 'create'
    throw new PublishError(`Threads API error: ${createData.error?.message ?? 'Unknown error'}`, meta)
  }

  const containerId = createData.id
  meta.containerId = containerId

  // Step 2: Wait for the container to finish processing before publishing
  const statusMeta = await waitForContainerFinished(containerId, accessToken)
  meta.status = statusMeta
  const statusData = statusMeta.response as ContainerStatusBody | null

  if (statusData?.status !== 'FINISHED') {
    meta.failedStep = 'status'
    throw new PublishError(`Threads container error: ${containerStatusReason(statusData)}`, meta)
  }

  // FINISHED can still race the publish backend. Meta recommends waiting on
  // average ~30s for media processing; a short settle plus bounded retries
  // covers the text-container propagation case without stalling every slot.
  await sleep(PUBLISH_SETTLE_MS)

  // Step 3: Publish the container, retrying the same creation_id on the
  // known "resource does not exist" / media-not-found race.
  const maxAttempts = 1 + PUBLISH_RETRY_BACKOFF_MS.length
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const publishUrl = new URL(`${THREADS_API_BASE}/${userId}/threads_publish`)
    publishUrl.searchParams.set('creation_id', containerId)
    publishUrl.searchParams.set('access_token', accessToken)

    const publishStart = Date.now()
    const publishRes = await fetch(publishUrl.toString(), { method: 'POST' })
    const publishData = await publishRes.json()
    meta.publish = { httpStatus: publishRes.status, ms: Date.now() - publishStart, response: publishData }

    if (publishRes.ok) {
      return { platformPostId: publishData.id, meta }
    }

    const transient = isTransientThreadsPublishError(publishData)
    if (!transient) {
      meta.failedStep = 'publish'
      throw new PublishError(`Threads publish error: ${publishData.error?.message ?? 'Unknown error'}`, meta, false)
    }

    const recheck = await fetchContainerStatus(containerId, accessToken, Date.now())
    meta.status = recheck
    const recheckData = recheck.response as ContainerStatusBody | null

    if (recheckData?.status === 'PUBLISHED') {
      return { platformPostId: recheckData.id ?? containerId, meta }
    }

    if (recheckData?.status === 'ERROR' || recheckData?.status === 'EXPIRED') {
      meta.failedStep = 'status'
      throw new PublishError(`Threads container error: ${containerStatusReason(recheckData)}`, meta)
    }

    if (attempt < maxAttempts - 1) {
      await sleep(PUBLISH_RETRY_BACKOFF_MS[attempt])
    }
  }

  meta.failedStep = 'publish'
  const lastPublish = meta.publish?.response as { error?: { message?: string } } | null
  throw new PublishError(
    `Threads publish error: ${lastPublish?.error?.message ?? 'Unknown error'}`,
    meta,
    true,
  )
}
