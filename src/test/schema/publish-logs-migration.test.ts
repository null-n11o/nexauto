// @vitest-environment node
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, beforeAll } from 'vitest'

const ORIGINAL_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260720000000_publish_logs.sql',
)
const RESILIENCE_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20261123000000_publish_resilience.sql',
)

let originalSql: string
let resilienceSql: string

beforeAll(() => {
  originalSql = readFileSync(ORIGINAL_PATH, 'utf-8')
  resilienceSql = readFileSync(RESILIENCE_PATH, 'utf-8')
})

describe('publish_logs original migration', () => {
  it('creates publish_logs with create and publish response columns', () => {
    expect(originalSql).toMatch(/CREATE TABLE IF NOT EXISTS publish_logs/)
    expect(originalSql).toMatch(/create_response\s+JSONB/)
    expect(originalSql).toMatch(/publish_response\s+JSONB/)
  })
})

describe('publish resilience migration', () => {
  it('adds status poll columns to publish_logs', () => {
    expect(resilienceSql).toMatch(/ALTER TABLE publish_logs[\s\S]*status_response\s+JSONB/i)
    expect(resilienceSql).toMatch(/status_http_status\s+INTEGER/i)
    expect(resilienceSql).toMatch(/status_ms\s+INTEGER/i)
  })

  it('adds claim and retry columns to posts without changing publishing_policy', () => {
    expect(resilienceSql).toMatch(/publish_claimed_at\s+TIMESTAMPTZ/i)
    expect(resilienceSql).toMatch(/publish_retry_count\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/i)
    expect(resilienceSql).not.toMatch(/publishing_policy/)
    expect(resilienceSql).not.toMatch(/auto_reply/)
  })
})
