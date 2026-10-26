# Implementation plan: Part 4 verification, Parts 4–6 status, Part 5 validation

Prepared and approved 2026-10-26. **Status: complete for the agreed localhost /
desktop Chromium scope.** See
[validation-parts-4-6.md](validation-parts-4-6.md) for current results. The approved
plan below records the initial findings and intended scope.

Completion: all three catalog compile/edit/restore journeys and the assistant's
review/apply/compile/failure/restore journey pass. Both full development and built
browser suites pass all 22 cases without skips; 46 unit tests, all 8 PostgreSQL
integration suites, lint, typecheck, build and integrity checks pass. All six
live synthetic Groq cases pass with openai/gpt-oss-20b after the documented model
compatibility change. Parts 4–6 status records are reconciled. No migration,
runtime dependency, paid resource, deployment, commit or subagent was introduced.
Hosted CI execution and publication gates remain explicitly unverified.

## Objective and boundaries

Close Part 4's compiler-verification gap, reconcile the current status of Parts
4–6, and finish Part 5 validation for personal use on localhost / desktop Chromium.
Use the selected pinned BusyTeX/XeTeX browser route, Node 24.22.0, pnpm 10.34.7
and the existing lockfile. Work sequentially without subagents and preserve the
existing staged, unstaged and untracked changes.

Keep same-origin `/api` calls, server-only provider credentials, strict shared
contracts, immutable snapshots and optimistic concurrency. No deployment, paid
service, external account creation, product license change or new database is
planned. Use the existing separate TEST_DATABASE_URL and synthetic accounts;
never reset a user database. Part 7's broader audit and Parts 8–9 remain separate.

Compiler preparation downloads verified upstream assets into ignored local/CI
directories. Do not commit compiler binaries or upload them in CI artifacts.
Publishing assets retains the existing redistribution requirements.

## Confirmed findings

- Parts 1–3 have documented completion evidence for localhost / desktop Chromium.
- Both resume templates and the report already compiled in the local feasibility
  harness. Template copying, named history, source/asset comparison and
  transactional restore are implemented and have integration/browser coverage.
- The workflow in `.github/workflows/ci.yml` does not run `compiler:prepare`.
  Compiler browser tests skip when assets or the test database are missing. Thus
  the current workflow can pass without exercising real compilation.
- The benchmark covers all catalog templates, but its template assertions are
  sparse. A focused mandatory catalog check should verify meaningful extracted
  content, not merely a PDF header or generic heading.
- The AI browser journey verifies request, diff, apply and restore, using a local
  synthetic HTTP provider through the actual adapter. It does not compile the
  accepted result or exercise compile-failure recovery in that journey.
- `scripts/ai-live.ts` sends only one synthetic explanation. It does not establish
  rewrite/generation quality, selected-text preservation, question/diagnostic
  behavior or compilation of actual live edit proposals.
- Generated PDFs already enter resume analysis as exact bytes, with hash and
  Unicode evidence assertions. Older Part 6 compiler-blocker wording is stale.
- Parts 4–6 status paragraphs conflict with their newer integration updates.
  Historical records must be clearly labeled rather than presented as current.
- Development/test database configuration and prepared compiler assets are
  present. **No GROQ_API_KEY is configured, and AI sharing/live checks are off.**
  Presence checks did not disclose configuration values.

## Phase 1: close Part 4's verification gap

1. Add a focused catalog verification command/test using the existing compiler,
   PDF.js extraction and browser tooling. Reuse existing harness behavior where
   practical; avoid maintaining a second engine implementation or adding a
   dependency for test orchestration.
2. Cover every bundled template: `resume-classic`, `resume-compact`, and `report`.
   Verify template provenance/hash pins; compile real source with pinned engine
   assets; parse actual PDFs; assert identifying names/titles, contact text and
   meaningful sections. For the report, check nested inputs, bibliography and
   resolved contents/references after bounded passes. Normalize whitespace only
   as needed for stable text checks. Inspect rendered pages during local QA.
3. Reuse existing ownership/copy/history tests. Add only missing assertions
   needed to prove template copies remain independent and edited/restored copies
   still compile. Exercise the product compiler path as well as catalog checks.
4. Add an explicit required-check mode/preflight for CI. Missing or invalid assets,
   unavailable test database and missing catalog cases must fail required checks,
   rather than silently skipping compiler coverage. Ordinary optional local smoke
   checks may retain their documented behavior.
5. Update CI ordering: frozen install and browser setup, pinned compiler
   preparation, service readiness, then build and mandatory catalog/browser
   checks. Prepare assets before the production build. Run the relevant compiler
   and assistant journeys against the built app as well as development mode.
6. Keep CI output bounded: template/case IDs, outcome, page count and hashes.
   Keep diagnostic artifacts limited to synthetic test results. Exclude downloaded
   assets, secrets and user documents from artifact uploads.

Acceptance: all catalog templates produce valid PDFs with expected extracted
content; copy/edit/restore behavior passes; the workflow explicitly requires real
compiler coverage. Report local results separately from any actual hosted CI run.
Writing a workflow is not evidence that GitHub Actions has executed it.

## Phase 2: reconcile Parts 4–6 status

Update `ROADMAP.md`'s overview, detailed Part 4–6 entries, summary table and next
task together with `docs/part-4.md`, `docs/part-5.md`, `docs/part-6.md` and affected
README wording. Clearly separate current status, remaining acceptance work and
historical verification records. Make only directly related supporting-doc fixes.

