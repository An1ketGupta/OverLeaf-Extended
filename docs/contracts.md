# Contracts, revisions, and ownership

## Part 1 lifecycle contract (2026-10-25)

Private project and assistance/report routes require a verified user as well as
an authenticated session. Existing unverified sessions cannot bypass this check.
The session DTO returns 401 until verification. Better Auth retains its native
wire shapes under `/api/auth`; account forms display only allowlisted messages.

| Request | Input / result |
| --- | --- |
| PUT /api/projects/:id | `{baseRevision,name}` -> updated project |
| DELETE /api/projects/:id | `{baseRevision}` -> 204; permanent cascade of files/assets/history/labels/proposals |
| POST /api/projects/:id/files/:fileId/rename | `{baseRevision,baseVersion,path}` -> updated project |
| DELETE /api/projects/:id/files/:fileId | `{baseRevision,baseVersion}` -> updated project, after preserving the saved tree |
| POST /api/projects/:id/assets/:assetId/rename | `{baseRevision,baseVersion,path}` -> updated project |

Source-file creation now requires `{baseRevision,path,content}`; project list
summaries now include `revision`. These intentional DTO changes update every
application/test caller. Other content-save and asset transport DTOs are unchanged.
All new inputs are strict schemas in packages/contracts.

Rename retains IDs and bytes/hashes, advances the entry version and project
revision, and updates mainFile atomically when renaming the main source. The main
source must retain a `.tex` suffix. Select another main file before deleting it.
Text and asset paths share a namespace; duplicates and directory collisions return
409, unsafe paths return 400. LaTeX references are not automatically rewritten.
Stale project/file tokens return 409; missing/foreign/mismatched resources return
404. Failed operations do not alter the source tree or history.

Source and asset deletion captures/reuses an immutable complete saved snapshot
under the account-then-project locks in the same transaction. A snapshot/quota
failure rolls back deletion. Deleted bytes remain in history until project deletion;
this is recovery, not erasure from retained snapshots. Project deletion uses the
same lock order, bypasses snapshot creation, and permanently removes its dependent
rows. Independently owned resume reports survive project deletion.

Auth enables Drizzle transactions, required verification, explicit sign-in after
verification and one-hour verification/reset expiry. Reset atomically consumes
its single-use token, revokes every session and changes the password. Failed
password validation or a database failure preserves a usable token; a failed
database transaction also restores sessions/password. Verification-link replay
is idempotent and creates no new session. Public production signup stays disabled.

The frontend uses POST `/api/auth/request-password-reset` with `{email,redirectTo}`,
POST `/api/auth/reset-password` with `{token,newPassword}`, and POST
`/api/auth/send-verification-email` with `{email,callbackURL}`. Better Auth verifies
GET verification/reset callbacks and trusted redirect origins. Request/resend
responses are generic; local SMTP errors do not vary replies by account existence.
Recovery pages remove reset tokens from the current history URL and use no-referrer.

Local delivery uses bounded in-process SMTP work to loopback Mailpit. It is not a
durable queue: restart/outage/full-capacity delivery can require resend. SMTP work
has connection/socket deadlines, at most 20 outstanding sends and shutdown drain.
No debug token endpoint or external email delivery is enabled. Logging redacts
reset-token paths as well as queries, and unexpected auth errors propagate to the
sanitized Fastify handler instead of the library's raw console fallback.

Process-local limits reset on restart. Without a trusted proxy IP, users share
per-path buckets: sign-in/signup 30/minute, reset requests 10/minute and verification
resend 5/minute. These do not verify hosted abuse protection or proxy behavior.

Workspace structural mutations pause typing/autosave, await current saves and
compare fresh server files/assets with acknowledged buffers. Dirty work survives
failure; discard is explicit and applied only after deletion succeeds. Metadata
changes invalidate compilation and late results. Content-free cross-tab signals
and focus/visibility/reconnect reads detect remote changes. Dirty buffers are not
silently refreshed; missing project/file drafts can be downloaded after refresh
by the same signed-in account. App navigation/Back offers save/download/stay/discard;
native refresh/close warnings and the existing 24-hour sessionStorage limits apply.

