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

Non-auth errors use `{error:{code,message,requestId}}` from errorSchema. Better Auth
owns its native error shapes; the browser never renders its raw HTML or arbitrary
provider messages. All HTTP responses have private, no-store and X-Request-Id.
State-changing requests require a trusted Origin. Health endpoints contain no URLs
or credentials. PORT is validated as an integer between 1 and 65535.

## Initial source and worker contract (not an implemented compiler)

`sourceSnapshotSchema`: UUID id/projectId, positive integer project revision,
relative POSIX mainFile, ISO createdAt, text files `{id,path,version,content,sha256}`,
and assets `{path,sha256,bytes}`. Hashes are lowercase SHA-256 hex. No absolute,
traversal, backslash, control-character, drive/colon, empty, or duplicate paths.
Files and assets together are limited to 50 entries / 8 MiB per project; text
files are <=256 KiB UTF-8; assets <=2 MiB. Snapshot mainFile must exist.

`updateFileSchema` freezes `{baseVersion,content}` for Part 1 optimistic writes.
The server will authorize project/file ownership and atomically compare/increment
the version. A conflict returns 409, never last-write-wins. Snapshots capture a
consistent project revision and immutable source/asset bytes in a transaction.
The server recomputes hashes; client hashes are claims, not proof.

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
