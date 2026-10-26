# Implementation plan: Part 7 and remaining local Parts 1–6 work

Date: 2026-10-26. **Status: approved and implemented for the localhost milestone.**

The user approved this plan with “go ahead and do this.” Execute the phases below,
fix findings, rerun the relevant checks, and record evidence and limitations.
No implementation or test-harness changes were made before that approval.

Completion evidence: [Part 7](part-7.md), [validation](validation-part-7.md),
[backup/recovery procedure](backup-recovery.md), and the checked-in timing/storage
record under recovery-evidence/. Local findings were fixed and relevant checks
rerun. The remaining native zoom/screen-reader, full-database backup tooling,
hosted/device/publication and independent-review limits are recorded explicitly;
they are not inferred from the passing source ZIP/browser/service checks.

## Scope and baseline

Complete ROADMAP.md Part 7 for the agreed personal-project scope: localhost,
desktop Chromium, real PostgreSQL, local Mailpit, the selected pinned browser
compiler, and optional AI. Review Parts 1–6 against their current acceptance
criteria and close remaining local defects discovered during that work.

Read for this review: AGENTS.md, ROADMAP.md, README.md, docs/part-0.md through
docs/part-6.md, docs/contracts.md, docs/architecture.md,
docs/validation-parts-4-6.md, compiler feasibility notes, and the existing
implementation, integration scripts, browser tests and CI configuration.

The current working tree already contains uncommitted Parts 4–6 changes. Preserve
them, use them as the baseline, and do not reset, stash, commit or overwrite
unrelated work. Use Node 24.22.0, pnpm 10.34.7 and pnpm-lock.yaml. Do not delegate.

Existing validation is historical evidence, not a fresh result from this review.
The previous record reports 46 unit tests, eight real PostgreSQL integration
suites and 22 browser journeys in both development and built localhost runs.
This planning step has not rerun those checks or injected failures.

## Parts 1–6 review and carry-forward

| Part | Current local baseline | Work included here |
| --- | --- | --- |
| 1: accounts and persistence | Verified local accounts, verification/reset, private CRUD, assets, snapshots and deletion recovery | Audit every protected route; test session expiry, API/database interruption, deletion races and transactional recovery |
| 2: editor and autosave | Serialized saves, explicit conflicts, account-scoped tab drafts, reconnect and navigation guards | Test lost acknowledgements, delayed reads/writes, same-account reauthentication, multi-tab operations and keyboard/focus behavior |
| 3: compiler and exports | Real bounded browser compilation, cancellation, stale output, PDF/source download and asset snapshots | Test late results, lifecycle cleanup, isolation/asset failure regressions, end-to-end timings and quota-independent export |
| 4: templates and history | Two resumes and one report compile; private copies, comparison and restore work | Use templates in the complete journey; test restore races and preservation failures at retention limits |
| 5: AI assistance | Reviewed atomic apply, safety snapshots, refusal/failure, request IDs and guarded restore | Test provider interruption/restart, delayed completion after reject/expiry/deletion/logout, repeated apply and stale proposals |
| 6: PDF analysis | Exact-byte extraction, deterministic evidence/requirements and private reports | Test interruption, replacement/cancellation, private report races, unsupported input and report quota recovery |

OCR, optional AI requirement extraction/advice, durable compiled-PDF storage,
general history pruning and follow-on Part 9 features are deferred features,
not missing local acceptance work. Keep them explicit without adding them here.

## Findings already supported by code inspection

1. **Export depends on history capacity.** Workspace captureSavedSource in
   export.ts calls createSnapshot; snapshot creation refuses a new revision when
   retention is full. A complete backup should remain available at that point.
2. **There is no application ZIP recovery flow.** The existing archive contains
   source, asset bytes and a manifest, and tests check its contents. Projects has
   no corresponding import action. A backup-to-new-project round trip is missing.
