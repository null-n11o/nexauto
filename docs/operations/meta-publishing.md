# Instagram and Threads publishing rollout

Implementation task: [N11-286](https://linear.app/n11o/issue/N11-286/nexauto-publish-instagram-reels-and-threads-videos-after-explicit).
Design: [Meta publishing](../designs/2026-10-09-meta-publishing.md).

The implementation adds `/publishing` and a shared job service used by UI, API, worker, and MCP. It does not activate production scheduling or import platform credentials. Production migration, deployment, Storage changes, token import, and live posting require their explicit rollout authorization.

## Before deployment

1. Review and apply `20261009000000_meta_publishing.sql` through the project's normal migration process after authorization. Existing X and non-Dober Threads accounts keep legacy behavior. Service-role historical imports remain possible with a platform media ID; importing metadata skips posts already confirmed by an approved publish job. Accounts with `dober` in their name and all new Meta accounts require explicit approval. Check the actual account names and policies before enabling any worker.
2. Verify the Supabase global file limit, private `post-media` bucket, storage allowance, and bandwidth. The migration requests a 300 MB bucket limit; it cannot raise the project's global limit. A Free project's 50 MB global limit can reject a larger video. Do not purchase a plan automatically.
3. Preserve the existing server-side `ENCRYPTION_KEY`. A different key cannot decrypt stored account credentials. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only and `CRON_SECRET` nonempty.
4. Register the expected Instagram and Threads platform user IDs separately. Use the account settings token form or the scoped MCP `configure_meta_token` operation. Load a token through the existing credential path; never place tokens in this document, issue, PR, or command output. Registration checks account identity and publishing quota access before encrypted storage. Token expiry remains unknown until a validated refresh response supplies it.
5. Test a signed Storage URL using a non-publication container creation for each destination. Confirm that Meta can fetch and finish processing the video. This live check was not performed during implementation.
6. Verify deployment runtime and cron availability, then separately authorize scheduling `/api/cron/publishing` with `Authorization: Bearer <CRON_SECRET>`. The route processes at most one due job per invocation and refreshes one expiring connection only when no job is selected. `vercel.json` deliberately does not activate this worker. Scheduled jobs depend on the configured worker cadence; the browser resumes due jobs while the publishing page is open.

## Posting

Upload MP4 once, select destinations, and save separate captions. Instagram requires a video and supports a JPEG cover. Threads supports text, a verified JPEG, or a verified video. The conservative video validator accepts 3 seconds to 5 minutes, H.264/HEVC, 23–60 fps, dimensions up to 1920 pixels, and optional AAC audio. External image URLs cannot enter the new approval flow; upload their content as a verified image asset.

Review the preview for each destination and confirm the immediate post or execution timestamp. Changing any content covered by the approval invalidates a queued job. Active, uncertain, and published jobs lock their post content. Uploading, saving, or setting a post to `ready` never creates approval. Each destination keeps a separate result.

MCP requires `NEXAUTO_COMPANY_ID` and `NEXAUTO_OPERATOR_ID` in the untracked `.env.local` used by `scripts/codex-mcp-nexauto.mjs`. The operator must be an admin in the selected company. Existing account tools also enforce this scope. The MCP is a trusted local operator tool; do not expose its service-role credentials to customers.

Agent sequence: `upload_media` → `create_post` → `preview_post` → CEO instruction for the reviewed destination/content/time → `approve_post` with the exact digest and instruction reference → `publish_approved_post` → `get_publish_job`. Each execution is bounded; a `processing` result requires a later execution of the same job, not a new approval or post.

## Uncertain results and recovery

A timeout or lost result after a platform write yields `unknown`. Lease expiration in `creating` or `publishing` also yields `unknown`. Automatic retry, generic edits, and a second approval cannot bypass that state. Confirmed media IDs are persisted before permalink lookup, so a missing permalink does not authorize a new post.

An admin must check container status and the actual platform/account for the result. `recover_publish_job` records the operator's evidence and either the verified published media ID or an attestation that publication did not occur. Evidence is an operator statement, not an automatic proof. Use `not_published` only after that verification and an explicit instruction to retry. Do not infer non-publication from a timeout, missing permalink, or a stale browser screen. Recovery requeues the same job and rechecks its content digest. The UI shows the uncertain state; the initial recovery operation is available through the trusted MCP or authenticated API.

## Verification

- `npm run test:run`, `npm run lint`, `npm run build`, and `npm run build --prefix packages/mcp-server`.
- `python3 scripts/test-publishing-db.py`: isolated PostgreSQL cluster, all migrations, approval scope, revisions, concurrent claims, uncertain writes, recovery, publication, and privilege checks. Requires PostgreSQL binaries available through `pg_config`; uses a temporary Unix socket and never connects to production. Auth and Storage schema stubs do not constitute a full Supabase Storage integration test.
- `node scripts/check-video-validator.mjs <synthetic.mp4>`: actual streamed MP4 parsing/checksum with mocked Storage download and metadata operations.
- `node scripts/publishing-ui-fixture.mjs`: actual publishing panel against a local synthetic API on port 4317. Pass a synthetic JPEG path as the optional first argument to exercise the image preview. No real platform calls. Inspect `/api/test-results` to verify zero dispatches before confirmation and one after confirmation.

A successful local test establishes implementation readiness. Operational readiness still requires the authorized production rollout and a separately approved live post with specific reviewed content.