- Part 4: record the catalog/compiler checks actually demonstrated and CI wiring;
  disclose whether hosted CI execution remains unobserved.
- Part 5: remove the obsolete local compiler blocker. Initially retain the live
  validation gap, then finalize status after Phase 3 evidence is available.
- Part 6: record uploaded/generated exact-byte analysis and current evidence;
  retain extraction/font/reading-order limitations. Do not imply OCR, AI requirement
  extraction, employer ATS scoring or broad browser support exists.
- Keep hosted auth/email, Neon access, host selection, redistribution and broader
  devices as separate publication gates. They do not block the accepted local
  compiler route.

Mark a part complete only against its applicable acceptance criteria. Any
unresolved rubric/coverage gap found during this review stays explicit. Keep
independent review pending; this task does not authorize delegation.

## Phase 3: finish Part 5 validation

### Deterministic product workflow

Extend the existing test-only HTTP provider and browser tests to demonstrate:

1. Start with a synthetic project/template and compile a known-good baseline.
2. Request an edit, inspect its diff and explicitly apply it. Compile the changed
   source and inspect the generated PDF for the expected visible change; a
   comment-only response is insufficient for this assertion.
3. Request a deliberately broken synthetic edit, apply it, show real compiler
   diagnostics and retain the previous successful preview with a stale label.
4. Pass bounded real diagnostics through the existing consent flow; verify that
   explanation mode proposes no edits. Restore the safety snapshot and compile
   successfully again.
5. Verify rejection changes nothing, and verify a later manual edit prevents a
   stale apply or quick restore from overwriting new work. Reuse existing
   transaction/ownership/quota tests instead of duplicating them unnecessarily.
6. Retain coverage for provider refusal, malformed/truncated output, quota errors,
   timeout/interruption and atomic failure. Add coverage only where a requirement
   lacks meaningful evidence.

Fix narrowly scoped defects discovered by these checks. Production must retain
no synthetic-provider switch. Preserve sharing consent and privacy-safe errors.
No schema migration or new runtime package is expected; document any necessary
contract change in `docs/contracts.md` before implementing it.

### Opt-in live provider validation

Approval of this plan authorizes bounded requests containing original synthetic
fixtures only, using the user's configured eligible Groq Free account. A key must
be supplied through the local environment or ignored `.env`, never chat or Git.
Account eligibility and data controls require the user's confirmation; a key
alone does not prove free-tier status. Do not create an account, upgrade a tier,
retry automatically or switch to a paid fallback.

Before the live run, check official provider documentation for the configured
model, JSON-output support, current free limits and data controls. Preserve the
current model unless a demonstrated compatibility issue requires a documented
free alternative within this scope.

Expand `test:ai:live` into a bounded synthetic matrix covering explanation,
project questions, selected rewrite, generation and compile-diagnostic assistance.
Use at most six live requests per invocation, sequentially, within existing
context/output/deadline limits; stop on authentication, quota or transport failure.
Keep live calls excluded from normal tests and CI.

Validate structure and targets, require edit modes to make the requested visible
change, preserve source outside selected rewrites, and compile actual accepted
live edit proposals using the pinned browser compiler. Review answers against
explicit synthetic facts, including requests for missing facts instead of invented
resume achievements. Do not infer general model quality from this small sample.
Record model/prompt versions, case IDs, pass/fail, latency, usage when available,
and compiler/PDF hashes. Omit response bodies and credentials from routine logs.

**Live prerequisite:** no key is currently configured. All independent work can
proceed after approval, but successful live validation cannot be claimed until
eligible access is supplied and the checks pass. If access remains unavailable,
finish the harness/local workflow and report the exact remaining Part 5 blocker.

## Phase 4: final verification and handoff

Use the pinned runtime and frozen lockfile. Run:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration` against the existing separate real PostgreSQL database
- `pnpm compiler:prepare` and the new mandatory catalog verification command
- `pnpm test:e2e` with real database, local Mailpit and prepared compiler assets
- `pnpm build` followed by `pnpm test:e2e:built`
- The explicitly enabled live matrix when its prerequisites are satisfied
- `git diff --check` and inspection that only intended files were changed

Verify that required compiler/assistant cases ran without skips. Start needed
local test services with bounded readiness checks and clean up only test-owned
resources. Inspect representative generated PDFs and the assistant/error/restore
screens. Document exact commands, outcomes and any unavailable checks.

Finalize roadmap statuses from that evidence. Hand back changed files, validation
results, remaining local or publication limitations, and whether Part 5's live
validation actually passed. Preserve unrelated work; do not commit or deploy.

## Expected edit areas

- `.github/workflows/ci.yml`, root scripts in `package.json`, Playwright setup
- `scripts/compiler-feasibility.ts` or a focused catalog-check script
- `scripts/ai-live.ts`, `scripts/e2e-api.ts`, relevant browser/integration tests
- Narrow compiler/assistant fixes only if demonstrated by failed acceptance checks
- `ROADMAP.md`, `README.md`, `docs/part-4.md` through `docs/part-6.md`, relevant
  setup/contract notes and this plan's completion record

The user approved this plan and supplied a key on 2026-10-26 before implementation
began. It was used only in the validation process environment, not saved to files.
