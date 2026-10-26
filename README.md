# OverLeaf-Pro

**Personal project, tested on localhost.** This is the user's current scope as of
2026-10-24. Keep hosting free with no card, subscription or expiring trial. No host
is selected or deployed. Earlier commercial hosting assessments are historical;
publication needs its own host and compiler redistribution review.

A LaTeX workspace with reviewable AI editing and explainable resume PDF analysis.
**Part 2's local workspace is implemented.** It includes CodeMirror LaTeX editing,
private PostgreSQL-backed projects, autosave/conflict recovery, resizable panels,
and a local PDF.js preview. Original template copies and recoverable text history
are also implemented; see [Part 4 progress](docs/part-4.md). **Part 0A's local route
and Part 3 compilation/PDF export are implemented:** pinned browser XeTeX/xdvipdfmx,
image assets, main-file selection, diagnostics, cancel/timeout, stale PDF handling,
source ZIPs and generated-PDF analysis. Initial compiler support is desktop Chromium.
**Part 1 accounts and project/file management are implemented locally:** email
verification/reset, rename/delete with draft protection, recoverable file deletion,
account isolation and cross-tab conflict handling. See [Part 1](docs/part-1.md).
Neon eligibility and hosted authentication/delivery remain open. See
[Part 2 progress](docs/part-2.md), [Part 0 progress](docs/part-0.md), and
[the roadmap](ROADMAP.md).

**Parts 5/6 independent flows are implemented:** the workspace AI assistant can
request explanations/edits, show diffs, atomically apply changes and restore a
safety snapshot. `/resume` analyzes actual uploaded PDF bytes locally, shows
text evidence and required/preferred job-term coverage, and optionally saves
private reports. Generated PDFs now feed this exact-byte analysis flow, and
compiler diagnostics can be shared with the assistant through its consent flow.
Live provider validation remains open. See [Part 5](docs/part-5.md) and [Part 6](docs/part-6.md).

## Start locally

Use **Node 24.22.0** (`.node-version` / `.nvmrc`) and **pnpm 10.34.7**. The package
manager and engine checks deliberately reject incompatible runtimes. With a Node
version manager, install/select that Node version, then install pnpm if needed:

