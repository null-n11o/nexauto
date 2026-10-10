import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AutoReplyForm } from './auto-reply-form'
import { AccountNameForm } from './account-name-form'
import { MetaTokenForm } from './meta-token-form'

export default async function AccountSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/accounts')

  const { data: account } = await supabase
    .from('accounts')
    .select('id, platform, account_name, posting_times, auto_reply_config, company_id, publishing_policy, connection_status, token_expires_at')
    .eq('id', id)
    .single()

  if (!account || account.company_id !== profile.company_id) notFound()

  const config = (account.auto_reply_config ?? {}) as {
    enabled?: boolean
    tiers?: { window_minutes: number; threshold: number }[]
    templates?: string[]
  }

  return (
    <div className="max-w-2xl">
      <Link href="/accounts" className="text-sm text-gray-500 hover:underline">
        ← アカウント一覧
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-6">{account.account_name} の設定</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6 space-y-4">
        <AccountNameForm accountId={account.id} initialName={account.account_name} />
        <div className="border-t pt-4 text-sm space-y-1">
          <p>
            <span className="text-gray-500">プラットフォーム: </span>
            {account.platform === 'x' ? 'X' : account.platform === 'instagram' ? 'Instagram' : 'Threads'}
          </p>
          <p>
            <span className="text-gray-500">投稿時刻: </span>
            {account.posting_times.length > 0 ? account.posting_times.join(', ') : '—'}
          </p>
        </div>
      </div>

      {account.platform !== 'x' && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-sm font-medium mb-1">{account.platform === 'instagram' ? 'Instagram' : 'Threads'} API</h2>
          <p className="text-xs text-gray-500 mb-4">
            Meta for Developersで生成した長期アクセストークンを設定します。
          </p>
          <MetaTokenForm
            accountId={account.id}
            expiresAt={account.token_expires_at}
            connected={account.connection_status === 'connected'}
          />
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-sm font-medium mb-4">自動リプライ設定</h2>
        {account.platform === 'threads' && account.publishing_policy !== 'explicit' ? (
          <AutoReplyForm
            accountId={account.id}
            initial={{
              enabled: config.enabled ?? false,
              tiers: config.tiers ?? [],
              templates: config.templates ?? [],
            }}
          />
        ) : (
          <p className="text-sm text-gray-500">明示承認が必要なアカウントでは自動リプライを実行しません。</p>
        )}
      </div>
    </div>
  )
}