3. **Service failures are not yet demonstrated as one recovery journey.** Existing
   tests cover aborted browser saves, conflicts, password-reset revocation,
   deletion/save races, provider failures and a database readiness failure.
   They do not establish the complete browser workflow across an actual API
   process restart and a dropped/reconnected database transport.
4. **Some current documentation still opens with superseded compiler blockers.**
   ROADMAP.md Parts 0/2 and older progress/architecture wording need a clear
   current scope statement while retaining dated historical evidence.

Additional risks to investigate, rather than established bugs: session reads in
apps/web/src/api.ts have no explicit deadline; delayed session/project reads can
race mutations; independently saved reports can race deletion. Add reproductions
before deciding which implementation changes are necessary.

## Phase 1 — Complete integrated browser journey

Add one repeatable browser test that performs actual UI signup, local verification
and signin, creates a resume from the catalog, edits and saves, then reloads to
check persistence. Compile with the real engine and download the actual PDF.
Request a synthetic AI edit through the real server HTTP adapter, inspect its diff,
apply explicitly, recompile, and inspect the changed PDF text. Analyze those exact
PDF bytes, compare their SHA-256 with the download, inspect evidence and save/reopen
a private report. Finally restore the pre-apply source, recompile, and check the
original content and preservation of the later revision in history.

Reuse existing account, compiler and PDF helpers. The provider is a controllable
loopback HTTP fixture; do not use a frontend fake or describe it as live AI.
Deterministic editing, compilation and analysis must remain usable without AI.

Acceptance: one account/project passes the entire ordered workflow in development
and the locally served built app, with actual PDF-byte/text assertions and no
compiler skips.

## Phase 2 — Service interruption and recovery

Create a test-only recovery harness with a test-owned child API process, stable
test configuration/secret across restarts, and a controllable TCP relay between
that API and the separate real TEST_DATABASE_URL. Close existing relay sockets
and refuse new connections to exercise pool failures; reopen the relay to prove
recovery. Never stop the shared PostgreSQL service, change user database access,
reset a database or add production failure-control endpoints. Bind controls to
loopback, bound waits, track child processes and clean up in finally blocks.

Cover these failure points separately:

- Stop and restart the API while loading a project, saving a draft and awaiting
  AI. Verify useful bounded errors, retained acknowledged data and recoverable
  unacknowledged text. Show health/readiness changes and successful later saves.
- Interrupt database access with an idle pool and during reads/writes; prove the
  API survives, unavailable requests disclose no secrets, and reconnection works
  without resetting the application or silently replacing drafts.
- Expire a synthetic account's persisted session. Hide private views, retain the
  allowed draft recovery copy, reauthenticate as that account and recover work.
  Account switching and explicit logout must keep their distinct cleanup rules.
- Interrupt requests before commit and drop a response after commit. Reconcile
  actual stored state before retrying mutations; do not automatically replay
  non-idempotent creation, restore, apply or report-save operations.
- Leave an AI request pending across restart; recover by its existing ID, report
  pending/expired accurately, and do not promise exactly-once upstream inference.
- Test provider refusal, malformed/HTML/429/5xx output, unreachable transport and
  deadline failure through the actual HTTP adapter, followed by a successful request.

Fix reproduced errors with bounded requests, accurate status/retry guidance and
existing draft/version safeguards. Keep raw database/provider errors out of logs.

Postman api-engineer and api-simulation guidance informed this plan. During
implementation, verify whether the discovered Postman executable supplies the
required CLI and local simulation capability. Prefer it for HTTP upstream failure
scenarios when available; otherwise extend the repository's existing loopback HTTP
fixture and document the tooling limitation. Do not create a hosted mock, publish
resources, connect a paid service or send real documents. PostgreSQL runs for real;
it is not an HTTP simulation member.

Acceptance: each injected failure has before/failure/recovery assertions for
visible state, draft bytes, stored versions and absence of partial mutations.

## Phase 3 — Concurrency, privacy and cleanup

Build on existing tests instead of duplicating their coverage. Use deterministic
barriers to release delayed requests, rather than arbitrary timing sleeps.

