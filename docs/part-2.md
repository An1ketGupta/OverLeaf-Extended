# Part 2: editor workspace and autosave

Current update (2026-10-25): Part 1 lifecycle/management and Part 3 compiler flows
are complete for localhost. Use `/account` with the local verification inbox; see
[Part 1](part-1.md) and [Part 3](part-3.md). The older implementation evidence below
describes the original Part 2 scope.

## Historical editor-only delivery record

The compiler and Part 1 blockers below describe the original editor-only milestone.
They are superseded by the current update above and Parts 1/3/7 local evidence.

Local implementation complete. The workspace uses real authenticated PostgreSQL
storage. Part 0 hosted authentication, Neon eligibility, and compiler feasibility
remain open. Part 1 is only partially implemented to supply the required project
and file persistence; this work does not complete its account lifecycle, full CRUD,
assets, snapshots, or restore requirements.

## Use the workspace

Follow README.md using Node 24.22.0 / pnpm 10.34.7. Configure the development
database and AUTH_SECRET, then run `pnpm db:migrate` before starting the app.
Enable AUTH_ALLOW_SIGNUP only for synthetic local development accounts. Sign in
at `/auth-check`, follow Open your projects, and create a project at `/projects`.
Each new project has `main.tex` and `sections/notes.tex`. This is editable source,
not a verified compiler template. Hosted/public registration remains disabled.

The workspace at `/projects/:projectId` includes:

- A collapsible directory tree, path filtering, bounded text-file creation, tabs
  with independent CodeMirror history/selection, and source downloads.
- CodeMirror 6 with its pinned stex mode, verified command/comment/math tokens,
  LaTeX command snippets, undo/redo, find/replace, line wrapping and line numbers.
  Highlighting is not semantic compilation or a guarantee of package support.
- File/editor/PDF dividers with pointer dragging and keyboard arrows/Home/End.
  Narrow screens switch between Files, Source and PDF preview without discarding
  editor state. Escape then Tab leaves the editor; tab arrows preserve tab focus.
- Ctrl/Cmd S to save, Ctrl/Cmd F to find, Ctrl/Cmd Shift F for the same source
  search, Ctrl/Cmd P to filter file paths, and Ctrl/Cmd Space for completion.
- A 700 ms save debounce, immediate save before switching/closing files, visible
  save states, explicit retry after failure, and retry on browser reconnect.
  Each file has at most one save in flight. Typing during a request is saved next
  against its acknowledged version. Network timeouts are bounded to 12 seconds.
- Explicit 409 review: display the current saved file beside the retained draft,
  download either working draft, rebase and save the user's text over the reviewed
  version, or explicitly discard it. A further competing edit still conflicts.
  An acknowledgement lost after a successful write may require this review.

## Private drafts

Every edit is copied synchronously to account/project/file-scoped sessionStorage.
Source is never put into localStorage, a bearer token, a URL, or application logs.
Session storage is readable by scripts on this origin and users of the same
browser profile; it is not encrypted storage. The UI explains this lifecycle.

Drafts are eligible for recovery for up to 24 hours within this tab. Expired copies
are removed on the next project load. Refresh offers recover/download/discard
before editing. Recovery compares the original base version; stale drafts enter
conflict review. A saved acknowledgement clears the matching recovery copy. An
unavailable/full store raises a warning to keep the tab open or download source.
Closing the tab ends normal recovery; browser session restoration can retain it.
Abnormal browser/OS termination cannot be guaranteed to preserve unsaved text.

Sign-out clears recovery copies, hides/unmounts editors, and broadcasts deletion to
other open tabs. A timestamp-only logout marker in localStorage also invalidates
older drafts when a suspended/restored tab is reopened. Storage-disabled browsers
cannot provide that durable marker; active-tab broadcasts still apply. Loading a
different account removes mismatched recovery copies. An expired session hides the
editor and requires signing in again as the same account to recover its draft.

## Compiler and preview boundary

`compiler.ts` defines the adapter using the existing strict CompileRequest and
CompileEvent types. Its only configured adapter is unavailable. Recompile is
disabled with a visible explanation. There is no TeX execution, compiler download,
worker runtime, fabricated PDF, or selected engine. Part 3 must implement the route
proven in Part 0A and stale-result/cancel/timeout handling before enabling it.

PDF.js is loaded on demand and uses its bundled, pinned worker. Open PDF reads
actual local bytes, checks a PDF header and the 5 MiB limit, and renders one page
at a time with fit/zoom and page navigation. Preview is capped at 20 pages and
8 million rendered pixels per page. Password-protected and malformed files show
errors. Replacement, zoom, page changes and unmount cancel rendering and destroy
loading tasks. Uploaded bytes remain local and are explicitly labelled as unrelated
to compiled project output. There is no PDF extraction/scoring claim, text layer,
OCR, or full accessible PDF reader here; embedded fonts may fall back to system
fonts. Use a dedicated reader when document accessibility or fidelity requires it.

## Persistence and contracts

`0001_lean_talisman.sql`, its generated snapshot, and journal add `project` and
`project_file` tables. Ownership cascades from the auth user. All operations first
validate the session; every project/file query is scoped to the owner. Private
responses and renewal cookies retain the existing no-store/auth integration.
Readiness now probes the project tables so missing migrations fail readiness.

The minimum HTTP surface is documented in contracts.md. Schema validation lives
in packages/contracts; the database recomputes SHA-256. Saves compare/increment
versions inside transactions that lock the parent project. Consistent reads and
quota checks use the same lock. Limits: 100 projects/account, 50 text files/project,
256 KiB UTF-8/file and 8 MiB/project. No uploads/assets or compiler storage are added.
Null bytes and malformed Unicode are rejected because they cannot round-trip
through PostgreSQL text. JSON transport allows escaping overhead separately from
the decoded content limit. Browser modules import no database/auth server code.

## Verification

Verified locally on Windows with pinned Node/pnpm and native PostgreSQL 17.10,
using only the separate `overleaf_pro_test` database on loopback port 55432.
Migrations run twice; tests delete only their synthetic users and cascading projects.
No database is reset. The development database is not modified by these tests.

| Check | Result |
| --- | --- |
| pnpm lint | Passed |
| pnpm typecheck | Passed |
| pnpm test | 23 tests passed, including save ordering, offline retry, conflict/recovery, draft privacy/logout/TTL, storage failure and LaTeX syntax/completion |
| pnpm test:integration | Real PostgreSQL auth checks plus project isolation, concurrent stale writes, stored bytes/hashes, path/size/count bounds, origin checks, migration idempotence and logout |
| pnpm test:e2e | 6 Chromium tests passed for actual authenticated projects, autosave, file switches, refresh/reconnect, conflict resolution, cross-tab logout, search/completion/shortcuts, panel resizing, mobile overflow and real local PDF rendering/error handling |
| pnpm build | Passed; editor and PDF.js are split into lazy-loaded chunks |
| Visual checks | Desktop and 390 px mobile screenshots inspected |

Hosted Vercel/Render/Neon behavior, other browsers/devices, compiler compatibility
and independent security review remain unverified. No subagent was used. No
external deployment, paid resource, or public compiler endpoint was created.
