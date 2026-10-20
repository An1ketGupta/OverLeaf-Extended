# Part 0 progress — 2026-10-20

**In progress.** The local foundation and authentication prototype work. Compiler
feasibility and account-dependent hosting checks remain open. Parts 1-9 are not
started and no compiler route is approved.

## Implemented

- pnpm workspaces for React/Vite/React Router, Fastify, contracts, and PostgreSQL.
  Node 24.22.0 / pnpm 10.34.7 pins, exact stable dependency versions, frozen lockfile,
  strict TypeScript, Biome, Vitest, Playwright, and a GitHub Actions workflow.
- Live frontend readiness page and a real Better Auth/Drizzle auth check page,
  same-origin local API proxy, trusted-origin validation, separate Set-Cookie and
  renewal forwarding, private no-store responses, and production Secure cookies.
- Fastify health and database readiness, bounded pool/requests, runtime validation,
  Render PORT/0.0.0.0 support, graceful shutdown, and credential-safe error reporting.
- Auth-table schema/migration and idempotent metadata seed. Independent development
  and test database setup. Integration fails explicitly without TEST_DATABASE_URL.
- Product flows, architecture, initial exact DTOs/worker transport, immutable
  snapshot/version semantics, request/input limits, native/Docker setup options,
  Free deployment templates, and staging acceptance instructions.
- Three original synthetic compiler fixtures (two resumes and a report), with
  package/font/image requirements and a comparison protocol. No fake PDFs or
  mock engine are presented as real compilation.

## Verification actually run

All checks below ran locally on Windows using the pinned Node/pnpm. The system
Node 26 was not used for application verification. Local native PostgreSQL 17.10
ran on loopback port 55432 with separate overleaf_pro and overleaf_pro_test databases.
Its test-only binaries were kept in ignored .cache; they are not product dependencies.

| Command/check | Outcome |
| --- | --- |
| pnpm install / install --frozen-lockfile | Workspace dependencies resolved and lockfile installed |
| pnpm lint | Passed |
| pnpm typecheck | Passed (root, API, frontend, database, contracts) |
| pnpm test | 15 tests passed: unsafe paths, UTF-8 sizes, snapshot ambiguity, database separation, production config, API/origin boundaries, and database failure |
| pnpm db:migrate / db:seed | Applied real PostgreSQL migration; seeded metadata |
| pnpm test:integration | Passed real migration idempotence, signup/signin, session restoration/renewal, multiple Set-Cookie preservation, logout invalidation, origin rejection, private no-store, production Secure/host-only cookies |
| pnpm test:e2e with separate test database | 2 Chromium tests passed: proxy/readiness/navigation/mobile layout and actual account signup/refresh/signout/signin |
| pnpm build | Passed API/shared type checks and Vite static production build |
| Desktop/mobile screenshots | Inspected; no horizontal overflow at 390 px |
| pnpm check:environment | Correct runtime; Docker daemon, PATH psql, pdflatex, and xelatex unavailable |

The local PostgreSQL engine was tested directly using the application driver; a
PATH psql executable was not needed. The Docker configuration and GitHub-hosted
workflow have been written but not executed here. Actual deployment behavior is
not inferred from the local auth test or the CI file.

## Open gates

| Gate | State / what resolves it |
| --- | --- |
| 0A server/browser compiler comparison | Open. Neither candidate has measured template compatibility, pinned engine/package assets with notices, delivery/capacity measurements, or proven isolation. Follow compiler-feasibility.md. No engine is selected. |
| 0B Vercel-to-Render auth | Local prototype passed. Actual staging hostnames/account access, cookie forwarding/renewal, CDN isolation, and cold-start behavior remain pending. Follow auth-staging-checklist.md. |
| Neon Free signup/connection | Not configured or validated. Use the user's eligible Free account and separate branches; do not substitute a trial/paid/card-required service. |
| Free host eligibility/quotas | Not established for the user's accounts. Deployment templates provision nothing. |
| Public account lifecycle | Part 1: verification/reset delivery and public registration remain disabled pending implementation. |
| Independent review | Pending. This implementation was checked by the implementing agent; no separate reviewer/subagent was invoked. |

[Neon's published Free plan](https://neon.com/pricing) states no payment card or
time limit, with quotas. That is plan documentation, not proof that signup and a
real hosted database connection have succeeded for this user.

## Handoff

Start the foundation with README.md. Freeze/extend contracts with each next
implementation, keeping migrations in packages/db. Complete the compiler and
hosting gates before accepting dependent compiler or hosted-auth integrations.
Use the synthetic fixtures; no public arbitrary TeX execution has been enabled.
No external service, account, paid resource, or deployment was created.