- Race tab saves with rename/delete/main-file changes, snapshot restore and AI
  apply. Only current versions succeed; neither tab's dirty text is silently lost.
- Delay project/session reads across a later mutation or account change. Old
  responses must not replace current state or re-expose another account's data.
- Delete a project/proposal while its provider request is active; release the
  response and prove deleted rows, files and UI do not return. Preserve the
  distinction that independent account-owned reports survive project deletion.
- Race report save/load/delete and account deletion. Respect transaction ordering,
  suppress stale UI completion and verify account cascades. Do not infer that a
  committed save was cancelled merely because its browser request was aborted.
- Release compiler/PDF-parser results after edit, cancel, replacement, navigation,
  project deletion, logout and tab close. Old results must not replace the preview,
  start a download or revive private UI; a subsequent job must work.
- Audit all current and newly added private routes with owner, foreign-account,
  missing-session and mismatched-parent IDs. Verify local private/no-store and
  origin/cookie behavior without claiming actual CDN isolation.
- Recheck worker host API restrictions, package fetch allowlists, hash mismatch,
  malformed/oversized PDFs, timeout, auxiliary/input/output bounds and job isolation.
- Inspect synthetic deletion cleanup in database rows, drafts, object URLs and
  worker lifecycle; verify limits/capacity can be reused after permitted cleanup.

Acceptance: regression tests reproduce any race fixed, assert persisted state as
well as UI, and prove late work cannot undo a completed deletion or account change.

## Phase 4 — Accessibility and measured performance

Exercise the integrated screens using keyboard only: account forms, catalog,
tree/tabs, CodeMirror escape/search/save/compile, resizing, conflict/recovery,
history, assistant diff/apply, report evidence and destructive confirmations.
Check accessible names, visible focus, modal containment/Escape/return focus,
error/status announcements and focus after asynchronous state changes. Fix findings.

Check 320 px and 390 px layouts, a desktop viewport and 200% zoom for overflow,
unreachable controls and usable Files/Source/PDF transitions. Include long names,
errors, diffs and evidence. Inspect screenshots. Record that viewport emulation
does not establish physical mobile performance or full assistive-technology support.

Benchmark the two resumes and report using the existing real compiler runner and
product path. Separate a fresh browser/context with cold local asset loading from
warm verified asset reuse and worker execution. Record hardware, runtime/browser,
asset bytes, preparation/loading, save/capture, compilation and PDF-preview times.
Use one cold and at least five warm runs per representative document; report
individual values, median and range. Measure representative API and synthetic AI
latency separately; fixture timing is not live provider latency.

Keep current 30-second engine loading, 15-second compile and provider deadlines as
functional bounds; use measurements to identify regressions instead of inventing
hosted latency promises. Record browser memory observations separately from hard
limits. Optimize only measured problems and repeat affected measurements.

## Phase 5 — Backup recovery and limits

Provide a minimal **Import project backup** action that restores this application's
versioned ZIP format into a new private project. This closes the identified backup
gap; it is not a general arbitrary ZIP or Overleaf importer.

- Parse only the supported manifest/source layout. Bound archive size, entry count,
  decoded sizes and total content before allocation/decompression. Prefer accepting
  the stored-entry format produced by this exporter; reject unsupported compression,
  duplicate/unsafe paths, special entries, malformed Unicode, mismatched manifest
  data, missing main files, invalid assets and failed content hashes.
- Validate browser-parsed data again through strict packages/contracts DTOs on the
  API. The server recomputes hashes and enforces existing project/account quotas.
  Historical IDs, revisions, owners and hashes confer no authority.
- Create the complete source/asset tree transactionally in packages/db, with fresh
  IDs and optimistic versions. Failure creates no partial project or quota usage.
  Never overwrite an existing project. The UI shows a clear success/error and opens
  the recovered project. No new runtime dependency is expected; fflate is pinned.
