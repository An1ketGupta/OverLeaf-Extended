# Part 7 local verification — 2026-10-26

**Local milestone complete.** All results below are executed checks, with the
development rerun and remaining limitations stated explicitly. Scope: personal localhost / desktop
Chromium, Windows 10.0.26300, Intel i7-13650HX, Node 24.22.0, pnpm 10.34.7,
Chromium 156.0.8078.4 and native PostgreSQL 17.10. Only the configured separate
test database, synthetic accounts/documents and loopback Mailpit were used.
No development/user database was reset, shared-data schema pushed, account/host
provisioned, paid service selected, product license changed or subagent invoked.

## Findings and fixes

| Finding | Final behavior and evidence |
| --- | --- |
| Checked-out PostgreSQL socket errors could crash the API during a transaction | Client error-event listeners now cover borrowed connections as well as idle pool sockets. A real blocked transaction is disconnected; health remains 200, readiness returns 503, stored content/version stay unchanged, reconnection and retry save the retained draft. |
| ZIP export required a new retained snapshot | Workspace/dashboard export use a consistent ephemeral capture and allocate no history row. Browser recovery succeeds with 20 retained revisions. |
| No source ZIP recovery action | Bounded v1/v2 stored ZIP parsing plus strict API validation restore exact source/asset bytes into a new private project with fresh IDs/versions. A post-insertion database failure rolls the entire import back. |
| Valid escaped source can exceed compiler transport capacity | Separate export-input transport supports up to 50 MiB encoded data; compiler input stays at 16 MiB. A 3 MiB control-character fixture exceeds the compiler cap but exports successfully; text/asset/project logical caps stay unchanged. |
| Malformed base64 could throw during import quota refinement | Child validation errors no longer cause decoding in the parent refinement. Invalid inputs return 400 and no project; unit and real API regressions pass. |
| Session reads had no explicit deadline | They now use the existing 12-second browser request bound. Transient service failures preserve drafts and offer retry. |
| A delayed project read could mark later saved work as remotely changed | Validation tracks request generation, model changes and unmount. A delayed pre-save read is released after a newer save and cannot invalidate it. |
| Dialog keyboard boundaries/return focus needed work | Tab/Shift-Tab wrap inside History, Assistant, management and unsaved-work dialogs. Escape retains each dialog's busy rules; closing returns focus to its opener when present. |

## Integrated and recovery evidence

| Scenario | Assertions actually exercised |
| --- | --- |
| Complete browser journey | UI signup, inbox verification/signin, template, edit/save/reload, actual compile/download, reviewed AI diff/apply, changed compiled PDF text, analysis hash equal to downloaded bytes, private report reload, source restore/recompile and preserved pre-restore revision |
| API interruption | Actual child process stop/restart during a draft save, during initial workspace loading and while awaiting provider completion; source/drafts survive, retry works, pending requests expire accurately |
| Database interruption | Existing idle sockets are dropped and new connections refused by a test-owned TCP relay; a second case interrupts a genuinely lock-blocked transaction. Real database queries, rollback, process survival and later saves are checked. The shared PostgreSQL service is never stopped. |
| Lost acknowledgement | A real save commits before its response is dropped. Retrying conflicts, the draft remains and explicit version comparison/rebase recovers it. |
| Session expiry | A synthetic persisted session is expired; private editor hides, the same account signs in and recovers/saves its tab draft. Existing reset/logout/account-switch privacy checks remain. |
| Late provider replies | Real HTTP replies released after reject, expiry, proposal/project/account deletion cannot revive those records or modify source. A browser request across API restart remains honestly pending/expired; deletion while another request runs leaves no proposals. |
| Late compiler replies | Actual worker success messages are held and released after cancel/newer edits. Neither enables PDF download or replaces current output; worker termination and a subsequent real compile succeed. Existing project/asset isolation, timeout, hash and parser cases remain. |
| Multi-tab and navigation | Conflicting saves, rename/deletion, restore/apply staleness, remote deletion with downloadable orphan drafts, Back/failed saves, cross-tab logout and delayed-read ordering are covered by existing and new checks. |
| Source backup | Export at full history, delete synthetic original, import via Projects, compare nested Unicode text, main-file selection and exact image bytes, then compile and extract the recovered PDF |
| Quotas | Concurrent final project-slot allocation; exact source/file/asset/project limits; actual 32 MiB account assets; snapshot count/bytes and preservation rollback; proposal reservation bytes; report count/bytes; permitted deletion releases capacity |
| Useful quota UI | Full-history source ZIP download works; full report storage keeps local PDF analysis and hash visible, displays recovery guidance, and saves again after deleting a report |
| Keyboard/reflow | Editor escape/search/save, dialog traversal/Escape/opener focus, existing tab/splitter shortcuts, 320/390 px layouts and 640 px reflow, Files/Source transitions and overflow assertions; screenshots inspected |

