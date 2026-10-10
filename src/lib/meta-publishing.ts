import { createClient, createServiceClient } from '@/lib/supabase/server'
export * from '../../packages/mcp-server/src/publishing/jobs'
export * from '../../packages/mcp-server/src/publishing/assets'
export * from '../../packages/mcp-server/src/publishing/accounts'

export async function publishingSession() {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await client
    .from('users')
    .select('company_id,role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') throw new Error('admin_required')
  return {
    db: await createServiceClient(),
    ctx: {
      companyId: profile.company_id as string,
      actorId: user.id,
      source: 'ui' as const,
    },
  }
}
