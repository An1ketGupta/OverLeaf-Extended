# Implementation plan: Part 0A and Part 3

Prepared 2026-10-24. Status: completed for the subsequently clarified personal
project / localhost / desktop Chromium scope. Phases 1–5 are implemented and
locally verified; see part-3.md and compiler-feasibility.md. Hosted delivery,
broader devices and compiler redistribution remain publication work. Optional
durable PDF artifacts and automated compiler downloads in CI are deferred.

The original plan below preserves the approval record. The user's later localhost
instruction supersedes its requirement for hosted evidence before local integration.

## Objective and sequence

Demonstrate a real LaTeX execution route that satisfies the commercial-use and
free/no-card constraints, record the Part 0A decision, then complete Part 3's
edit/save/compile/preview/download workflow using that route.

Execute the phases below sequentially. Part 3 implementation starts only after
one candidate passes the applicable compatibility, licensing, isolation,
capacity, and asset-delivery gates in compiler-feasibility.md. If neither passes,
deliver the reproducible findings and specific blocker before proposing scope
changes. Approval of this plan does not approve paid infrastructure, a product
license change, public arbitrary server TeX execution, or deployment.

## Findings at plan approval (historical)

Reviewed AGENTS.md, ROADMAP.md, README.md, Part 0/3 progress, architecture,
contracts, commercial-use and compiler-feasibility documentation; the workspace,
compiler stub, source export, preview, assistant and resume-analysis integration;
project routes/repositories/schema; fixtures, templates and test/CI setup.

- React/CodeMirror editing, autosave/conflict protection, authenticated private
  text projects, immutable text history and source ZIP export already exist.
- Compilation is an unavailable adapter in
  apps/web/src/features/workspace/compiler.ts. Recompile is disabled. No compiler
  package, worker, engine binaries or compile HTTP endpoint exists.
- PDF.js previews uploaded local files. Resume analysis consumes actual uploaded
  PDF bytes. Neither currently receives compiler output.
- Shared compile messages already describe request IDs, snapshots, states,
  diagnostics, PDF bytes/hashes and build IDs. Reuse and deliberately extend these
  contracts instead of inventing a second competing interface.
- Persistence and accepted snapshots are text-only. Asset metadata is defined,
  but asset bytes, immutable asset capture and image upload are absent. Main-file
  selection is also absent.
- Captured history is limited to 20 revisions/project and 32 MiB logical
  snapshot data/account. Persisting a history snapshot on each debounced compile
  would quickly prevent further compilation; routine compiles need independent,
  non-retained input captures.
- Existing fixtures cover two resumes, XeLaTeX/fontspec/Unicode and a multi-file
  report with a generated image and repeated passes. Product templates are
  original MIT-licensed source and still need engine verification.
- Node 24.22.0 and pnpm 10.34.7 are available under .cache/runtime. The default
  PATH Node is 26.5.0, so implementation checks must explicitly select the pinned
  runtime. Docker CLI exists, but its daemon is unavailable. No pdflatex/xelatex
  command was found. No root .env exists, and the documented local PostgreSQL
  port 55432 was not listening during this review. Cached PostgreSQL tooling is
  available for a separate disposable test setup.
- The working tree has extensive staged, unstaged and untracked work from prior
  parts. Preserve it and keep changes limited to this task. No subagents.

## Phase 1: Part 0A feasibility and route selection

### 1. Establish reproducible candidates and license requirements

Evaluate a minimal native TeX Live server candidate and browser WASM, starting
with SwiftLaTeX's XeTeX route because the Unicode fixture requires fontspec.
Compare PdfTeX only if it adds demonstrated value; do not ship two engines by
default. Browser execution is the leading hypothesis because it can avoid
per-document backend compute, but selection depends on evidence.