- Document the endpoint/DTO before implementing it. Keep route/auth work in
  apps/api and browser ZIP handling in apps/web. No migration is expected; if a
  proven need arises, keep SQL, generated snapshot and journal together.
- Export a nested Unicode/image project, delete the synthetic original, import
  its archive, compare exact source/asset bytes and main file, and compile/inspect
  the recovered PDF. PDF binary identity is not required across separate compiles.
  The archive recovers one source revision, not accounts, passwords, sessions,
  complete history, AI proposals or independently saved reports.

Decouple new source exports from retained history allocation using the existing
consistent ephemeral capture behavior where suitable. Document any manifest
provenance distinction between capture IDs and stored snapshots; do not label an
ephemeral capture as durable history. Preserve reading of existing v1 exports.
Never delete history silently to make export work.

Exercise file bytes/count, project/account assets, project count, snapshot
count/bytes, proposal count/bytes and report count/bytes at and beyond their bounds.
Use synthetic fixtures and existing constants; do not weaken quotas for testing.
Check concurrent quota allocation and rollback across projects. At full history,
ordinary edits, compile, PDF download, individual draft download and full source
backup remain useful; operations needing a new safety snapshot stop atomically
with recovery guidance. Proposal/report deletion releases its appropriate quota.

Record logical payload/storage growth separately from PostgreSQL physical usage,
which includes indexes, JSON/base64 overhead and dead tuples. Use only test-owned
data for measurements. Document export/import recovery and a separate database
backup/restore procedure; source ZIPs are not complete database backups. If native
backup tools are available, demonstrate a separate synthetic database dump/restore
into an isolated disposable database, never over development or test data. Otherwise
record that drill as unavailable, without calling the whole-database recovery proven.

## Phase 6 — Regression checks, documentation and completion

Run prerequisite checks with the pinned runtime, the separate real test database,
Mailpit and verified local compiler assets. Missing prerequisites must fail visibly.
Do not read or print secrets to collect evidence. Run:

```text
pnpm compiler:prepare
pnpm compiler:verify
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
REQUIRE_COMPILER_TESTS=true pnpm test:e2e
pnpm build
REQUIRE_COMPILER_TESTS=true pnpm test:e2e:built
pnpm compiler:benchmark
git diff --check
```

The environment-prefix notation above is conceptual; set REQUIRE_COMPILER_TESTS
with PowerShell environment syntax on Windows. Add focused recovery/quota/import
commands to the existing scripts and CI as needed, and run them as part of acceptance.
First run focused reproductions, fix findings, then run the complete relevant
regression suites. Rerun affected checks after further changes. Normal tests make
no live provider calls; the earlier live matrix remains dated evidence.

Deliver docs/part-7.md and docs/validation-part-7.md with a scenario/check/result
matrix, fixes, commands actually run, timings, synthetic-only evidence locations,
backup recovery instructions and remaining limitations. Update ROADMAP.md,
README.md, contracts and affected progress/architecture documents to reflect the
final behavior and remove misleading current-tense historical blockers.

Part 7 can be marked complete for localhost only after the ordered journey,
recovery, race/deletion, accessibility, export/import and quota acceptance checks
pass. Report unavailable checks explicitly; do not treat written tests, mocks,
skips or CI configuration as execution evidence. Any unresolved local acceptance
failure keeps the relevant item open with its precise blocker.

## Publication boundaries retained after this work

Actual hosted API sleep/proxy timeouts, cookie/CDN behavior, external email,
Neon/account eligibility, free-host selection, compiler redistribution/notices,
other browsers/physical devices and independent release/security review remain
separate gates. Local restart and disconnect drills do not verify them. Compiler
memory is not hard-capped by Docker or a worker. PDF extraction retains its font,
reading-order, OCR and client-provenance limitations. Live AI quality and account
billing/data controls are not attested by deterministic fixtures.

No deployment, external account creation, paid resource, product license change,
public arbitrary TeX execution or subagent is included in this approval.
