import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '../crypto.ts'
import { MetaProvider, type MetaPlatform } from './provider.ts'
import type { PublishingContext } from './jobs.ts'

async function scopedAccount(
  db: SupabaseClient,
  ctx: PublishingContext,
  id: string,
) {
  const { data } = await db
    .from('accounts')
    .select(
      'id,platform,platform_user_id,access_token,token_refreshed_at,token_expires_at,created_at',
    )
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .single()
  if (
    !data ||
    !['instagram', 'threads'].includes(data.platform) ||
    !data.platform_user_id
  )
    throw new Error('account_not_found')
  return data
}

export async function registerToken(
  db: SupabaseClient,
  ctx: PublishingContext,
  id: string,
  token: string,
) {
  if (!token.trim() || token.length > 4096) throw new Error('invalid_token')
  const account = await scopedAccount(db, ctx, id)
  const identity = await new MetaProvider(
    account.platform as MetaPlatform,
    token.trim(),
    account.platform_user_id,
  ).checkIdentity()
  const { error } = await db
    .from('accounts')
    .update({
      access_token: encrypt(token.trim()),
      connection_status: 'connected',
      token_checked_at: new Date().toISOString(),
      token_expires_at: null,
      token_refreshed_at: null,
      publishing_policy: 'explicit',
    })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
  if (error) throw new Error('connection_save_failed')
  return { connected: true, username: identity.username, expires_at: null }
}

export async function refreshConnection(
  db: SupabaseClient,
  ctx: PublishingContext,
  id: string,
) {
  const account = await scopedAccount(db, ctx, id)
  if (!account.access_token) throw new Error('token_unavailable')
  if (
    account.token_refreshed_at &&
    Date.now() - new Date(account.token_refreshed_at).getTime() < 86400000
  )
    throw new Error('refresh_requires_24_hours')
  const oldToken = account.access_token
  const provider = new MetaProvider(
    account.platform as MetaPlatform,
    decrypt(oldToken),
    account.platform_user_id,
  )
  await provider.checkIdentity()
  const refreshed = await provider.refresh()
  await new MetaProvider(
    account.platform as MetaPlatform,
    refreshed.token,
    account.platform_user_id,
  ).checkIdentity()
  const expires_at = new Date(
    Date.now() + refreshed.expiresIn * 1000,
  ).toISOString()
  const { data, error } = await db
    .from('accounts')
    .update({
      access_token: encrypt(refreshed.token),
      token_expires_at: expires_at,
      token_refreshed_at: new Date().toISOString(),
      connection_status: 'connected',
    })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .eq('access_token', oldToken)
    .select('id')
    .single()
  if (error || !data) throw new Error('refresh_save_conflict')
  return { connected: true, expires_at }
}
