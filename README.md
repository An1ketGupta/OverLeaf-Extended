# OverLeaf-Pro

**Commercial product.** The free/no-card/no-subscription constraint still applies.
Vercel Hobby is excluded; Render Free is a staging candidate, not an approved
production backend. Commercial launch hosting is an open Part 0 decision. Read
[commercial-use guidance](docs/commercial-use.md) before creating hosting accounts
or following the older Vercel deployment example.

A LaTeX workspace with planned AI editing and explainable resume PDF analysis.
**Part 2's local workspace is implemented.** It includes CodeMirror LaTeX editing,
private PostgreSQL-backed projects, autosave/conflict recovery, resizable panels,
and a local PDF.js preview. Compiler selection, Neon account eligibility, hosted
authentication, and the remaining Part 1 features stay open. See
[Part 2 progress](docs/part-2.md), [Part 0 progress](docs/part-0.md), and
[the roadmap](ROADMAP.md).

## Start locally

Use **Node 24.22.0** (`.node-version` / `.nvmrc`) and **pnpm 10.34.7**. The package
manager and engine checks deliberately reject incompatible runtimes. With a Node
version manager, install/select that Node version, then install pnpm if needed:

```sh
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env` at the repository root (PowerShell: `Copy-Item
.env.example .env`). Replace AUTH_SECRET with a random value, generated for example
with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

```sh
pnpm dev
```

Open http://localhost:5173. The web app reaches http://127.0.0.1:3001 via `/api`.
Without DATABASE_URL, health succeeds and database readiness/auth return a clear
503. The frontend reports the database as not configured. No AI keys are needed.
`pnpm dev:web` and `pnpm dev:api` start either service separately.

## PostgreSQL setup

Use native PostgreSQL 17 or an eligible Neon Free database. For native PostgreSQL,
create two independent databases using the installed client tools:

```sh
createdb -U postgres overleaf_pro
createdb -U postgres overleaf_pro_test
```

Set DATABASE_URL and TEST_DATABASE_URL in `.env` to their corresponding connection
strings (examples are in `.env.example`). For Neon, use separate development/test
branches and its supplied TLS options. Set DATABASE_MIGRATION_URL when a direct
connection is required for migration. Never use production data as test data.

```sh
pnpm db:migrate
pnpm db:seed
```

Migrations are checked-in Drizzle SQL. Seed is idempotent foundation metadata; it
does not create users or a shared password. `pnpm db:generate` generates reviewed
migrations after a schema change. Readiness verifies migrated auth tables.

Docker is optional: `docker compose -f infra/compose.yaml up -d` starts a local
database when an engine is available. Then create the test database with
`docker compose -f infra/compose.yaml exec postgres createdb -U postgres overleaf_pro_test`.
Use the documented native/Neon path if Docker is unavailable.

To exercise `/auth-check`, set `AUTH_ALLOW_SIGNUP=true` for development, restart
the API, and create a synthetic test account with a password of at least 12
characters. Sign in, refresh, and sign out through the frontend. Public production
signup is deliberately disabled until Part 1 supplies account/email flows.

After signing in, open `/projects` to create a private project and enter the
workspace. Apply all migrations first. Text autosaves after 700 ms; saves complete
before file switches. Offline drafts can be recovered after refresh in the same
tab. Sign-out deletes recovery copies; download unsaved work before signing out.
Open PDF previews a local file and never represents it as compiled output.
Recompile remains disabled until compiler validation. See docs/part-2.md for
shortcuts, draft privacy, limits, and remaining prerequisites.

**Export project (.zip)** saves all files and captures an immutable text snapshot
before downloading the full source tree and a version/hash manifest. Conflicts
and unseen remote changes require review first. **Download file** keeps a copy of
the current editor buffer, including unsaved text. Apply the new snapshot migration
with `pnpm db:migrate` before exporting. Snapshots are capped at 20 revisions per
project and 32 MiB of logical JSON per account; at the limit, individual downloads
remain available. [Part 3 progress](docs/part-3.md) records the delivered prerequisite
and the compiler gate that still blocks real compilation.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm check:environment
```

Integration tests require a separate TEST_DATABASE_URL and fail explicitly if it
is missing. They apply migrations twice, create one random synthetic account,
verify auth/cookies/origin protection, and remove only that account. They never
reset a configured database. E2E uses the separate test database when configured
and cleans up its synthetic account. Without it, E2E runs the UI/proxy smoke test
and explicitly skips the real-account test. Playwright loads the root `.env`;
stop dev servers on ports 3001/5173 before running E2E.

CI installs from the frozen lockfile and runs lint, types, unit tests, real
PostgreSQL integration, build, and Chromium E2E. Browser traces/screenshots are
stored under ignored test-results. Local verification results and remaining gates
are recorded in docs/part-0.md; a CI workflow file is not a completed hosted CI run.

## Layout and deployment

- `apps/web`: React/Vite editor, projects, PDF preview, status/auth; only public code.
- `apps/api`: Fastify health/readiness/auth, private project/file HTTP routes.
- `packages/contracts`: strict HTTP/source/worker DTOs and limits.
- `packages/db`: PostgreSQL connection, Better Auth tables, Drizzle migrations.
- `docs`: product flows, architecture, contracts, compiler and staging gates.
- `infra`: Free Render/native, Vercel routing, optional local PostgreSQL templates.

Read [architecture](docs/architecture.md) before filling deployment templates.
Nothing has been provisioned or published. The former Vercel Hobby/Render Free
launch proposal is superseded by the commercial-use clarification. No complete
commercial hosting stack is selected. Published Free plans do not verify account
eligibility, commercial permission or production suitability; validate these
before deployment while retaining the no-card budget.
