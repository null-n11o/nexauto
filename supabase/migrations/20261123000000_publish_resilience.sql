-- =============================================================================
-- Publish resilience: record Threads status polls, claim due posts, retry count
--
-- Apply AFTER 20260720000000_publish_logs.sql through the project's normal
-- migration process. Do not run this against the production database from an
-- agent or CI step.
-- =============================================================================

ALTER TABLE publish_logs
  ADD COLUMN IF NOT EXISTS status_http_status INTEGER,
  ADD COLUMN IF NOT EXISTS status_ms INTEGER,
  ADD COLUMN IF NOT EXISTS status_response JSONB;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS publish_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_retry_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN posts.publish_claimed_at IS
  'Lease timestamp for /api/cron/publish so overlapping invocations do not double-post.';

COMMENT ON COLUMN posts.publish_retry_count IS
  'Number of cron-level requeues after a transient Threads publish error.';
