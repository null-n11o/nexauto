export function postMediaFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const key of ['asset_id', 'cover_asset_id'] as const) {
    if (body[key] !== undefined) {
      if (
        body[key] !== null &&
        (typeof body[key] !== 'string' || !/^[a-f0-9-]{36}$/i.test(body[key]))
      )
        throw new Error('invalid_asset_id')
      fields[key] = body[key]
    }
  }
  for (const key of ['share_to_feed', 'is_ai_generated'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean')
        throw new Error('invalid_media_option')
      fields[key] = body[key]
    }
  }
  if (body.execution_at !== undefined) {
    if (
      body.execution_at !== null &&
      (typeof body.execution_at !== 'string' ||
        !Number.isFinite(Date.parse(body.execution_at)))
    )
      throw new Error('invalid_execution_time')
    fields.execution_at =
      body.execution_at === null
        ? null
        : new Date(body.execution_at as string).toISOString()
  }
  return fields
}