## Part 3 local integration contract (2026-10-24)

The compiler route is browser XeTeX/xdvipdfmx with pinned local assets, initially
validated on desktop Chromium/localhost. It executes no TeX on the API server.
Publishing compiler binaries/source has its own license/hosting checklist.

- POST /api/projects/:id/compile-input accepts {baseRevision}; an owned,
  transactionally consistent source/asset capture returns {kind:"ephemeral",
  captureId,snapshot}. The snapshot's ID is a capture identifier, never a retained
  history row. It consumes no history quota. Stale revision returns 409.
- POST /api/projects/:id/main-file accepts {baseRevision,path}; path must name
  an existing .tex source file. Changes advance the project revision.
- POST /api/projects/:id/assets accepts {baseRevision,path,dataBase64}; PUT
  /assets/:assetId accepts {baseRevision,baseVersion,dataBase64}; DELETE
  /assets/:assetId accepts {baseRevision,baseVersion}. They authorize ownership,
  validate canonical base64 and PNG/JPEG/PDF signatures, recompute hashes, enforce
  optimistic tokens and total project/account limits. Asset transport is bounded
  inline base64 (2 MiB decoded/file, 8 MiB whole project, 32 MiB live assets/account).
- Source snapshots embed immutable asset IDs, paths, versions, byte lengths,
  media types, SHA-256 and base64 bytes. Historical text snapshots have assets: [].
  Restore preserves both source and assets first, then replaces the entire tree
  transactionally with fresh live concurrency tokens. Source ZIPs include assets.
- Compiler results bind requestId, capture/snapshot identifier, project revision,
  compiler build and exact PDF hash. Ephemeral results use captureId/projectId
  and snapshotId: null. An ephemeral identifier cannot be fetched
  from history. Browser-generated hashes and relationships are not attestation.

All new HTTP operations inherit session/origin and private/no-store checks.
Only same-origin /api calls reach the API. Engine assets carry no credentials.

packages/contracts/src/index.ts is the executable source of truth. Schemas are
strict. Shared source modules are consumed through workspace exports, not aliases.

## Implemented HTTP surface