## Commands and results

All application commands used the pinned runtime through the existing ignored
Windows .cache/run-pnpm.ps1 helper. REQUIRE_COMPILER_TESTS=true was set using
PowerShell environment syntax for required browser runs.

| Check | Result |
| --- | --- |
| pnpm compiler:prepare / compiler:verify | Passed; pinned local assets and all three catalog sources/licenses verified |
| pnpm lint | Passed |
| pnpm typecheck | Passed root and all workspace packages |
| pnpm test | 51 tests passed in 11 files |
| pnpm test:integration | All eight existing suites passed against real PostgreSQL/Mailpit after the transaction and validation fixes |
| pnpm test:recovery:integration | All three new suites passed: backup, late-response races and quota recovery |
| Development browser regression | 30 of 31 passed in the full run; a validation-code edit triggered HMR during compact-template compilation. The affected catalog journey then passed on a clean focused rerun (41.6 s), including baseline/edit/restore PDF checks. No skips. The earlier full 29-test run also passed before the additional transaction/report-quota cases. |
| pnpm build | Passed with prepared local compiler assets |
| REQUIRE_COMPILER_TESTS=true pnpm test:e2e:built | All 31 passed in one clean run, no skips; 6.4 minutes |
| pnpm test:provider:recovery | Passed through the local Postman simulation with the actual HTTP provider adapter; no live provider calls |
| tsx --env-file-if-exists=.env scripts/api-benchmark.ts | Passed actual loopback HTTP save/capture measurements for all catalog templates |
| pnpm compiler:benchmark | All 70 isolated final evaluator runs passed; zero failed checks, corruption rejection and load cancellation passed |
| git diff --check | Passed |

Expected failure-injection output includes proxy ECONNREFUSED/ECONNRESET notices
while the owned test API is stopped, and one generic SMTP delivery-failure notice
from the account suite's intentional outage. They contain no document bodies or
connection URLs. The original transaction crash was reproduced before its fix;
it is not treated as a passing run. Early browser assertion/fixture problems
(virtualized editor lines, ambiguous status locators and invalid synthetic PNG
CRC) were corrected and the relevant journeys rerun. A generated PNG with valid
chunks now supplies the backup image fixture. No retry was used to conceal an
unexplained product failure.

Postman CLI 1.75.0 served only the original synthetic upstream fixture. The adapter
passed success/refusal, malformed/truncated output, 429, 503, HTML failure, deadline
failure, later success and unreachable transport. The simulation logged eight
completed member responses; the hanging request was aborted and the unreachable
port never reached it. No remote workspace/owner mock was pulled or published.
The local simulation path must name default.js with this CLI version. Context and
reproduction commands are in postman/simulations/recovery/recovery.context.md.

## Measurements and artifacts

Product timing includes saved-source reconciliation/capture, verified local asset
loading when cold, worker execution, PDF.js validation and rendered preview.
Each document has one cold local page load and five warm compiles in the same
workspace. This measures localhost delivery, not internet download or physical
mobile performance. Built-run samples (milliseconds):