For each candidate, record exact source revisions, toolchain/build steps, engine,
format, package and font versions, every distributed asset's SHA-256, provenance,
license notices and update process. Audit the code and binaries actually used.
SwiftLaTeX's upstream repository carries AGPL-3.0: resolve corresponding-source
and integration obligations for the intended product distribution before adoption.
Do not assume that commercial use implies either closed-source or open-source
distribution. If the intended model is incompatible or unclear, leave the
license gate open and investigate an alternative before integration.

Produce a pinned, bounded package/font bundle for the supported documents. A
runtime dependency on an uncontrolled CTAN mirror is not acceptable. Unsupported
packages/fonts must produce a clear diagnostic.

### 2. Build isolated feasibility harnesses, outside the product compile path

- Use only synthetic fixtures and disposable environments. Establish package
  closure and actual generated PDF output before writing the product adapter.
- Run both resume fixtures, the image-bearing report and all three catalog
  templates. Generate chart.pdf from chart.tex with the candidate being tested;
  record the resulting asset hash and use those exact bytes in the report.
- Verify rendered pages and PDF.js extraction: identity/contact text, accents,
  missing glyphs, reading order, image presence, resolved contents, references
  and citations. Successful exit status alone is insufficient.
- Exercise invalid syntax, missing packages/fonts, infinite loops, oversized
  inputs/output, cancellation during loading and running, and subsequent recovery.
- Record a cold run and at least five warm runs per fixture, browser/device/host
  identifiers, transfer and output bytes, pass count, latency and memory where
  observable. Report browser memory observations separately from enforceable
  byte/time bounds. Distinguish engine loading from the existing 15-second job
  deadline; establish a separate bounded loading deadline from measurements.

### 3. Prove the execution boundary and delivery

Browser candidate:

- Audit WASM imports, JS host bridges, filesystem access and all network paths.
  A same-origin Worker alone is not a credential boundary. Demonstrate that TeX
  cannot read session data, invoke credentialed API requests, fetch arbitrary
  URLs, execute host JavaScript or access another project's files.
- Use a narrowly controlled host interface with pinned allowlisted asset reads
  and credential-free requests. If stronger separation is necessary, validate a
  sandboxed credential-free compiler context and typed message bridge. Select
  the smallest boundary that actually passes the probes.
- Keep source/assets and auxiliary files confined to one job. Terminate the
  runtime on timeout/cancel and demonstrate fresh project state after cleanup.
  Reuse only immutable verified engine/package data across jobs.
- Test UI responsiveness, worker recreation, supported browsers and required
  CSP/MIME/COOP/COEP headers. Verify package assets in the production build.
- Measure the bundle against a commercially eligible free static host's file,
  transfer and deployment limits. Test delivery on the actual candidate host
  when account access and deployment authorization are available.

Server candidate:

- Establish whether the host supports a real per-job OS execution boundary:
  isolated filesystem, no service environment/secrets, denied network access,
  resource limits, process termination and cleanup. Container packaging and
  shell-escape flags alone do not pass this requirement.
- If viable, benchmark one job at a time plus API overhead on actual Render Free
  staging, including cold starts, memory, CPU, image size and restart behavior.
  Never treat a local constrained process as actual Render measurements.
- If isolation or host access is unavailable, record that candidate as failed
  or unverified with evidence; do not enable a public endpoint to test it.

### 4. Record the decision before product integration

Update docs/compiler-feasibility.md with reproducible commands, raw measurement
locations, compatibility matrix, asset/license inventory, security probes and
pass/fail/unverified outcomes. Record the selected route and supported subset
only after it passes its required gates. A failed server candidate does not
prevent selecting a passing browser candidate.

Account access is a dependency for hosted evidence. This review found no staging
configuration; lack of access must remain explicit. Under the current gate,
missing required delivery/host evidence prevents declaring Part 0A complete and
starting dependent Part 3 integration. Complete useful local prototype work first,
then request only the access needed for the remaining concrete checks. Never
request credentials in chat. Hosted auth, Neon eligibility and commercial launch
hosting remain separate open Part 0 gates.

## Phase 2: minimum compilation prerequisites and contracts