| Request | Response |
| --- | --- |
| GET /api/health | 200 `{status:"ok",service:"overleaf-pro-api"}` |
| GET /api/ready | 200 `{status:"ready",database:"ready"}` or 503 with status `unavailable` and database `not-configured`/`unavailable` |
| GET /api/session | 200 `{user:{id,name,email},expiresAt}`; 401 without a session; 503 without a database |
| GET/POST /api/auth/* | Better Auth 1.7.12 wire protocol; email sign-in/sign-up, sign-out, and session check used by this prototype |
| GET /api/projects | Authenticated array of `{id,name,revision,updatedAt}` (at most 100) |
| POST /api/projects | Strict `{name,templateId?}` -> 201 independent project; templateId is resume-classic/resume-compact/report |
| GET /api/projects/:id | Owned project `{id,name,mainFile,revision,updatedAt,files}` |
| POST /api/projects/:id/files | Strict `{baseRevision,path,content}` -> 201 refreshed owned project |
| PUT /api/projects/:id/files/:fileId | Strict `{baseVersion,content}` -> saved source file with incremented version/hash; 409 on a stale version |
| POST /api/projects/:id/snapshots | Strict `{baseRevision,name?}` -> 201 immutable text snapshot; optional trimmed 1-100 character name without controls; 409 if the revision/name conflicts |
| GET /api/projects/:id/snapshots/:snapshotId | Owned immutable text snapshot; 404 for another owner's project or a mismatched project/snapshot pair |
| GET /api/projects/:id/snapshots | Owned summaries `{id,revision,createdAt,name}` newest first, at most 20; name is nullable |
| POST /api/projects/:id/snapshots/:snapshotId/restore | Strict `{baseRevision}` -> restored project; 409 when changed since comparison; 400 if a safety snapshot cannot fit in retention |

Non-auth errors use `{error:{code,message,requestId}}` from errorSchema. Better Auth
owns its native error shapes; the browser never renders its raw HTML or arbitrary
provider messages. All HTTP responses have private, no-store and X-Request-Id.
State-changing requests require a trusted Origin. Health endpoints contain no URLs
or credentials. PORT is validated as an integer between 1 and 65535.

Part 2 adds the minimum text persistence prerequisite. The Part 3 prerequisite
adds immutable text snapshots; Part 4 adds named/listed snapshots and transactional
restore. Part 3 added assets; the lifecycle contract above completes local Part 1 CRUD.
Project/file/snapshot IDs are UUIDs. Every read/write authorizes the current
session and owner; another owner's ID returns 404. Names are trimmed 1–100
characters without controls. Projects contain the existing strict source-file
shape, unique IDs/paths and an existing main file. Account limit is 100 projects;
file/project limits below also apply transactionally to writes. Content must
round-trip as Unicode and contain no null bytes. JSON request bytes may exceed
decoded text bytes through escaping; project file routes allow bounded overhead.
The server hashes every accepted write. Versions are concurrency tokens, not
hashes. No project hash supplied by a browser is trusted.

`localDraftSchema` is a browser recovery record: `{userId,projectId,fileId,
baseVersion,content,savedAt}` with bounded content, UUID project/file IDs and a
positive millisecond timestamp. It confers no server authority. See part-2.md for
account isolation, expiry, explicit recovery and logout deletion.

## Source and worker contract

`sourceSnapshotSchema`: UUID id/projectId, positive integer project revision,
relative POSIX mainFile, ISO createdAt, text files `{id,path,version,content,sha256}`,
and assets `{id,path,version,mediaType,sha256,bytes,dataBase64}`. Hashes are lowercase SHA-256 hex. No absolute,
traversal, backslash, control-character, drive/colon, empty, or duplicate paths.
Files and assets together are limited to 50 entries / 8 MiB per project; text
files are <=256 KiB UTF-8; assets <=2 MiB. Snapshot mainFile must exist.

`updateFileSchema` freezes `{baseVersion,content}` for Part 1 optimistic writes.
The server authorizes project/file ownership and atomically compares/increments
the version. A conflict returns 409, never last-write-wins. Snapshots capture a
consistent project revision and immutable source/asset bytes in a transaction.
The server recomputes hashes; client hashes are claims, not proof.

### Implemented text snapshot capture and source export

`createSnapshotSchema` accepts a positive `baseRevision` and optional bounded `name`. No client source,
hashes, snapshot IDs, or timestamps are accepted. Capture locks the account and
parent project, checks its revision, and copies all files/main-file selection
while holding the same project lock used by file mutations. Hashes are recomputed
from stored UTF-8 text. Capture does not advance the project revision or file
versions. Concurrent requests for the same current revision return the same
snapshot. A stale base revision conflicts even if it was captured previously;
use the authenticated GET route to retrieve an older snapshot by its ID.
A name can be assigned on first capture or to a previously unnamed current
revision. Identical retries reuse it; changing an assigned name returns 409.
Name assignment never updates the immutable source row.

The `project_snapshot` table stores the independent file/version/hash/content
copy. A custom PostgreSQL UPDATE trigger enforces immutability; project/account
deletion cascades remain possible. There are no snapshot source update/delete HTTP routes. Part 4 adds list/restore
routes and a separate snapshot_name table for immutable-once-assigned labels. Readiness requires the snapshot migration. Generated SQL,
Drizzle snapshot and journal travel together; the trigger is explicit custom SQL.

Retention is bounded at 20 captured revisions/project and 32 MiB of serialized
snapshot JSON/account (logical bytes including metadata, not physical PostgreSQL
disk usage). Checks serialize on the account row across its projects. A current
revision already captured is reusable at the limit; new capture returns 400 at
the limit, without pruning history. Source editing and individual draft downloads
still work. A retention management UI remains follow-on work.

Restore authorizes both project and snapshot, locks the account then project,
compares baseRevision, and captures the entire current tree before replacing it
in the same transaction. A backup/quota failure rolls back every change. Paths
present in both trees retain the live file ID and increment the live version;
missing paths get fresh IDs/version 1, never historical concurrency tokens. Files
absent from the snapshot are removed. Main-file selection is restored and project
revision advances once. Hashes are recomputed. Old snapshots remain unchanged.
The returned project is read within that transaction. Concurrent saves/restores
serialize on the project lock and fail on stale versions/revisions. Repeating a
successful restore with its old baseRevision conflicts; after a lost response,
reload to inspect the actual saved revision before retrying.

The history dialog prevents editor typing while comparing/restoring. Comparison
saves all buffers, checks them against a fresh project read, and pins that
revision for restore. It renders added/removed/changed text with a linear,
shared-prefix/suffix diff (one possibly nonminimal block per file). The browser
reloads on success. Restores now cover text and full asset bytes.
Labels are separate bounded metadata: at most 20 names of 100 characters/project.

`textSnapshotSchema` remains a legacy text-only helper narrowed to `assets: []`.
The product uses sourceSnapshotSchema with full inline assets. Duplicate file IDs and
file/directory path conflicts are rejected in addition to the existing bounds.

Export project saves all recoverable editor buffers, checks the full saved file
set against a fresh project read, then captures that exact revision. Conflicts,
unresolved recovery, failed saves and unseen remote changes stop export. Later
typing can continue; the downloaded ZIP contains the captured saved revision.
Navigation/logout suppress late downloads. Browser SHA-256 checks catch accidental
corruption; they do not attest that a PDF was compiled from these bytes.

The ZIP contains UTF-8 text at `source/<path>` and `snapshot.json` outside that
tree, with format `overleaf-pro-source-v1`, snapshot/project IDs, revision, creation
time, prefixed main-file path, and file ID/path/version/hash entries. No document
text is duplicated in the manifest. ZIP uses pinned fflate 0.8.3 with stored
entries (no compression), bounded by the existing project input limits plus ZIP
and manifest overhead. Assets appear at source/<path> with their metadata/hash in
the manifest; base64 data is not duplicated there. Extract and compile from source/
using the selected local engine's supported package subset or an external TeX setup.

`compileRequestSchema`: `{type:"compile",requestId,snapshot}` or
`{type:"cancel",requestId}`. The runtime resolves assets only from that exact
snapshot's hashes/bytes; it must not fetch arbitrary URLs. The selected adapter
uses compileInputSchema for non-retained captures and the bounded internal runtime
transport for a fresh worker. Captures are limited to 16 MiB encoded JSON.

`compileEventSchema`: `state` events include requestId, loading/queued/running/
failed/timed-out/cancelled, and bounded diagnostics. `succeeded` events contain
requestId, captureId, projectId, nullable snapshotId, revision, compilerBuildId, PDF Uint8Array (<=5 MiB),
pdfSha256, and diagnostics. Diagnostics have severity, bounded message, and
optional relative path/positive line. PDF bytes must be validated beyond this
transport schema by the adapter. The worker transfers the byte buffer; PDF.js
parses a copy so the downloadable bytes are not detached.

The UI accepts a preview only for its active request and revision. Cancellation
is a terminal state; worker termination/resource cleanup is mandatory. Timeout
is initially 15 seconds. Engine/browser memory measurements are not hard quotas.

There is no claim that an untrusted browser-generated PDF matches a source
snapshot. Saved analysis will bind to the exact analyzed PDF hash and rule version.
Schemas for proposals, storage, and resume findings will be frozen with their
implementations before the corresponding roadmap parts are integrated.

## Parts 5/6 implemented contracts

`packages/contracts/src/assistance.ts` freezes strict proposal, PDF extraction,
normalized requirement and report schemas. All routes below use the existing
session, origin, private/no-store and content-free error envelope boundaries.

| Request | Response |
| --- | --- |
| POST /api/ai-proposals | `{requestId,projectId,baseRevision,mode,instruction,fileIds,selection?,diagnostics,shareWithProvider:true}` → 201 proposal; identical request-ID replay → 200 existing proposal |
| GET /api/ai-proposals | At most 50 owned proposal records |
| GET /api/ai-proposals/:id | Owned proposal; pending longer than 30 seconds becomes expired |
| POST /api/ai-proposals/:id/apply | Empty object → atomic accepted proposal result with backupSnapshotId/appliedRevision; stale revision/version → 409 |
| POST /api/ai-proposals/:id/reject | Empty object → rejected proposal; never applies source |
| DELETE /api/ai-proposals/:id | 204; owned context/output removed, safety snapshots retained |
| POST /api/resume-analyses | `{extraction,requirements}` → 201 saved report; server recomputes every finding |
| GET /api/resume-analyses | At most 20 owned `{id,createdAt}` summaries |
| GET /api/resume-analyses/:id | Owned immutable input/report with `attestation:"client-provided-extraction"` |
| DELETE /api/resume-analyses/:id | 204; 404 for another owner/missing ID |

Proposal modes are explain/rewrite/generate/question/diagnostic. Context comes
from owned saved files in the requested revision; client content/hashes/versions
cannot replace that context. At most four unique file IDs, 24,000 bytes/file and
48,000 bytes serialized context; instructions ≤2,000 and diagnostics ≤4,000
characters. A selection supplies fileId/from/to using UTF-16 editor offsets and
must be nonempty inside a selected saved file. These bounds reject requests
instead of silently truncating relevant source.

Provider output is `{answer,refused,edits:[{fileId,content}]}`. Replacements are
bounded valid Unicode without null bytes; only selected files are editable.
The server retains the base revision and file versions. No edit list is accepted
from an apply caller. All edits are accepted/rejected as a coherent group; apply
checks the full project revision, snapshots current source and advances live
versions in one transaction. Repeating successful apply returns its stored
result. Restoring uses the existing snapshot route and exact baseRevision; the
assistant's quick restore checks appliedRevision, while History supports deliberate
comparison of later work. No hash supplied by a client is concurrency authority.

Proposal states: pending/ready/refused/failed/expired/rejected/applied. Results
record prompt version `latex-assistant-v1`, model, optional input/output token
counts, creation time, and optional apply metadata. Request fingerprint conflicts
return 409. Deletion prevents late completion from recreating a record; account
and project deletion cascade. There is no promise that a provider did not process
a request after a lost response. Storage reservation and process caps are in
part-5.md. No provider/DB error body is exposed or logged.

PDF extraction contains the SHA-256 of actual selected PDF bytes, byte/page
counts, extractionVersion `pdfjs-6.4.299-lines-v1`, and lines with page/line/text
and normalized x/y. Limits are 5 MiB/20 pages/20,000 lines/100,000 characters;
each line is ≤2,000 characters, within the declared pages, with a unique page/line
identity. The worker also bounds parser text items and its execution time.
Requirements are up to thirty trimmed terms/phrases of ≤120 characters and kind
required/preferred; duplicates within a kind are rejected. The server does not
accept client findings, compatibility scores, timestamps or report IDs on save.

Saved report findings/evidence come from the provided extraction and
`resume-rules-v1`, recomputed by shared deterministic rules. Each finding records
detected/not-detected/unknown, weight, nullable contribution and evidence. Job
matches separately record evidence-found/not-found/unknown with requirement kind.
Unsupported extraction yields null estimate and unknown checks. Required/preferred
coverage is not an employer's ATS score or semantic qualification verification.

PDF bytes are not stored or sent to these routes. Extracted text and requirements
are private user data. A client can fabricate every extraction/hash field, so
the stored report explicitly discloses that limitation and proves no source/PDF
relationship. Reopening beside a local PDF checks its exact byte hash. No compiler
snapshot relationship or model/prompt version for AI requirement extraction is
asserted. Saved reports do not change when local analysis is rerun. See part-6.md
for evidence, rubric and retention limitations.