| Template | Cold | Five warm samples | Warm median / range |
| --- | ---: | --- | --- |
| Classic resume | 5,618 | 4,145; 3,979; 4,194; 4,049; 4,107 | 4,107 / 3,979–4,194 |
| Compact resume | 6,585 | 4,091; 4,193; 4,100; 4,059; 4,083 | 4,091 / 4,059–4,193 |
| Report | 6,405 | 4,290; 4,273; 4,312; 4,209; 4,144 | 4,273 / 4,144–4,312 |

The same development product path measured 5,704/7,281/7,286 ms cold and
5,416/4,958/5,320 ms warm medians for classic/compact/report. Browser assertions
include polling overhead. Five built-session GETs took 7/6/6/7/6 ms, and synthetic
AI requests took 40/16/24 ms across those three templates. Raw samples and the
isolated evaluator summary are retained in
docs/recovery-evidence/2026-10-26-chromium.json. No internet cold download, percentile
tail or production service-level objective is established by these small samples.

Separate actual loopback HTTP save/capture measurements (five each/template):

| Template | Save median/range, ms | Capture median/range, ms |
| --- | ---: | ---: |
| Classic resume | 4.10 / 3.49–5.83 | 3.47 / 3.41–5.10 |
| Compact resume | 3.50 / 2.92–3.78 | 2.89 / 2.67–3.42 |
| Report | 2.93 / 2.67–3.07 | 2.63 / 2.44–2.94 |

These use small 2.6–3.4 KiB serialized catalog captures and a separate native API
listener with the same auth/repository code. They are not a throughput or large
project benchmark. Synthetic provider durations measure fixture HTTP/database
overhead, not live inference. The evaluator separately records engine preparation,
worker execution and observed WASM memory; browser memory remains a soft observation.

The storage drill reached 33,554,432 logical asset bytes and 7,855,679 saved-report
bytes in thirteen large escaped reports before the next report was refused. The
repeated synthetic assets compressed to 384,336 stored column bytes; this is not
the whole database's physical disk use. Indexes, table/TOAST overhead and dead
tuples differ. Fixtures are deleted after checks; no vacuum/reset was performed
against user data. Snapshot growth/byte limits remain covered by the existing
real integration suite.

Ignored synthetic artifacts: .cache/part-7/dev-artifacts and
.cache/production-results (screenshots, actual PDFs and the recovered source ZIP),
.cache/part-7/*performance*.json and storage.json, and
.cache/compiler-feasibility/candidate/results (evaluator PDFs/page images/raw
measurements). Traces may contain compiler binaries and stay local. No binaries,
private documents or credentials are committed.

## Remaining limits

- Actual hosting, API sleep/wake and proxy timeouts, hosted cookie/CDN/cache/email
  behavior, Neon/account eligibility and free-host selection remain unverified.
- Compiler redistribution/notices, other browsers/physical devices and independent
  release/security review remain publication work. No public arbitrary TeX API is
  enabled. Worker/time/byte limits are not hard operating-system memory isolation.
- Source ZIP recovery proves one revision, not a whole-database/account/history
  backup or off-device disaster recovery. pg_dump/pg_restore were unavailable in
  the local package and on PATH, so the separate full-database drill was not run.
- Viewport and keyboard checks do not establish native browser zoom or full screen
  reader conformance. The 640 px viewport checks reflow, not physical hardware.
- PDF extraction retains font/reading-order/column/hidden-text limitations, no OCR,
  and client-provided provenance. A compatibility estimate is not an employer's
  ATS score. Optional AI requirement extraction and durable PDF storage remain
  deferred features, not reopened local acceptance work.
- No live provider run occurred in this milestone; previous six-case live evidence
  remains dated in validation-parts-4-6.md. General model quality and account
  billing/data controls are not attested. Interrupted inference may still have
  happened upstream; imports/report creation/restore are not blindly retried.
- GitHub CI is configured but has not been observed executing. The implementing
  agent performed the review; no independent reviewer/subagent was used.