After Part 0A passes, implement the following bounded additions to Part 1 needed
for Part 3. This is not a full project/account CRUD expansion.

1. Add private binary asset persistence, upload/read/replace/delete and main-file
   selection. Initially allow compiler-verified image formats only; reject
   executable content, remote imports and project-supplied engine/host scripts.
   Validate byte signatures, relative paths, cross-type path collisions, owner,
   per-file/project/account quotas and optimistic versions/revisions. Raw asset
   downloads use safe content headers and the existing private/no-store policy.
2. Extend immutable snapshots, restore and source ZIP export to include actual
   bounded asset bytes. Preserve old text snapshots as empty-asset snapshots.
   Restoring one must first preserve the full current source/asset tree and
   transactionally reject stale input or quota failure. Recompute hashes from
   stored bytes. Commit generated migration SQL, metadata snapshots and journal
   together, preserving the existing immutability guarantees.
3. Add a non-retained compile-input capture: save pending buffers, compare a
   fresh project against the workspace, then capture the exact expected project
   revision and all source/asset bytes under the project transaction boundary.
   Suggested HTTP operation: POST /api/projects/:id/compile-input with
   {baseRevision}. It returns a bounded immutable response and does not create a
   history row or consume the 20-snapshot allowance. Stale revisions return 409.
4. Give ephemeral compile inputs their own capture ID/type. A capture ID must
   never be represented as a retrievable persisted snapshot ID. Extend worker
   results to bind the exact input ID, project/revision, optional retained
   snapshot ID, compiler build and PDF hash. Specify a bounded binary encoding
   for HTTP and transferable Uint8Array buffers for worker transport. Validate
   aggregate decoded and encoded sizes, hash correspondence and duplicate paths.
5. Freeze these changes in packages/contracts and docs/contracts.md before
   implementation. Keep Zod contracts authoritative; reuse existing integration
   tests and add runnable local HTTP examples for changed operations. Postman
   setup/publication is not required for plan review, and shared workspace
   publication requires a separate request.

Named history/export/AI safety snapshots retain their existing meaning. A normal
compile continues to work when retained history is full. Optional durable PDF
artifact storage is deferred; Part 3 delivers local preview and download.

## Phase 3: selected compiler runtime

- Implement packages/compiler only when it contains the selected engine adapter,
  verified asset loader, pass orchestration and diagnostics shared by the real
  harness and application. Keep browser/server entrypoints separate if needed;
  no server credentials, database or provider imports enter apps/web.
- Populate a fresh job filesystem from the captured input. Resolve all project
  paths there; allow only the pinned package/font set. Run the bounded number of
  passes established by fixtures, preserve auxiliary files within that job, and
  report unresolved references rather than promising unsupported bibliography
  tools, arbitrary Overleaf compatibility or shell commands.
- Implement loading/queued/running/succeeded/failed/timed-out/cancelled states,
  one active job, bounded newest-request scheduling, immediate cancellation and
  cleanup. Enforce deadlines from the controlling context so an engine loop
  cannot block its own timeout. Account for WASM memory limits supported by the
  actual build; document any remaining platform limits.
- Parse bounded diagnostics into severity/message/relative path/line. Reject
  untrusted HTML, unsafe paths and unbounded logs. Keep source and compilation
  logs out of application telemetry.
- Validate nonempty generated PDF bytes with the byte-size limit, PDF structure
  and actual PDF.js parsing, then compute SHA-256 over the exact bytes. Preserve
  an independent copy when transferring buffers so parsing cannot detach the
  downloadable output. Browser hashes establish consistency, not attestation.

## Phase 4: workspace compilation and PDF export

- Replace pendingCompiler with the selected runtime adapter. Add explicit
  Recompile, Cancel and an opt-in debounced automatic compile mode after saves.
  Surface loading, compiling, failure and retry states without freezing editing.
- Capture a consistent saved revision; stop on recovery/conflict/save failure or
  unseen remote changes. Deduplicate identical inputs. Do not let debouncing
  create retained history or an unbounded queue.
