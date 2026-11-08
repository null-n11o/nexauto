'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function MetaTokenForm({
  accountId,
  expiresAt,
  connected,
}: {
  accountId: string
  expiresAt: string | null
  connected: boolean
}) {
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(action: 'token' | 'refresh') {
    setBusy(true)
    try {
      const response = await fetch('/api/publishing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: accountId, token }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error('connection_failed')
      setToken('')
      setMessage(
        data.expires_at
          ? `更新しました。有効期限 ${new Date(data.expires_at).toLocaleString()}`
          : 'アカウントと投稿権限を確認して保存しました。有効期限は未確認です。',
      )
    } catch {
      setMessage(
        '接続を確認できませんでした。トークンと有効期限を確認してください。',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <p>
        {connected ? '接続確認済み' : '接続の確認が必要'}・
        {expiresAt
          ? `有効期限 ${new Date(expiresAt).toLocaleString()}`
          : '有効期限は未確認'}
      </p>
      <label className="block">
        長期アクセストークン
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="block w-full border rounded p-2"
          autoComplete="off"
        />
      </label>
      <Button disabled={busy || !token} onClick={() => void submit('token')}>
        接続を確認して保存
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void submit('refresh')}
      >
        長期トークンを更新
      </Button>
      <p>更新できるのは取得から24時間以上経過した有効な長期トークンです。</p>
      {message && <p role="status">{message}</p>}
    </div>
  )
}
