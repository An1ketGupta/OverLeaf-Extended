# Contracts, revisions, and ownership

packages/contracts/src/index.ts is the executable source of truth. Schemas are
strict. Shared source modules are consumed through workspace exports, not aliases.

## Implemented HTTP surface

| Request | Response |
| --- | --- |
| GET /api/health | 200 `{status:"ok",service:"overleaf-pro-api"}` |
| GET /api/ready | 200 `{status:"ready",database:"ready"}` or 503 with status `unavailable` and database `not-configured`/`unavailable` |
| GET /api/session | 200 `{user:{id,name,email},expiresAt}`; 401 without a session; 503 without a database |
| GET/POST /api/auth/* | Better Auth 1.7.12 wire protocol; email sign-in/sign-up, sign-out, and session check used by this prototype |
| GET /api/projects | Authenticated array of `{id,name,updatedAt}` (at most 100) |
| POST /api/projects | Strict `{name}` -> 201 project with initial text files |
| GET /api/projects/:id | Owned project `{id,name,mainFile,revision,updatedAt,files}` |
| POST /api/projects/:id/files | Strict `{path,content}` -> 201 refreshed owned project |
| PUT /api/projects/:id/files/:fileId | Strict `{baseVersion,content}` -> saved source file with incremented version/hash; 409 on a stale version |
| POST /api/projects/:id/snapshots | Strict `{baseRevision}` -> 201 immutable text snapshot; 409 if the project revision changed |
| GET /api/projects/:id/snapshots/:snapshotId | Owned immutable text snapshot; 404 for another owner's project or a mismatched project/snapshot pair |

Non-auth errors use `{error:{code,message,requestId}}` from errorSchema. Better Auth
owns its native error shapes; the browser never renders its raw HTML or arbitrary
provider messages. All HTTP responses have private, no-store and X-Request-Id.
State-changing requests require a trusted Origin. Health endpoints contain no URLs
or credentials. PORT is validated as an integer between 1 and 65535.

Part 2 adds the minimum text persistence prerequisite. The Part 3 prerequisite
adds immutable text snapshots; full Part 1 CRUD/assets/restore remains pending.
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

## Initial source and worker contract (not an implemented compiler)

`sourceSnapshotSchema`: UUID id/projectId, positive integer project revision,
relative POSIX mainFile, ISO createdAt, text files `{id,path,version,content,sha256}`,
and assets `{path,sha256,bytes}`. Hashes are lowercase SHA-256 hex. No absolute,
traversal, backslash, control-character, drive/colon, empty, or duplicate paths.
Files and assets together are limited to 50 entries / 8 MiB per project; text
files are <=256 KiB UTF-8; assets <=2 MiB. Snapshot mainFile must exist.

`updateFileSchema` freezes `{baseVersion,content}` for Part 1 optimistic writes.
The server authorizes project/file ownership and atomically compares/increments
the version. A conflict returns 409, never last-write-wins. Snapshots capture a
consistent project revision and immutable source/asset bytes in a transaction.
The server recomputes hashes; client hashes are claims, not proof.

### Implemented text snapshot capture and source export

`createSnapshotSchema` accepts only a positive `baseRevision`. No client source,
hashes, snapshot IDs, or timestamps are accepted. Capture locks the account and
parent project, checks its revision, and copies all files/main-file selection
while holding the same project lock used by file mutations. Hashes are recomputed
from stored UTF-8 text. Capture does not advance the project revision or file
versions. Concurrent requests for the same current revision return the same
snapshot. A stale base revision conflicts even if it was captured previously;
use the authenticated GET route to retrieve an older snapshot by its ID.

The `project_snapshot` table stores the independent file/version/hash/content
copy. A custom PostgreSQL UPDATE trigger enforces immutability; project/account
deletion cascades remain possible. There are no snapshot update/delete/list/restore
HTTP routes yet. Readiness requires the snapshot migration. Generated SQL,
Drizzle snapshot and journal travel together; the trigger is explicit custom SQL.

Retention is bounded at 20 captured revisions/project and 32 MiB of serialized
snapshot JSON/account (logical bytes including metadata, not physical PostgreSQL
disk usage). Checks serialize on the account row across its projects. A current
revision already captured is reusable at the limit; new capture returns 400 at
the limit, without pruning history. Source editing and individual draft downloads
still work. A retention management UI remains follow-on work.

`textSnapshotSchema` narrows the general source snapshot to `assets: []` until
asset persistence and byte transport are implemented. Duplicate file IDs and
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
and manifest overhead. Extract and compile from the source directory using an
appropriate external TeX setup until Part 0A approves an integrated compiler.

`compileRequestSchema`: `{type:"compile",requestId,snapshot}` or
`{type:"cancel",requestId}`. The runtime resolves assets only from that exact
snapshot's hashes/bytes; it must not fetch arbitrary URLs. Asset byte transport
and engine loading will be added only after the execution route is selected.

`compileEventSchema`: `state` events include requestId, loading/queued/running/
failed/timed-out/cancelled, and bounded diagnostics. `succeeded` events contain
requestId, snapshotId, revision, compilerBuildId, PDF Uint8Array (<=5 MiB),
pdfSha256, and diagnostics. Diagnostics have severity, bounded message, and
optional relative path/positive line. PDF bytes must be validated beyond this
transport schema by the eventual adapter. The worker transfers the byte buffer.

The UI accepts a preview only for its active request and revision. Cancellation
is a terminal state; worker termination/resource cleanup is mandatory. Timeout
is initially 15 seconds. Engine/browser memory measurements are not hard quotas.

There is no claim that an untrusted browser-generated PDF matches a source
snapshot. Saved analysis will bind to the exact analyzed PDF hash and rule version.
Schemas for proposals, storage, and resume findings will be frozen with their
implementations before the corresponding roadmap parts are integrated.