- Bind results to active account/project/input/request and source generation.
  Suppress late results after edits, logout, restore, navigation or a newer job.
  Label the previous successful PDF as stale after source changes or failed
  compilation. Keep it downloadable with its actual revision clearly identified.
- Feed generated bytes to the existing PDF.js preview with page/zoom controls.
  Distinguish imported local PDFs from generated output. Add Download PDF for
  the exact displayed successful result and release URLs/resources on disposal.
- Add bounded diagnostics with file/line navigation in CodeMirror. Offer current
  diagnostics to the existing AI assistant through its existing consent flow;
  no automatic provider requests or provider changes.
- Pass the exact generated PDF bytes into the existing resume analysis flow
  through bounded in-memory state, clearing them on logout. Analyze those bytes,
  retain the exact PDF hash, and disclose browser-provided provenance. No claim
  that a client-reported source/PDF relationship is server-attested.
- Preserve source ZIP export, text/history recovery, keyboard access and the
  current desktop/mobile workspace layout.

## Phase 5: verification and delivery

Use pinned Node/pnpm and the existing lockfile. Prepare a separate real local
PostgreSQL test database using the available native tooling or Docker if its
engine becomes available. Never reset or repurpose user/development databases.

Run pnpm lint, pnpm typecheck, pnpm test, pnpm test:integration, pnpm test:e2e and
pnpm build. Add reproducible compiler asset verification and real-engine fixture
checks to scripts/CI. Tests must cover these observable guarantees:

| Area | Acceptance evidence |
| --- | --- |
| Real output | Both gate resumes, Unicode/fontspec, image/report references and all catalog templates compile; actual PDFs render and extract expected text. |
| Input integrity | Multi-file/main-file/assets use one captured revision; replacement/deletion races cannot mix source and asset bytes; stale input is rejected. |
| Resource recovery | Invalid TeX, unsupported packages, loops, load failures, cancellation and timeout terminate cleanly; the next job succeeds. |
| Isolation | Network/host bridges and per-job files cannot expose credentials or unrelated projects; no arbitrary public server compilation. |
| Preview/download | Downloaded bytes equal the successful result hash; stale/cancelled/older jobs cannot replace a newer preview; last success remains correctly labeled. |
| Data lifecycle | Asset routes enforce owner/origin/version/quota rules; retained snapshots and restores preserve bytes; old text snapshots remain readable; compilation works at the history limit. |
| Integration | Generated PDF analysis consumes the exact bytes; diagnostics navigate correctly; logout/project switching clears private runtime state. |
| Browsers/build | Production asset paths and required headers work; desktop/mobile UI remains usable. Measure Chromium/Firefox/WebKit where available and state the actually verified support matrix. |

Update README.md, ROADMAP.md, docs/part-0.md, docs/part-3.md,
docs/compiler-feasibility.md, docs/contracts.md, docs/architecture.md and template
compatibility documentation only to match demonstrated results. Correct stale
status summaries touched by this work without rewriting unrelated roadmap parts.

Deliver changed files, selected compiler/build/assets/licenses, measured
compatibility/performance/isolation evidence, exact check results, and remaining
host/account/device limits. Local checks do not complete hosted behavior. No
independent reviewer or subagent run is claimed.

## Primary references checked during planning

- [SwiftLaTeX engine API and documented limitations](https://github.com/SwiftLaTeX/SwiftLaTeX)
- [SwiftLaTeX repository license](https://github.com/SwiftLaTeX/SwiftLaTeX/blob/master/LICENSE)
- [SwiftLaTeX release history](https://github.com/SwiftLaTeX/SwiftLaTeX/releases)
- [Render Free behavior and staging limitations](https://render.com/docs/free)
- [Cloudflare Pages asset limits](https://developers.cloudflare.com/pages/platform/limits/)

These are candidate documentation, not evidence of successful compilation,
license compliance, no-card signup, account access or deployed behavior. Recheck
the selected assets and hosting plan during implementation.
