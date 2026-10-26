# Part 4: curated templates and recoverable history

**Complete for localhost / desktop Chromium, 2026-10-26.** Both resume templates
and the multi-file report are verified through the real product compiler. Hosted
CI execution, broader devices and compiler redistribution remain separate checks.

## Current delivered scope

- The catalog contains two original MIT-licensed synthetic resumes and one report.
  Template source/license hashes are checked against the complete shared catalog.
- Each template is copied into independent private projects. Existing named
  snapshots, source/asset comparison and transactional safety-snapshot restore
  remain covered by real PostgreSQL tests.
- `pnpm test:templates` checks compiler/template integrity and runs all three
  catalog browser journeys. Every journey compiles the baseline, checks identifying
  extracted PDF text, edits and recompiles, compares/restores history, and compiles
  the restored copy. A second project remains unchanged.
- Resume checks include names, contacts and sections. Report checks include nested
  inputs, contents, findings, the resolved section reference and bibliography;
  undefined references/citations and placeholder question marks fail the checks.
- CI prepares pinned assets before building and requires real compiler coverage
  in development and built browser runs. Missing assets or test database fail its
  global setup. Failure uploads exclude traces, which can contain downloaded
  compiler binaries. Binaries remain ignored and are not published by this task.

## Current verification

The three catalog journeys passed locally against real PostgreSQL and the selected
browser engine. Current full regression results are recorded in
[validation-parts-4-6.md](validation-parts-4-6.md). The workflow has been updated;
a GitHub-hosted run has not been observed. Local results do not verify deployment.

## Historical delivery record

Everything below records the earlier independent milestone. Its compiler and
Part 1 blockers are superseded by the current scope and evidence above.

**2026-10-24 integration update:** all catalog templates now compile in the selected
local browser engine. Source history, comparison and restore also include bounded
asset bytes, with asset hash/size comparisons and transactional safety snapshots.
See part-3.md for current integration evidence. The original delivery record below
describes the earlier independent text-only milestone.

**Independent features implemented; Part 4 remains incomplete.** Part 0A has not
selected a compiler and Parts 1/3 still have open work. This change adds source
starters and recoverable text history without enabling a compiler integration.

### Delivered

- Two original synthetic resume starters and one multi-file report, using standard
  article/report classes and default LaTeX fonts without additional packages.
  MIT license, provenance, required-pass notes and source/license SHA-256 pins
  live in templates/. Each private copy includes LICENSE.txt.
- The project creation form selects a starter or a blank project. Only an
  allowlisted template ID reaches the API. Copying creates independent owned
  project/file records; templates are read from repository files on the server.
  No database or filesystem module enters the browser bundle.
- History lists up to 20 immutable revisions, newest first. Capturing can add a
  1–100 character name; an exported revision can be named later. A revision's
  existing name is reused for identical requests and cannot be overwritten.
- Source comparison first saves every pending buffer and rejects conflicts,
  unresolved recovery, save failures or unseen remote changes. It shows added,
  removed and changed files, plus main-file differences. Each file displays one
  bounded, linear changed block between the common prefix/suffix; this is a
  directional source diff, not a minimal edit script.
- Restore uses the revision actually reviewed, checks ownership and rejects a
  stale project revision. In one account/project-locked transaction it captures
  the current source as a safety snapshot, replaces the full text tree, restores
  the main file, recomputes hashes and advances project/file versions. Existing
  paths keep their current IDs with higher versions; recreated paths receive
  fresh IDs. Historical concurrency tokens are never reinstated.
- Restoring deletes files added since the chosen snapshot. The automatic backup
  can restore them again. Its label is “Source snapshot” and revision identifies
  it. The browser reloads after success so editor buffers use the new versions;
  other tabs must reload and stale writes conflict.
- The 20 revisions/project and 32 MiB logical snapshot JSON/account bounds still
  apply. If the current revision cannot be preserved within quota, restore
  aborts without changes. Existing captured revisions can be reused at quota.
  No history is silently pruned. Names are separately bounded metadata (at most
  2,000 characters/project); renaming/deletion/retention management is not added.
- Migration 0003 adds only snapshot_name with a cascading snapshot FK. Snapshot
  bytes and the existing PostgreSQL immutability trigger remain unchanged.
  SQL, generated Drizzle snapshot and journal are included together.

Apply migrations to a configured development database with pnpm db:migrate
before using these features. The new table is included in readiness. Production
API packaging must retain the repository templates directory alongside the
existing source packages.

### Verification

Used pinned Node 24.22.0 / pnpm 10.34.7 and native PostgreSQL 17.10 on loopback
port 55432, with only the separate overleaf_pro_test database. Tests migrate
idempotently, create random synthetic accounts, and remove only those accounts
and cascading rows. No development/user database was migrated or reset.

| Check | Result |
| --- | --- |
| pnpm db:generate | Generated 0003 SQL, snapshot and journal |
| pnpm lint | Passed |
| pnpm typecheck | Passed |
| pnpm test | Passed; 32 unit tests including asset hashes, strict input and directional diff coverage |
| pnpm test:integration | Passed existing auth/project/snapshot suites plus history: independent copies, names/deduplication, owner/origin protection, mismatched snapshot IDs, restore/backup, version advancement, concurrent restore/save conflicts, quota rollback and cascades |
| pnpm test:e2e | All 9 Chromium tests passed against the real test database, including template creation, named history, diff, restore, backup recovery and rejection after a remote edit |
| pnpm build | Passed all packages and Vite production build |
| Visual inspection | Desktop and 390 px history screenshots inspected; no horizontal overflow |

Initial validation exposed formatting/accessibility lint issues and TypeScript
narrowing in the new integration script; those were corrected. The first
integration invocation lacked TEST_DATABASE_URL and failed explicitly; subsequent
runs used the separate native test database.

### Remaining gates

Compile every template against the selected, pinned engine in CI and inspect
actual extracted PDF text. This cannot run until Part 0A supplies a demonstrated
engine, assets, licenses, isolation/capacity and delivery evidence. There is no
generated template PDF, claim of verified compatibility or enabled compile path.
The report will require multiple passes for references and contents.

Hosted authentication/CDN behavior, Neon eligibility and commercial launch hosts
remain unverified. Asset snapshots, general file CRUD/main-file selection and
other remaining Part 1 work are not silently marked complete. No paid resources,
external accounts, deployment or subagents were used. Independent review remains
pending; validation here was performed by the implementing agent.
