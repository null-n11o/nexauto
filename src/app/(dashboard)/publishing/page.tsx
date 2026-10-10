import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  PublishingPanel,
  type PublishingAccount,
  type PublishingPost,
  type JobView,
} from './publishing-panel'

export default async function PublishingPage() {
  const db = await createClient()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await db
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin')
    return <p>投稿の承認には管理者権限が必要です。</p>
  const { data: accounts } = await db
    .from('accounts')
    .select('id,account_name,platform,connection_status,token_expires_at')
    .in('platform', ['threads', 'instagram'])
  const ids = (accounts ?? []).map((a) => a.id)
  const { data: posts } = await db
    .from('posts')
    .select('id,account_id,content,status,asset_id,execution_at')
    .in('account_id', ids)
    .neq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(50)
  const { data: jobs } = await db
    .from('publish_jobs')
    .select('id,post_id,state,run_at,platform_post_id,permalink,error_code')
    .order('approved_at', { ascending: false })
    .limit(50)
  return (
    <PublishingPanel
      accounts={(accounts ?? []) as PublishingAccount[]}
      initialPosts={(posts ?? []) as PublishingPost[]}
      initialJobs={(jobs ?? []) as JobView[]}
    />
  )
}
