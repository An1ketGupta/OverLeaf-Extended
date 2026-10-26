# Foundation architecture

Current scope is a personal project tested on localhost (user clarification,
2026-10-24). The earlier commercial assessment in commercial-use.md is historical.
No host is selected. Local compiler acceptance is separate from future hosting,
authentication and redistribution checks. The web/API/database boundaries remain.

Part 3 uses pinned browser XeTeX/xdvipdfmx in a fresh worker with no network or
storage host API after bootstrap. The adapter fetches verified engine code and
8 MiB asset shards without credentials, passes engine code/compiled WASM/package
bytes into the worker, and supplies only one immutable source/asset capture.
Worker bootstrap verifies the engine JS hash before loading a temporary Blob;
the dev/preview servers set worker-specific CSP that denies network connections.
Each job has a 15-second deadline, at most three passes, bounded auxiliary files,
5 MiB PDF/20-page preview limits and termination on cancel/navigation/logout.
Engine loading has a separate 30-second deadline. No TeX executes on the API.

The project_asset table stores bounded bytea data with optimistic versions.
Immutable snapshots copy asset bytes as bounded base64 JSON; restore backs up
the complete tree transactionally. The compile-input API captures the exact
project revision under its lock without storing a history row. Its capture ID
is separate from persisted snapshot IDs. Only local PDF files/results are kept;
optional report saving still binds actual analyzed hashes with client-provided
provenance. The source ZIP includes image bytes and an asset hash manifest.

Node 24.22.0 and pnpm 10.34.7 are pinned. Stable package versions are exact and the
workspace lockfile is committed. React/Vite/React Router live in apps/web;
Fastify/Better Auth live in apps/api; contracts and database code are separate
workspace packages. No AI, compiler, or storage package is empty scaffolding.

The API runs TypeScript through its pinned tsx production dependency. Its build
checks types; the frontend build emits apps/web/dist. This deliberately small
native deployment keeps shared TypeScript package exports consistent. A future
bundling change must preserve the server/browser boundary and migration paths.

```text
Browser -> /api/* -> Vite proxy locally / validated same-origin proxy when hosted
                         -> Local Node API (future hosting separate) -> PostgreSQL
                         -> Better Auth + Drizzle adapter
```

Public origin is APP_ORIGIN (frontend), with an exact TRUSTED_ORIGINS list. No
wildcards, client Host headers, or arbitrary Forwarded headers construct auth URLs.
Mutations require a trusted Origin. CORS is unnecessary for same-origin requests.
Production requires HTTPS origins, a database, and a non-placeholder secret.
All API responses carry private, no-store. Multiple Set-Cookie headers, including
session renewal, are forwarded individually. Cookies are HttpOnly, SameSite=Lax,
host-only, and Secure in production; there are no browser-local bearer tokens.

Auth rate limits use an in-memory, per-process store. They reset on restart.
Fastify does not trust forwarded client IPs. Until the deployed proxy chain is
verified, Better Auth may share a per-path rate-limit bucket for unknown clients.
Do not accept untrusted forwarding headers simply to remove that limitation.
Public signup is disabled by default and prohibited in production pending hosted
delivery validation. Part 1 supplies local verification/reset through a loopback
Mailpit inbox and server-only SMTP adapter. Auth transactions atomically consume
reset tokens, revoke sessions and write passwords; private routes reject legacy
unverified sessions. All callback paths/queries and raw adapter errors are kept out
of logs. Email send acceptance is process-local and bounded, not durable delivery.
See part-1.md for lifecycle behavior and dependency obligations.

The database pool has three connections, bounded connection/query/statement timeouts,
and an idle-socket error listener. `/api/health` reports process liveness;
`/api/ready` checks access to migrated auth tables and returns 503 when unavailable.
An idle database failure does not crash the API. Readiness also probes project and
file tables. Private project source persists in PostgreSQL; bounded text writes
lock their parent project, validate quotas and compare optimistic versions.
There is no Redis, paid worker, or compile endpoint. Optional bounded server-only
Groq calls are implemented for Part 5; they are disabled by default.

Immutable text snapshot capture/read and browser ZIP export now provide the
source prerequisite for Part 3. Account/project locks serialize quota checks and
source capture against writes. PostgreSQL rejects snapshot updates; source edits
cannot change a captured revision. See contracts.md for retention bounds and ZIP
format, and part-3.md for the compiler gate that remains open.

The Part 2 browser workspace imports only public contracts and browser libraries.
CodeMirror loads with the workspace; PDF.js and its packaged worker load only for
local PDF previews. Unsaved source recovery uses account-scoped sessionStorage,
with logout broadcasts and a content-free localStorage invalidation marker.
See part-2.md for the draft lifecycle and part-3.md for the selected local compiler adapter.

## Deployment templates

infra/render.yaml describes one Free native Node staging candidate, with PORT supplied by
Render and HOST=0.0.0.0. Apply migrations manually using a direct database URL
before checking readiness. The free template does not rely on paid pre-deploy jobs.
No deployment was performed. Docker remains an option for future compiler research.

The legacy Vercel example assumes Root Directory `apps/web`, Node 24, and access to
workspace files outside that directory. Copy infra/vercel.example.json to
apps/web/vercel.json and replace the backend hostname before deployment. Its API
rewrite precedes the SPA fallback and preserves the `/api` path. APP_ORIGIN on
Render must be the final Vercel/custom frontend origin. Preview deployments need
explicit origins; do not trust every vercel.app site. No secrets belong in the
static frontend. This example is not authorization to use Vercel Hobby for the
commercial project. A replacement frontend must pass the same cookie forwarding,
cache, origin and routing checks.

Actual HTTPS cookie forwarding, CDN caching, service wake-up, and timeout behavior
remain staging checks. Local proxy tests cannot establish them. The proposed hosts
and quotas must be checked in the user's accounts before publishing.

Part 4 adds original MIT-licensed template source in templates/, copied by the
server into independent private project/file records with fresh IDs. A separate
snapshot_name table labels immutable revisions without modifying their source.
List and transactional restore routes authorize ownership; restore preserves the
current revision under the account/project locks and advances live versions.
See part-4.md and contracts.md for retention, stale-restore and browser reload
semantics. Runtime packaging must retain templates/ at the repository root.
Catalog template compatibility is verified with the selected local engine. No
template PDFs or third-party compiler binaries are committed.

The Part 0A runner in scripts/compiler-feasibility.ts accepts fixed synthetic
repository fixtures and binds an ephemeral loopback port. It shares the authored
scripts/compiler/worker.js runtime with the app; preparation copies that runtime
and pinned engine/package bytes into ignored local public assets. The selected
local route is integrated in browser-compiler.ts/useCompilation.ts. Future public
redistribution, actual hosted delivery and broader devices still need validation.

Parts 5/6 add private proposal/report routes. The API owns provider requests;
packages/db owns proposal/report persistence, snapshot-before-apply transactions,
and migration 0004. The browser imports only public contracts and packages/resume
deterministic rules. PDF extraction runs in a dedicated worker with a child PDF.js
parser port, deadlines and termination. PDF bytes remain local; optionally saved
reports contain bounded client-provided extraction and exact hash claims, never
compiler attestation. See part-5.md and part-6.md for limits and remaining gates.
