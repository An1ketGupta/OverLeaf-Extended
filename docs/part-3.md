# Part 3 progress — 2026-10-20

**Partial prerequisite delivered. Part 3 remains incomplete.** The repository's
AGENTS.md requires a demonstrated compiler route before dependent integration.
Neither candidate passed Part 0A, and the user confirmed that no staging setup is
available. No engine, compiler endpoint, runtime package fetching, or generated
PDF claim has been added. Recompile remains disabled.

## Delivered

- Authenticated capture/read of immutable text snapshots. A capture checks the
  expected project revision and copies files/main entry under the project write
  lock. Hashes are recomputed from stored source. Same-revision captures reuse
  one record; stale revision capture returns 409.
- PostgreSQL snapshot table, generated migration/snapshot/journal, and explicit
  custom UPDATE trigger enforcing immutability. Later saves preserve old source,
  versions and hashes; parent account/project deletion can cascade.
- Retention limits: 20 captured revisions/project, 32 MiB serialized snapshot
  JSON/account. This measures logical content/metadata, not physical database
  storage. Quotas are checked under the account lock across projects. No silent
  eviction or retention-management UI is implemented.
- Export project (.zip) saves all pending files, rejects conflict/recovery/error
  states, checks for unseen remote changes, captures the exact revision, checks
  hashes locally, and downloads all UTF-8 source files plus a provenance manifest.
  Source remains under `source/`; `snapshot.json` is separate. Later edits are not
  added to an already captured export. Logout/navigation suppress late downloads.
- Download file retains the individual-buffer download, including unsaved text.
  It remains usable when snapshot retention is full. Existing PDF.js preview is
  still a local-file preview, independent of project source.
- Shared strict capture/text-snapshot contracts. Snapshots reject duplicate file
  IDs and paths, traversal, missing entry files and file/directory path conflicts.
  Asset metadata is not treated as downloadable bytes: current snapshots are
  text-only (`assets: []`).

`fflate` 0.8.3 is pinned solely for ZIP creation, with no compression to bound
browser CPU work. Its [upstream documentation and MIT license](https://github.com/101arrowz/fflate)
describe the archive implementation. It is bundled locally, without CDN requests.
Browser exports contain document text and should be handled as private files.

## Verification

Local verification uses pinned Node 24.22.0 / pnpm 10.34.7 and native PostgreSQL
17.10 on loopback port 55432. Tests use only the separate `overleaf_pro_test`
database, apply migrations twice and remove only synthetic accounts and their
cascading rows. No user database reset or shared-data schema push occurs.

| Command/check | Result |
| --- | --- |
| pnpm install --frozen-lockfile | Passed using pinned runtime/package manager |
| pnpm db:generate | Generated 0002 SQL, schema snapshot and journal; custom immutability trigger added to the new SQL before applying it |
| pnpm lint | Passed |
| pnpm typecheck | Passed for root, contracts, database, web and API |
| pnpm test | 29 tests passed, including ZIP round-trip for Unicode/nested paths, exact contents/manifest, corruption/asset rejection, save ordering, unseen remote edits, wrong revision responses and stopped-workspace capture |
| pnpm test:integration | Passed real PostgreSQL auth/project suites and snapshot suite: migration idempotence, isolation, CSRF/origin checks, same-revision deduplication, capture/write race, stale revision rejection, immutable history/trigger, project/account quotas and account deletion cascade |
| pnpm test:e2e | 7 Chromium tests passed, including actual ZIP download after pending save and rejection of unseen remote changes, plus the existing workspace/auth/PDF/recovery suite |
| pnpm build | Passed all packages/API and production Vite build |
| Visual inspection | Desktop and 390 px mobile screenshots inspected; export controls fit, no horizontal overflow |

The first browser run had one test locator failure: the visible notice included
its dismiss button, so an exact-text locator did not match. The test now asserts
the alert's contents; the complete rerun passed. The native development database
was not migrated or modified. Apply `pnpm db:migrate` to a configured development
database before using Export project.

Primary implementation files: `packages/contracts/src/index.ts`,
`packages/db/src/schema.ts`, `packages/db/src/projects.ts`, the `0002` migration
and metadata, `apps/api/src/projects.ts`, and workspace `api.ts`, `export.ts`,
`model.ts`, `Workspace.tsx`. New verification lives in `export.test.ts`,
`scripts/snapshots-integration.ts` and the workspace browser/contract tests.
No compiler request/result fields were changed. Setup, architecture, HTTP/export
contracts and roadmap status were updated without marking open gates complete.

## Remaining compiler gate and handoff

Follow [compiler-feasibility.md](compiler-feasibility.md) before enabling an engine.
The server candidate still needs actual Render Free capacity, timeout/cleanup,
and per-job filesystem/network/secret isolation evidence. The browser candidate
still needs reproducible engine/package/font assets, hashes and redistribution
notices, a narrow audited host API, real template compatibility and browser/host
delivery/cancellation measurements. No candidate has that evidence here.

Part 3 still needs the selected real engine, supported passes, asset bytes,
diagnostics, explicit/debounced compilation, load/progress state, enforceable
input/output/time bounds, runtime termination and cleanup, stale-preview
protection, retained last successful output, and actual PDF download. Its real
template/Unicode/image/reference/error/missing-package/loop/cancellation/project
switching suite remains unrun because no engine is selected.

Neon account eligibility/connection and actual Vercel-to-Render auth/CDN checks
remain open. Hosted behavior cannot be inferred from the local integration suite.
No paid resources, external accounts, hosting deployments, or public TeX execution
were created. Full assets, main-file selection, snapshot restore and retention
management belong to the remaining Part 1/4 work. No subagent was used; independent
security review remains pending.