```sh
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile
pnpm compiler:prepare
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

For local accounts, set `AUTH_ALLOW_SIGNUP=true` and `MAIL_ENABLED=true`, then
restart the API. Run `pnpm mail:start` in another terminal and open `/account`
(`/auth-check` also works). Create an account with a password of at least 12
characters, open the verification message at http://127.0.0.1:8025, follow its
link, then sign in. Existing unverified accounts use **Send verification email**.
**Forgot password?** sends a reset link to the same local inbox. Reset revokes all
old sessions; signing back in as the same account can recover this tab's drafts.
Links expire in one hour. Mail stays local; no provider account is needed.
Public production registration and real mailbox delivery remain separate gates.

After signing in, open `/projects` to create a private project and enter the
workspace. Apply all migrations first. Text autosaves after 700 ms; saves complete
before file switches. Offline drafts can be recovered after refresh in the same
tab. Sign-out deletes recovery copies; download unsaved work before signing out.
Use project/file **Rename** and **Delete** controls to manage your tree. File/image
deletion first preserves a saved snapshot; restore through **History**. Choose
another main file before deleting it. Project deletion is permanent, requires its
name as confirmation and removes source/assets/history/proposals; saved resume
reports remain. Unsaved work must be saved or explicitly discarded. Another tab's
remote deletion preserves its already-held draft for download/recovery.
Open PDF previews a local file and never represents it as compiled output.
**Recompile** saves and captures a consistent revision, compiles locally in a
fresh browser worker, and previews the real output. **Download PDF** keeps the
last successful output; older output is labeled after edits/errors. **Auto compile**
is opt-in and debounced. Ctrl/Cmd Enter compiles. Open **Main file & images** to
select an entry file or add/replace/delete bounded PNG/JPEG/PDF assets. Source ZIPs
and History include those bytes. Regular compiles do not consume retained history.
See docs/part-2.md for
shortcuts, draft privacy, limits, and remaining prerequisites.

**Export project (.zip)** saves all files and captures an immutable source/asset snapshot
before downloading the full source tree and a version/hash manifest. Conflicts
and unseen remote changes require review first. **Download file** keeps a copy of
the current editor buffer, including unsaved text. Apply the new snapshot migration
with `pnpm db:migrate` before exporting. Snapshots are capped at 20 revisions per
project and 32 MiB of logical JSON per account; at the limit, individual downloads
remain available. Regular compilation uses a non-retained capture and continues
at that history limit. [Part 3 progress](docs/part-3.md) records the local workflow.

Create a project from either resume starter or the multi-file report using the
**Starting template** selector. All examples are synthetic and include an MIT
license. These templates compile in the selected local engine. **History** saves named source/asset
snapshots, compares saved source, and restores an earlier full source tree.
Restore first preserves the current saved revision, rejects remote changes since
comparison, and reloads the editor. It removes files added since the chosen
snapshot; recover them through the automatic pre-restore snapshot if needed.
At the retention limit restore stops if it cannot preserve the current revision.
Apply all migrations, including 0005, with `pnpm db:migrate` first. See [template provenance](templates/README.md).

## Verification

Part 0A has a separate synthetic compiler evaluator. With the pinned runtime,
`pnpm compiler:prepare` downloads and verifies about 230 MB of candidate assets
into ignored `.cache`; `pnpm compiler:benchmark` runs real XeTeX/xdvipdfmx in
Chromium with local pinned packages and saves PDFs, page images and measurements.
It requires the existing Playwright Chromium installation and `tar`. Normal tests
and builds do not download the engine automatically. Preparation stages ignored
local public assets; the build copies those assets when present. Local desktop
Chromium is validated; hosted delivery, broader devices and redistribution remain
publication checks. See [compiler feasibility](docs/compiler-feasibility.md).

Apply migration 0004 with `pnpm db:migrate` before using assistance or saved
reports. AI is optional: configure `GROQ_API_KEY` and `AI_SHARING_ENABLED=true`
on the API only, using an eligible Groq Free account. Review provider data
controls first. Each request asks for sharing consent; no paid fallback or
automatic retry is enabled. Without a provider, editing and local PDF analysis
still work. `AI_LIVE_CHECK=true` with `pnpm test:ai:live` opts into a synthetic
provider request; it is excluded from normal tests and CI.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm test:e2e:built
pnpm check:environment
```

Integration tests require a separate TEST_DATABASE_URL and fail explicitly if it
is missing. They apply migrations twice, create one random synthetic account,
verify auth/cookies/origin protection, and remove only that account. They never
reset a configured database. E2E uses the separate test database when configured
and cleans up its synthetic account. Start `pnpm mail:start` before integration or
browser tests (CI supplies Mailpit). Browser checks use ports 3101/5273 so normal
development servers can stay on 3001/5173. Without TEST_DATABASE_URL, E2E runs the UI/proxy smoke test
and explicitly skips the real-account test. Playwright loads the root `.env`;
leave test ports 3101/5273 free before running E2E.

The E2E test harness serves deterministic synthetic provider responses over HTTP;
production has no fixture-provider switch. Unit tests cover provider quota/error,
timeout, refusal and malformed-output handling through the actual HTTP adapter.
No normal test sends source to a live AI provider. PostgreSQL integration also
checks multi-file atomic apply, stale/conflicting requests, safety-snapshot quota
rollback, request replay, private report ownership and deletion. PDF browser tests
exercise actual clean, empty, encrypted, malformed and over-page PDF bytes.

Compiler E2E cases require prepared assets and explicitly skip if they are absent.
The local completion run used prepared assets and the real separate PostgreSQL
test database: all 18 browser tests passed in both dev and built workflows,
including both compiler journeys and five account/project lifecycle journeys.

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
Nothing has been provisioned or published externally. Earlier Vercel/Render and
commercial hosting proposals are historical; the current scope is personal use
and localhost testing. No public hosting stack is selected. Free plans do not verify account
eligibility, commercial permission or production suitability; validate these
before deployment while retaining the no-card budget.
