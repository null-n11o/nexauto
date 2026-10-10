# Instagram and Threads publishing through NexAuto

Status: proposed for CEO review. No application code or production settings changed.
Request: CEO, 2026-10-09. Publish Instagram and Threads through NexAuto after an explicit instruction.
Development task: [N11-286](https://linear.app/n11o/issue/N11-286/nexauto-publish-instagram-reels-and-threads-videos-after-explicit).

## User outcome

Upload a video once in NexAuto, select Instagram, Threads, or both, and review a separate caption for each destination. An explicit instruction authorizes immediate posting or posting at a chosen time. NexAuto stores the files, manages the platform credentials, and records the result for each destination.

Draft creation, editing, asset upload, and changing a draft to `ready` do not authorize publication. Explicit approval is required for both Dober's Instagram and Threads accounts. Existing `ready` posts never acquire approval through migration. Existing X accounts retain their current behavior during this migration.

## Current implementation

The inspected baseline is `origin/main` at `747eeac`.

| Area | Current behavior | Required change |
| --- | --- | --- |
| `src/types/index.ts` | Platforms are X and Threads. Posts have one image URL. | Add Instagram and typed video attachments. |
| `src/lib/threads-api.ts` | Creates text or image containers, waits up to ten seconds, and publishes. | Add video containers and durable processing across worker runs. |
| `src/lib/publish.ts` | Dispatches X and Threads requests. | Add an Instagram adapter. |
| `src/app/api/publish/route.ts` | An authenticated caller can invoke publication without an approval snapshot or an atomic claim. | Check scope, approval, and a durable job claim before platform writes. |
| `src/app/api/cron/publish/route.ts` | Publishes due `ready` posts without an atomic claim. | Run approved jobs and resume processing safely. |
| `src/app/api/cron/auto-reply/route.ts` | Publishes qualifying Threads replies directly through the Threads adapter. | Exclude explicit-approval accounts. An approved main post does not authorize a later reply. |
| `vercel.json` | Configures a metrics cron only. | Configure publication scheduling during a separately approved rollout. The source route alone does not prove that scheduled posting is running. |
| `packages/mcp-server/src/index.ts` | Saves drafts and updates `draft`, `review`, or `ready`. There is no publishing tool. The client uses a service-role connection. | Add upload, preview, and explicitly approved publishing operations with company scope. |
| Supabase | Database and authentication are in use. No tracked media-bucket migration or upload flow was found. | Add private Storage, asset metadata, and tenant access policies. |

Account credentials already use AES-256-GCM through `src/lib/crypto.ts`. Reuse that server-side encryption. Do not pass decrypted platform tokens to browsers or return them through MCP.

The prior KCP Instagram CLI PR is a reference for account validation, quota checks, and uncertain-write handling. NexAuto owns the resulting production workflow. Do not run two independent publishers for the same Dober post.

## First release scope

- Instagram Reels with an optional JPEG cover, a caption, a feed-sharing choice, and the supported AI disclosure setting.
- Threads text, single image, and single video posts. Preserve existing text and image behavior.
- One uploaded video reusable across destination-specific drafts. Each destination keeps its own post record, caption, approval, and result.
- Immediate and explicitly approved scheduled publication from the UI and the connected agent.
- Admin-only credential registration, identity checks, connection status, expiry tracking, and refresh for supported long-lived tokens.
- A durable publication history that distinguishes processing, success, failure, and an uncertain result.

Carousels, Stories, automatic caption generation, Instagram analytics, and automatic cross-posting to every connected account are outside this release. Instagram accounts must not silently enter the current Threads metrics, follower, or auto-reply jobs.

## Media storage

Use the existing Supabase project first. Add a private `post-media` bucket. Store objects under a company-scoped, immutable path such as `<company-id>/<asset-id>/video.mp4`. Uploading a replacement creates a new asset ID. Do not overwrite an object already used by an approved post.

Use signed resumable uploads so video bytes go directly to Storage. Do not send large video bodies through a Next.js route. Supabase recommends resumable uploads for files above 6 MB. An authenticated server checks the user's company, creates the intended object path, and issues the upload capability. MCP uploads use the same asset contract through a scoped local client.

After upload, the server verifies object existence, size, media type, and checksum. Only verified assets can be selected for publication. Apply video-format validation against each selected platform's current API limits. Client metadata alone cannot establish eligibility.

Generate a fresh signed download URL when an approved job starts. Use a bounded expiry that covers media processing and reuse that URL for the current container. Do not store an expiring URL as the draft's permanent attachment. A signed URL allows its holder to fetch the file until expiry; redact it from logs and MCP output. Meta's ability to fetch this URL must pass a live container-creation check before rollout.

The Supabase project's actual plan, global file limit, available storage, and bandwidth allowance are not yet checked. Free projects cannot raise their file limit above 50 MB. If the final Dober file exceeds the configured limit, report the limit and required change before purchasing or changing the plan. The product can later use a different object store behind the same asset contract.

## Data and authorization

Model each destination as one post plus a durable publish job. Approval applies to immutable content, not to a mutable `ready` label.

| Record | Required data |
| --- | --- |
| Account | Platform, platform user ID, company ID, encrypted token, granted scopes, token expiry and refresh status, and publishing policy. |
| Media asset | Company ID, object path, SHA-256, media type, size, validation status, and uploader. |
| Post | Account ID, caption, asset ID, optional cover asset ID, platform options, revision, and optional execution timestamp. |
| Approval | Post ID, revision, canonical content digest, approving actor, source, timestamp, and immediate or scheduled intent. |
| Publish job | Approval ID, state, lease and fencing version, container ID, dispatch timestamps, platform post ID, permalink, and sanitized error code. |

The digest covers platform and account identity, caption, verified asset hashes, cover, disclosure and feed choices, and execution time. It excludes signed URLs and tokens. Editing any approved field invalidates the approval. Editing is rejected while a job is active; users create a new draft when needed.

The UI's authenticated admin confirms a preview to create an approval. An agent creates an approval only in response to the CEO's explicit instruction naming the reviewed post or posts. Record that instruction's reference with the digest. A digest detects edits; it does not prove human intent. The agent must retain this execution rule.

Do not allow generic post updates or `status=ready` to create approvals. Expose approval and execution as separate operations. The initial trusted MCP remains an operator tool, not a public multi-tenant endpoint. Configure an explicit allowed company at startup and reject every account or post outside that company, including calls using service-role access. Before exposing publishing to other users, use user-scoped authenticated requests instead of an unrestricted service-role MCP.

Enforce tenant ownership, admin publication authority, post revision, and approval scope at the database boundary. Protect approval and job fields from ordinary post updates. Atomic claim operations must check the approval and return at most one executor. Unique constraints prevent a new job for a post revision that has an active, uncertain, or published job. Creating a new approval cannot bypass that constraint. Apply the same claim to manual and scheduled requests.

## Job lifecycle and recovery

Jobs move through `queued`, `creating`, `processing`, `publishing`, and `published`. Terminal API failures use `failed`. Writes whose result cannot be determined use `unknown`.

Persist `creating` before requesting a container. Persist its ID before polling. Poll in bounded worker runs, then resume the same container. A ten-second web request must not classify an otherwise valid long video as a permanent failure.

Persist `publishing` before the publication request. A lease expiring must never cause a second executor to send that request again. If the request or persistence fails after dispatch, reconcile through the platform's supported container status and media lookup. When success cannot be proven, show an uncertain result and block both manual and automatic retry. Only an admin recovery operation with evidence that publication did not occur may permit another attempt. It records that evidence before authorizing the attempt. This design reduces duplicate posts; it does not promise exactly-once delivery across an external API.

Save the platform post ID before fetching its permalink. A permalink lookup or logging failure must not trigger republication. For two destinations, success on one platform remains success even if the other fails. Retry only the failed destination after determining whether its previous request published.

Use a bounded number of jobs per worker run, platform quota checks, request timeouts, and conservative polling. Configure the worker schedule only after the deployment runtime and plan have been verified. Never leave an unprotected GET endpoint that starts platform writes.

## Platform connections

Instagram and Threads require separate tokens and platform identities. Adding an Instagram account does not authorize Threads publication. Validate each token against the expected account and required publishing permission before saving it.

For Dober, Instagram identity and publishing access have already been checked through KCP. The token currently remains in the untracked KCP credential store. It has not been imported into NexAuto's database. Use the existing credential loader for a one-time registration after rollout approval, then encrypt it with NexAuto's key without displaying it.

First support the existing admin credential-registration approach for controlled Dober use. Product-wide connection through Meta OAuth is a subsequent release with app review and access requirements assessed separately. Do not claim that the tester setup permits arbitrary customer accounts.

Track `expires_at` only from a validated provider response. Do not invent an expiry for an existing token. Refresh an eligible long-lived token before expiry, preserve the old token on failure, and disable publication when access is invalid. Unknown expiry stays visible until verified. Treat Instagram and Threads refresh endpoints separately.

## User and agent flow

1. Connect or select the Instagram and Threads accounts.
2. Upload the video once and wait for validation. Attach the optional Instagram cover.
3. Create destination-specific drafts. Show the account name, video preview, caption, and platform options.
4. Review the exact content and either instruct immediate posting or approve a specific execution timestamp.
5. Return job IDs immediately. Show processing progress, a permalink on success, or an actionable failure.

Proposed MCP operations are asset upload, post preview, approval, execution, and job status. All operations use the same validation and job service as the UI. Approval tools require an explicit digest and instruction reference. Do not add a second copy of the platform adapters inside the MCP package.

## Implementation sequence and checks

1. Add account, asset, approval, and job migrations. Verify RLS, protected fields, invalid approval rejection, concurrent claims, and revision invalidation using local Supabase.
2. Add direct uploads and server validation. Verify interrupted upload recovery, cross-company denial, immutable object paths, checksum mismatch, and configured file-size rejection.
3. Add Instagram Reels and Threads video adapters. Verify API payloads, processing across worker runs, quota refusal, sanitized errors, and no retry after an uncertain write using controlled API responses.
4. Connect the shared job service to the UI, API, scheduler, and scoped MCP. Exclude Dober's explicit-approval accounts from automatic replies. Verify manual and worker concurrency, missing approval, changed content, reapproval after an uncertain write, automatic-reply exclusion, and independent destination results.
5. Add connection status and token refresh. Verify account mismatch, refresh failure preserving credentials, and no secrets in returned data or logs.
6. Run the app's unit tests, lint, type checks, production build, and local end-to-end flow. Submit implementation PRs with the migration and rollout instructions.

Rollout requires separate approval for production migrations, Storage configuration, credentials import, scheduler activation, and deployment. First verify signed-URL retrieval with a non-publication container test. Public live posting tests require a specific approved account and reviewed content. The request to build this feature does not authorize posting Dober's first video.

Acceptance is complete when a reviewed Dober draft can be sent through NexAuto to Instagram and Threads with an explicit instruction, with a separate verified result for each platform. Tests alone establish implementation readiness. A live, approved publication establishes operational readiness.

## Evidence

- Repository files in the current implementation table, inspected on 2026-10-09.
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), checked 2026-10-09.
- [Supabase private downloads and signed URLs](https://supabase.com/docs/guides/storage/serving/downloads), checked 2026-10-09.
- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), checked 2026-10-09.
- [Meta's Threads video-container example](https://www.postman.com/meta/threads/request/mev9xf8/1-3-create-video-container), checked 2026-10-09.
- [Instagram content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing), checked in the preceding Dober connection work on 2026-10-09.
- [KCP Dober publishing reference PR](https://github.com/null-n11o/01_kcp/pull/97). It is unmerged and has not published a video.
