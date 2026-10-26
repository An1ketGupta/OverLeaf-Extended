# Part 6 progress — 2026-10-20

**2026-10-24 integration update:** generated compiler PDFs now enter analysis as
the exact in-memory bytes. Browser tests compare the downloaded PDF hash with
the extraction's hash and verify Unicode text evidence; both development and
built localhost runs passed. Browser/source provenance remains explicitly
unattested. See part-3.md. The original record below describes the upload-only
milestone before local compiler acceptance.

Uploaded-PDF analysis, deterministic job-term matching, and optional private
reports are implemented. Analysis of integrated compiler output remains blocked
by Part 0A. Hosted account behavior and broader PDF/font coverage remain release
validation work; Part 6 is not declared fully complete.

Open **Analyze resume PDF** from a saved workspace or the home page (`/resume`).
Choose a real PDF, up to 5 MiB and twenty pages. SHA-256 is computed from the
original bytes. A dedicated worker uses the pinned PDF.js 6.4.299 parser through
an explicit child-worker port, streams text chunks, and returns bounded text with
page/line numbers and normalized x/y locations. Limits are 20,000 text items,
100,000 extracted characters, and a fifteen-second deadline. Cancel, file changes,
navigation and worker errors terminate extraction. PDF headers, malformed input,
encrypted PDFs, excess pages and oversized extraction are checked. OCR is absent.
No scripts, PDF actions, attachments or external links are executed by this flow.

Text evidence buttons navigate to the relevant PDF page. Coordinates are shown
as percentages; they are extraction locations, not a visual highlight/selection.
All extracted text is inspectable alongside the local PDF. Reading order,
columns, hidden text, ligatures and font mappings can distort extraction. Font
coverage and extraction on arbitrary documents are not guaranteed. The current
fixture set tests actual clean/empty/malformed/encrypted/over-page PDFs in Chromium;
non-ASCII names, column warnings, missing sections, partial/garbled extraction and
injected instructions are additionally covered through deterministic line fixtures.

`packages/resume` supplies real shared behavior to browser and API. The API
recomputes rules rather than accepting client-supplied findings or scores.
`pdfjs-6.4.299-lines-v1` identifies extraction and `resume-rules-v1` identifies the
deterministic rubric. Weights sum to 100:

| Detected text structure | Contribution |
| --- | ---: |
| Email contact pattern | 15 |
| Phone pattern (10–15 digits) | 10 |
| Experience heading | 20 |
| Education heading | 15 |
| Skills heading | 15 |
| Date patterns | 10 |
| Bullet structure | 15 |

This is our compatibility/completeness estimate, not an employer's ATS score,
parser simulation, qualification verification, or hiring probability. English
heading patterns and contact/date patterns have false positives/negatives.
Not detected means no evidence in extracted text, not a fact about the person's
qualifications. Text with fewer than eighty letters, decoding errors, or any page
without extracted letters receives unknown checks and no estimate. Unsupported
extraction never creates missing-qualification findings or a fabricated score.
Visual design, proficiency, chronology and factual truth remain uncheckable.

Users enter up to thirty required/preferred terms or exact phrases, each up to
120 characters. These normalized requirements persist with saved reports. Word
boundaries avoid Java/JavaScript and C/C++ errors. Explicit aliases cover
JavaScript/JS, TypeScript/TS, Node.js/NodeJS, React.js/ReactJS/React, and
PostgreSQL/Postgres. Repeated keywords add no credit. Required/preferred evidence
coverage is separate from the compatibility estimate; phrase matches cannot
establish years of experience, seniority, or semantic fulfillment of a sentence.
There is no AI requirement extraction or advice provider in this flow, so no model
or prompt versions are asserted. Writing suggestions ask for verified outcomes
and missing metrics instead of inventing resume facts. Editing requirement fields
does not change the analyzed or saved result until Update analysis is requested.

Analysis works locally without login or AI. **Save private report** requires a
session and uploads extracted text and the exact analyzed requirement set, not
PDF bytes. Reports store the exact PDF hash, extraction/rule versions and an
explicit `client-provided-extraction` label. A malicious browser can fabricate
extraction/hash claims; they confer no attestation, ownership or billing authority.
The API validates bounds, page/line references and duplicate evidence identities,
then derives all findings from that extraction. Limits are twenty reports and
8 MiB logical serialized report data/account. Load/delete are owner-authorized;
another owner's ID returns 404. Account deletion cascades reports.

A saved report only replaces the visible analysis when the open PDF hash matches.
Otherwise Open report downloads the saved JSON for inspection and asks for the
matching PDF. Report deletion does not erase the local analysis. Logout clears
private report state and guards late responses. Reports are immutable; rerunning
analysis or changing advice cannot silently rescore an earlier report.

## Verification actually run

Typecheck, build, forty unit tests, five PostgreSQL integration scripts and eleven
Chromium E2E tests passed on the pinned runtime. The extraction/matching/unsupported
PDF journey also passed against Vite's production build, validating deployed asset
paths locally. Desktop/mobile screenshots were inspected with no horizontal
overflow at 390px. Repository-wide `pnpm lint` and targeted Biome checks passed.
Hosted behavior, OCR, arbitrary font coverage and integrated compiler output
remain unverified.
