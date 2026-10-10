import { createHash, randomUUID } from 'node:crypto'
import { createFile, MP4BoxBuffer, type Movie } from 'mp4box'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishingContext } from './jobs.ts'

export interface AssetInput {
  kind: 'video' | 'image'
  size_bytes: number
  sha256: string
}

export function validateAssetInput(input: AssetInput) {
  if (
    !['video', 'image'].includes(input.kind) ||
    !Number.isSafeInteger(input.size_bytes) ||
    input.size_bytes <= 0 ||
    input.size_bytes > (input.kind === 'video' ? 300000000 : 8000000) ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  )
    throw new Error('invalid_asset')
}

export async function beginUpload(
  db: SupabaseClient,
  ctx: PublishingContext,
  input: AssetInput,
) {
  validateAssetInput(input)
  const id = randomUUID()
  const path = `${ctx.companyId}/${id}/${input.kind === 'video' ? 'video.mp4' : 'image.jpg'}`
  const mime_type = input.kind === 'video' ? 'video/mp4' : 'image/jpeg'
  const { error } = await db
    .from('media_assets')
    .insert({
      id,
      company_id: ctx.companyId,
      object_path: path,
      mime_type,
      kind: input.kind,
      size_bytes: input.size_bytes,
      sha256: input.sha256,
      status: 'uploading',
    })
  if (error) throw new Error('asset_registration_failed')
  const { data, error: signError } = await db.storage
    .from('post-media')
    .createSignedUploadUrl(path, { upsert: false })
  if (signError || !data) throw new Error('upload_unavailable')
  const origin = new URL(data.signedUrl).origin
  const endpoint = `${origin}/storage/v1/upload/resumable/sign`
  return {
    id,
    path,
    bucket: 'post-media',
    endpoint,
    upload_token: data.token,
    mime_type,
  }
}

export function validateMovie(movie: Movie | null) {
  const video = movie?.videoTracks[0]
  if (
    !movie ||
    !video ||
    movie.videoTracks.length !== 1 ||
    movie.isFragmented ||
    !movie.hasMoov
  )
    throw new Error('unsupported_video')
  const duration = movie.duration / movie.timescale
  const fps = video.nb_samples / (video.duration / video.timescale)
  if (
    !Number.isFinite(duration) ||
    duration < 3 ||
    duration > 300 ||
    !video.video ||
    video.video.width > 1920 ||
    video.video.height > 1920 ||
    !/^(avc1|hvc1|hev1)\./.test(video.codec) ||
    !Number.isFinite(fps) ||
    fps < 23 ||
    fps > 60 ||
    video.bitrate > 25000000
  )
    throw new Error('unsupported_video')
  if (
    movie.audioTracks.some(
      (t) =>
        !t.codec.startsWith('mp4a.40.') ||
        !t.audio ||
        t.audio.channel_count > 2 ||
        t.audio.sample_rate > 48000,
    )
  )
    throw new Error('unsupported_audio')
}

export async function verifyAsset(
  db: SupabaseClient,
  ctx: PublishingContext,
  id: string,
) {
  const { data: asset, error } = await db
    .from('media_assets')
    .select('*')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .single()
  if (error || !asset) throw new Error('asset_not_found')
  if (asset.status === 'verified') return { id, status: 'verified' }
  const { data: signed, error: signError } = await db.storage
    .from('post-media')
    .createSignedUrl(asset.object_path, 300)
  if (signError || !signed) throw new Error('asset_not_uploaded')
  const response = await fetch(signed.signedUrl, {
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok || !response.body) throw new Error('asset_not_uploaded')
  const hash = createHash('sha256')
  let size = 0
  let prefix = Buffer.alloc(0)
  let tail = Buffer.alloc(0)
  let movie: Movie | null = null
  let parseError = false
  const mp4 = createFile(false)
  mp4.onReady = (info) => {
    movie = info
  }
  mp4.onError = () => {
    parseError = true
  }
  const reader = response.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (size + value.byteLength > asset.size_bytes)
        throw new Error('asset_size_mismatch')
      hash.update(value)
      if (prefix.length < 16)
        prefix = Buffer.concat([prefix, Buffer.from(value)]).subarray(0, 16)
      tail = Buffer.concat([tail, Buffer.from(value)]).subarray(-2)
      if (asset.kind === 'video')
        mp4.appendBuffer(
          MP4BoxBuffer.fromArrayBuffer(value.slice().buffer, size),
        )
      size += value.byteLength
    }
    if (size !== asset.size_bytes || hash.digest('hex') !== asset.sha256)
      throw new Error('asset_integrity_mismatch')
    if (asset.kind === 'video') {
      mp4.flush()
      if (parseError) throw new Error('unsupported_video')
      validateMovie(movie)
    } else if (
      prefix[0] !== 0xff ||
      prefix[1] !== 0xd8 ||
      tail.at(-2) !== 0xff ||
      tail.at(-1) !== 0xd9
    )
      throw new Error('unsupported_image')
  } finally {
    await reader.cancel().catch(() => {})
  }
  const { error: updateError } = await db
    .from('media_assets')
    .update({ status: 'verified' })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .eq('status', 'uploading')
  if (updateError) throw new Error('asset_verification_save_failed')
  return { id, status: 'verified' }
}

export async function assetPreview(
  db: SupabaseClient,
  ctx: PublishingContext,
  id: string,
) {
  const { data: asset } = await db
    .from('media_assets')
    .select('object_path')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .eq('status', 'verified')
    .single()
  if (!asset) throw new Error('asset_not_found')
  const { data } = await db.storage
    .from('post-media')
    .createSignedUrl(asset.object_path, 300)
  if (!data) throw new Error('preview_unavailable')
  return data.signedUrl
}
