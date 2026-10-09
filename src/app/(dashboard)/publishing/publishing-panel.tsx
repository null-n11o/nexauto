'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Upload } from 'tus-js-client'
import { Button } from '@/components/ui/button'
import type { MetaContent } from '../../../../packages/mcp-server/src/publishing/provider'

export interface PublishingAccount {
  id: string
  account_name: string
  platform: 'instagram' | 'threads'
  connection_status: string
  token_expires_at: string | null
}
export interface PublishingPost {
  id: string
  account_id: string
  content: string
  status: string
  asset_id: string | null
  execution_at: string | null
}
export interface JobView {
  id: string
  post_id: string
  state: string
  run_at: string
  permalink: string | null
  platform_post_id: string | null
  error_code: string | null
}
interface Preview {
  snapshot: MetaContent
  digest: string
  mediaUrl?: string
  coverUrl?: string
}

async function api(body: Record<string, unknown>) {
  const response = await fetch('/api/publishing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error)
  return data
}

const stateLabels: Record<string, string> = {
  queued: '予約・実行待ち',
  creating: '素材を送信中',
  processing: '動画を処理中',
  publishing: '投稿中',
  published: '公開済み',
  failed: '失敗',
  unknown: '結果の確認が必要',
}

export function PublishingPanel({
  accounts,
  initialPosts,
  initialJobs,
}: {
  accounts: PublishingAccount[]
  initialPosts: PublishingPost[]
  initialJobs: JobView[]
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [captions, setCaptions] = useState<Record<string, string>>({})
  const [asset, setAsset] = useState<string | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [scheduled, setScheduled] = useState('')
  const [share, setShare] = useState(true)
  const [ai, setAi] = useState(false)
  const [posts, setPosts] = useState(initialPosts)
  const [jobs, setJobs] = useState(initialJobs)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    const pending = jobs.filter(
      (j) =>
        ['queued', 'creating', 'processing', 'publishing'].includes(j.state) &&
        Date.parse(j.run_at) <= Date.now(),
    )
    if (!pending.length) return
    const timer = setInterval(() => {
      for (const job of pending)
        void api({ action: 'run', id: job.id })
          .then((updated: JobView) =>
            setJobs((previous) =>
              previous.map((j) => (j.id === updated.id ? updated : j)),
            ),
          )
          .catch(() =>
            setMessage('投稿結果を確認できません。履歴を確認してください。'),
          )
    }, 15000)
    return () => clearInterval(timer)
  }, [jobs])

  async function task(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch {
      setMessage(
        '操作に失敗しました。素材・接続状態・投稿履歴を確認してください。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function upload(
    file: File,
    kind: 'video' | 'image',
    target: 'asset' | 'cover' = 'asset',
  ) {
    if (file.size > (kind === 'video' ? 300000000 : 8000000))
      throw new Error('file_too_large')
    const bytes = await file.arrayBuffer()
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    const sha256 = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    const registration = await api({
      action: 'upload',
      asset: { kind, size_bytes: file.size, sha256 },
    })
    setProgress(0)
    await new Promise<void>((resolve, reject) => {
      const uploader = new Upload(file, {
        endpoint: registration.endpoint,
        headers: { 'x-signature': registration.upload_token },
        metadata: {
          bucketName: registration.bucket,
          objectName: registration.path,
          contentType: registration.mime_type,
        },
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000],
        removeFingerprintOnSuccess: true,
        onProgress: (sent, total) =>
          setProgress(Math.round((sent / total) * 100)),
        onError: () => reject(new Error('upload_failed')),
        onSuccess: () => resolve(),
      })
      void uploader
        .findPreviousUploads()
        .then((previous) => {
          const sameAsset = previous.find(
            (p) => p.metadata?.objectName === registration.path,
          )
          if (sameAsset) uploader.resumeFromPreviousUpload(sameAsset)
          uploader.start()
        })
        .catch(reject)
    })
    await api({ action: 'verify', id: registration.id })
    if (target === 'asset') setAsset(registration.id)
    else setCover(registration.id)
    setProgress(null)
    setMessage('素材の登録と確認が完了しました。')
  }

  async function createDrafts() {
    const execution_at = scheduled ? new Date(scheduled).toISOString() : null
    for (const id of selected) {
      const account = accounts.find((a) => a.id === id)!
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: id,
          content: captions[id] ?? '',
          scheduled_date: new Date().toISOString().slice(0, 10),
          asset_id: asset,
          cover_asset_id: account.platform === 'instagram' ? cover : null,
          share_to_feed: share,
          is_ai_generated: ai,
          execution_at,
        }),
      })
      if (!response.ok) throw new Error('draft_failed')
      const post = await response.json()
      setPosts((previous) => [post, ...previous])
    }
    setMessage('下書きを保存しました。投稿内容を確認して承認してください。')
  }

  async function review(id: string) {
    const reviewed: Preview = await api({ action: 'preview', id })
    const mediaId = reviewed.snapshot.asset?.id
    if (mediaId)
      reviewed.mediaUrl = (
        await api({ action: 'asset-preview', id: mediaId })
      ).url
    if (reviewed.snapshot.cover)
      reviewed.coverUrl = (
        await api({ action: 'asset-preview', id: reviewed.snapshot.cover.id })
      ).url
    setPreview(reviewed)
  }

  async function approve() {
    if (!preview) return
    const snapshot = preview.snapshot
    let job: JobView = await api({
      action: 'approve',
      id: snapshot.post_id,
      digest: preview.digest,
      instruction: `UI confirmation for ${snapshot.account_name}, post ${snapshot.post_id}, execution ${snapshot.execution_at ?? 'immediate'}`,
    })
    setJobs((previous) => [job, ...previous.filter((j) => j.id !== job.id)])
    setPreview(null)
    if (Date.parse(job.run_at) <= Date.now()) {
      job = await api({ action: 'run', id: job.id })
      setJobs((previous) => previous.map((j) => (j.id === job.id ? job : j)))
    }
    setMessage(
      '承認した投稿を受け付けました。処理状況は投稿履歴で確認できます。',
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Instagram・Threads投稿</h1>
      <p className="text-sm text-gray-600">
        素材と本文を下書きに保存し、内容を確認してから投稿を承認します。
      </p>
      {!accounts.length && (
        <p>先にアカウント画面でInstagramまたはThreadsを登録してください。</p>
      )}
      <section
        className="bg-white rounded-lg shadow p-6 space-y-4"
        aria-label="投稿の下書き"
      >
        <label className="block text-sm">
          動画（MP4・3秒〜5分・最大300MB）
          <input
            aria-label="動画ファイル"
            type="file"
            accept="video/mp4"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void task(() => upload(f, 'video'))
            }}
            className="block mt-2"
          />
        </label>
        <label className="block text-sm">
          Threadsの画像（JPEG・最大8MB、動画とどちらか一つ）
          <input
            aria-label="Threadsの画像ファイル"
            type="file"
            accept="image/jpeg"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void task(() => upload(f, 'image'))
            }}
            className="block mt-2"
          />
        </label>
        <label className="block text-sm">
          Instagramの表紙（JPEG・最大8MB）
          <input
            aria-label="表紙ファイル"
            type="file"
            accept="image/jpeg"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void task(() => upload(f, 'image', 'cover'))
            }}
            className="block mt-2"
          />
        </label>
        {progress !== null && <p role="status">アップロード {progress}%</p>}
        {asset && (
          <p className="text-sm text-green-700">
            投稿素材の確認が完了しました。
          </p>
        )}
        {cover && (
          <p className="text-sm text-green-700">表紙の確認が完了しました。</p>
        )}
        {accounts.map((account) => (
          <div key={account.id} className="border rounded p-3 space-y-2">
            <label>
              <input
                type="checkbox"
                checked={selected.includes(account.id)}
                onChange={(e) =>
                  setSelected((previous) =>
                    e.target.checked
                      ? [...previous, account.id]
                      : previous.filter((id) => id !== account.id),
                  )
                }
              />{' '}
              {account.account_name}・
              {account.platform === 'instagram' ? 'Instagram' : 'Threads'}
            </label>
            <p className="text-xs text-gray-500">
              {account.connection_status === 'connected'
                ? '接続確認済み'
                : '接続の確認が必要'}
              ・
              {account.token_expires_at
                ? `有効期限 ${new Date(account.token_expires_at).toLocaleString()}`
                : '有効期限は未確認'}
            </p>
            {selected.includes(account.id) && (
              <label className="block text-sm">
                投稿本文
                <textarea
                  aria-label={`${account.account_name}の投稿本文`}
                  value={captions[account.id] ?? ''}
                  maxLength={account.platform === 'instagram' ? 2200 : 500}
                  onChange={(e) =>
                    setCaptions((previous) => ({
                      ...previous,
                      [account.id]: e.target.value,
                    }))
                  }
                  className="block w-full border rounded p-2 mt-1"
                />
              </label>
            )}
          </div>
        ))}
        <label className="block text-sm">
          投稿日時（空欄は即時投稿）
          <input
            aria-label="投稿日時"
            type="datetime-local"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
            className="block border rounded p-2 mt-1"
          />
        </label>
        <label className="block text-sm">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
          />{' '}
          Instagramのフィードにも表示
        </label>
        <label className="block text-sm">
          <input
            type="checkbox"
            checked={ai}
            onChange={(e) => setAi(e.target.checked)}
          />{' '}
          InstagramにAI生成の表示を付ける
        </label>
        <Button
          disabled={
            busy ||
            !selected.length ||
            (selected.some(
              (id) =>
                accounts.find((a) => a.id === id)?.platform === 'instagram',
            ) &&
              !asset)
          }
          onClick={() => void task(createDrafts)}
        >
          下書きを保存
        </Button>
      </section>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <section className="space-y-3">
        <h2 className="font-medium">投稿内容の確認</h2>
        {posts.map((post) => (
          <div key={post.id} className="bg-white rounded shadow p-4">
            <p className="text-sm font-medium">
              {accounts.find((a) => a.id === post.account_id)?.account_name}
            </p>
            <p className="whitespace-pre-wrap text-sm my-2">{post.content}</p>
            <Button
              disabled={busy}
              onClick={() => void task(() => review(post.id))}
            >
              内容を確認
            </Button>
          </div>
        ))}
      </section>
      {preview && (
        <section
          aria-label="投稿の承認"
          className="border-2 border-blue-500 bg-white rounded p-6 space-y-3"
        >
          <h2 className="font-medium">
            {preview.snapshot.account_name}への投稿
          </h2>
          <p>
            {preview.snapshot.platform === 'instagram'
              ? 'Instagram'
              : 'Threads'}
          </p>
          {preview.mediaUrl &&
            (preview.snapshot.asset?.kind === 'video' ? (
              <video src={preview.mediaUrl} controls className="max-h-80" />
            ) : (
              <Image
                unoptimized
                src={preview.mediaUrl}
                alt="投稿画像"
                width={1080}
                height={1080}
                className="max-h-80 w-auto object-contain"
              />
            ))}
          {preview.coverUrl && (
            <Image
              unoptimized
              src={preview.coverUrl}
              alt="Instagramの表紙"
              width={1080}
              height={1920}
              className="max-h-48 w-auto object-contain"
            />
          )}
          <p className="whitespace-pre-wrap">{preview.snapshot.content}</p>
          <p>
            {preview.snapshot.execution_at
              ? new Date(preview.snapshot.execution_at).toLocaleString()
              : '承認後に即時投稿'}
          </p>
          {preview.snapshot.platform === 'instagram' && (
            <p className="text-sm">
              フィード表示 {preview.snapshot.share_to_feed ? 'あり' : 'なし'}
              ・AI生成表示 {preview.snapshot.is_ai_generated ? 'あり' : 'なし'}
              ・表紙 {preview.snapshot.cover ? 'あり' : 'なし'}
            </p>
          )}
          <Button disabled={busy} onClick={() => void task(approve)}>
            {preview.snapshot.execution_at
              ? '確認した内容で予約する'
              : '確認した内容で投稿する'}
          </Button>
          <Button variant="outline" onClick={() => setPreview(null)}>
            戻る
          </Button>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="font-medium">投稿履歴</h2>
        {jobs.map((job) => (
          <div key={job.id} className="bg-white rounded shadow p-4 text-sm">
            <p>{stateLabels[job.state] ?? job.state}</p>
            {job.permalink && (
              <a
                href={job.permalink}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                公開した投稿を開く
              </a>
            )}
            {job.state === 'published' && !job.permalink && (
              <p>投稿ID {job.platform_post_id}</p>
            )}
            {job.error_code && <p>結果コード {job.error_code}</p>}
            {job.state === 'unknown' && (
              <p>再投稿する前に公開先で結果を確認してください。</p>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  const updated: JobView = await api({
                    action: 'status',
                    id: job.id,
                  })
                  setJobs((previous) =>
                    previous.map((j) => (j.id === job.id ? updated : j)),
                  )
                })
              }
            >
              状況を確認
            </Button>
          </div>
        ))}
      </section>
    </div>
  )
}
