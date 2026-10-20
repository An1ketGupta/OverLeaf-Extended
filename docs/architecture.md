# Foundation architecture

Commercial use is confirmed. See commercial-use.md: Vercel Hobby is excluded,
Render Free is a staging candidate, and launch hosts remain unselected. The
framework/database boundaries below remain valid; the old Vercel-specific routing
example is historical and must be replaced or explicitly revalidated on an
eligible plan before deployment.

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
                         -> Node API (commercial launch host pending) -> PostgreSQL
                         -> Better Auth + Drizzle adapter
```

Public origin is APP_ORIGIN (frontend), with an exact TRUSTED_ORIGINS list. No
wildcards, client Host headers, or arbitrary Forwarded headers construct auth URLs.
Mutations require a trusted Origin. CORS is unnecessary for same-origin requests.
Production requires HTTPS origins, a database, and a non-placeholder secret.
All API responses carry private, no-store. Multiple Set-Cookie headers, including
session renewal, are forwarded individually. Cookies are HttpOnly, SameSite=Lax,
host-only, and Secure in production; there are no browser-local bearer tokens.

Auth rate limits use an in-memory, per-instance store. They reset on restart.
Fastify does not trust forwarded client IPs. Until the deployed proxy chain is
verified, Better Auth may share a per-path rate-limit bucket for unknown clients.
Do not accept untrusted forwarding headers simply to remove that limitation.
Public signup is disabled by default and prohibited in production in this prototype.
Email verification/reset delivery, account lifecycle, and authorization are Part 1.

The database pool has three connections, bounded connection/query/statement timeouts,
and an idle-socket error listener. `/api/health` reports process liveness;
`/api/ready` checks access to migrated auth tables and returns 503 when unavailable.
An idle database failure does not crash the API. Readiness also probes project and
file tables. Private project source persists in PostgreSQL; bounded text writes
lock their parent project, validate quotas and compare optimistic versions.
There is no Redis, paid worker, AI call, or compile endpoint.

Immutable text snapshot capture/read and browser ZIP export now provide the
source prerequisite for Part 3. Account/project locks serialize quota checks and
source capture against writes. PostgreSQL rejects snapshot updates; source edits
cannot change a captured revision. See contracts.md for retention bounds and ZIP
format, and part-3.md for the compiler gate that remains open.

The Part 2 browser workspace imports only public contracts and browser libraries.
CodeMirror loads with the workspace; PDF.js and its packaged worker load only for
local PDF previews. Unsaved source recovery uses account-scoped sessionStorage,
with logout broadcasts and a content-free localStorage invalidation marker.
See part-2.md for the draft lifecycle and the unavailable typed compiler adapter.

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
