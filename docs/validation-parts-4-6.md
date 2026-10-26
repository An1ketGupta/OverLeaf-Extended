# Parts 4–6 local verification — 2026-10-26

Scope: personal project on localhost / desktop Chromium, pinned Node 24.22.0 and
pnpm 10.34.7. Tests use the existing separate real PostgreSQL test database and
loopback Mailpit. Only synthetic accounts/documents are created and cleaned up.
No development/user database was reset, schema pushed, host deployed, account
created, paid plan selected or product license changed.

## Changes and acceptance evidence

- Part 4: compiler/template provenance checks, required CI preflight and three
  catalog journeys. Each compiles/inspects baseline, edited and restored PDFs,
  checks an independent copy, and exercises named snapshots/diff/restore.
- Part 5: the browser journey covers reviewed/rejected edits, a visible accepted
  PDF change, actual compile failure and retained stale preview, consent-based
  diagnostic explanation, successful restore/recompilation and refusal to quick
  restore over later manual work. Existing PostgreSQL checks cover stale apply,
  multi-file atomicity, ownership, quota rollback and interrupted requests.
- Applying/restoring assistance now uses the guarded project mutation flow and
  updates saved buffers without a page reload. Pausing an atomic mutation cancels
  compilation while retaining the previous PDF; session/project loss still clears
  private output. Textareas have stable accessible names when requests are reused.
- Part 6: existing uploaded/generated exact-byte analysis, Unicode/hash checks,
  deterministic evidence/matching and private report checks remain. Catalog and
  assistant tests inspect actual compiled PDFs through the same analysis flow.
- No schema migration, shared DTO or runtime dependency was required. Source,
  compiler, snapshot and report authenticity boundaries remain unchanged.

## Commands and outcomes

| Check | Result |
| --- | --- |
| pnpm compiler:prepare | Passed; existing pinned downloads verified and local assets prepared |
| pnpm compiler:verify | Passed; engine/glue/runtime/shards/worker and complete template/license pins |
| pnpm lint | Passed |
| pnpm typecheck | Passed root and all workspace packages |
| pnpm test | Passed; 46 tests in 10 files |
| pnpm test:integration | Passed all 8 suites against separate real PostgreSQL and local SMTP |
| Catalog browser checks | All 3 passed baseline/edit/restore compilation and real PDF text checks |
| Assistant compiler browser check | Passed review/reject/apply/failure/diagnostic/restore/later-edit journey |
| pnpm build | Passed; prepared compiler assets included in local static build |
| REQUIRE_COMPILER_TESTS=true pnpm test:e2e | Passed all 22 Chromium journeys, no skips; 4.3 minutes |
| REQUIRE_COMPILER_TESTS=true pnpm test:e2e:built | Passed all 22 Chromium journeys, no skips; 3.7 minutes |
| Opt-in pnpm test:ai:live | All 6 cases passed; details below |
| Required setup negative checks | Missing test database and missing compiler assets both fail before service/browser checks |
| CI configuration checks | YAML parsed; preparation precedes build; catalog and remaining selections cover 3 + 19 development tests |
| Visual QA | Inspected both one-page resumes, all 5 report pages, both live-generated one-page PDFs, and failure/recovery screens |
| git diff --check | Passed |

Initial verification found a marker hyphenated by LaTeX across PDF lines; the
synthetic edit now starts a separate paragraph. Reusing the assistant exposed an
unstable implicit textarea label; explicit accessible names resolved the locator
failure. These findings were fixed before final regression runs.
Existing PDF.js standard-font-data warnings occurred in synthetic development
fixtures; their extraction assertions passed. General font coverage remains
limited and is not inferred from those results.

## Live synthetic provider run

The first attempt stopped at the explanation request with the former configured
Llama model. A read-only model-list check authenticated the supplied key but did
not list that model. Current [Groq model documentation](https://console.groq.com/docs/models)
lists it as enterprise; the chosen replacement appears in Groq's
[Free plan limits](https://console.groq.com/docs/rate-limits).

After the explicit compatibility change to **openai/gpt-oss-20b**, one six-request
matrix passed at 2026-10-26T10:25:40Z. No automatic retries or paid fallback ran.
The key was injected only into that process's environment, stripped from the
browser-server environment, and never saved to a project file or Git.

| Case | Outcome | Case duration, including compilation where applicable | Input/output tokens |
| --- | --- | ---: | ---: |
| Explanation | Correct section/heading explanation; no edits | 648 ms | 353 / 132 |
| Project question | Supplied TypeScript fact; no edits | 513 ms | 355 / 69 |
| Selected rewrite | Exact selected replacement, unchanged surrounding bytes, compiled expected PDF text | 7,232 ms | 394 / 740 |
| Generation | Added requested Projects content, preserved skills, compiled expected PDF text | 6,312 ms | 375 / 158 |
| Actual diagnostic | Explained undefined command from real compiler output; no edits | 676 ms | 421 / 140 |
| Missing facts | Requested measurement evidence instead of inventing a percentage; no edits | 504 ms | 368 / 72 |

Model/prompt: openai/gpt-oss-20b / latex-assistant-v1. Compiler build:
busytex-tl2025-0ee2c65fb1ab. Exact resulting PDF hashes:

- Selected rewrite: 851b3aaa727b816e4b2851ddc4e7a11d3133f643113c03bf43cb2dc2f0f101e0
- Generation: b7489c704688f20b7f1b194198ee0fdbb45698f179c77220f467755aaa33a0d5

The ignored .cache/ai-live directory contains bounded result metadata, synthetic
answers for manual review and generated fixture PDFs. Response bodies are omitted
from routine output. No user documents were sent. These six examples do not prove
general model quality or real-document factual correctness. Account billing and
data-control settings were not independently inspected; a key is not attestation
of those settings. See [Groq data controls](https://console.groq.com/docs/your-data).

## CI, publication and remaining scope

CI now prepares/validates compiler assets before building, runs the full browser
suite, and checks compiler/template/assistant journeys against the built app.
Missing prerequisites fail required setup. Failure uploads contain only synthetic
screenshots/PDFs/error context; traces may contain compiler binaries and stay local.
The configured GitHub-hosted workflow itself has not been observed executing.

Hosted routing/auth/CDN/email, Neon access, host eligibility, compiler notices and
redistribution, broader browsers/physical devices, arbitrary PDF/font coverage,
OCR and optional AI requirement extraction remain outside this local milestone.
The implementing agent performed this validation; no independent reviewer or
subagent was used. Part 7's broader recovery/security/accessibility/backup work
remains the next roadmap task.
