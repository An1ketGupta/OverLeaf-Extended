# Part 1: accounts and project/file management

**Complete locally, 2026-10-25**, for personal use on localhost / desktop Chromium.
Hosted authentication, real mailbox delivery, public registration and Neon access
remain separate gates.

## Use locally

Use Node 24.22.0 / pnpm 10.34.7 and the existing PostgreSQL setup. Apply checked-in
migrations with `pnpm db:migrate`; this part reuses the existing schema and adds no
migration. Keep development and test database URLs separate.

Set `AUTH_ALLOW_SIGNUP=true` and `MAIL_ENABLED=true` in the local root `.env`.
`MAIL_PORT=1025` is the default. Start `pnpm mail:start` in another terminal, then
start/restart `pnpm dev`. Open `/account` (the old `/auth-check` path also works).
The inbox is at http://127.0.0.1:8025. Verification/reset mail stays in this local
inbox and is never delivered to real recipients.

`mail:start` prepares the pinned native tool when absent. `pnpm mail:prepare`
prepares it explicitly. Native Windows/Linux x64 are supported by the helper;
`docker compose -f infra/compose.yaml up -d mailpit` is an alternative. Both mail
ports bind to loopback. Stop the native inbox before using Docker on the same ports.
No external account, payment card, trial or subscription is needed.

Create an account, follow the verification link in the inbox, then sign in.
Existing unverified local accounts use **Send verification email** without losing
projects. Existing unverified sessions cannot access private project/report routes.
Use **Forgot password?** to request a link, follow it and enter/confirm a new
password. Successful reset revokes every old session; sign in with the new password
to recover drafts from the same account/tab. Reset is not a logout broadcast that
deletes recovery copies. Normal sign-out still clears private drafts across tabs.

Verification/reset links expire after one hour. Reset links are single use;
verification replay is harmless and does not sign anyone in. Reset tokens are
removed from the current URL once loaded; reopening the emailed link is necessary
after refreshing that form. Unknown-account and transport-failure replies stay
generic. If no message arrives, check/start the inbox and resend. Sends are bounded
process-local work with shutdown drain, not a durable queue or guaranteed delivery
across API restarts. The server logs only a generic delivery failure notice.

## Project and file operations

The dashboard and workspace offer project rename/delete. Deleting a project
requires typing its current name, offers export/download first, and rejects a
changed project revision. Deletion permanently removes its files, images, history,
snapshot labels and AI proposals. Independently saved resume reports remain in
the account. Dashboard recovery drafts require saving in the workspace or an
explicit discard decision before deletion.

The file tree offers rename/delete for each source file. **Main file & images**
offers asset rename/delete, bounded uploads and main-file selection. Rename keeps
the ID, increments its optimistic version and preserves bytes/hash. Main-file
rename updates its path atomically; its new name must end in `.tex`. Choose another
main source before deleting it. File/asset paths share a collision-checked namespace;
paths inside LaTeX references must be edited manually after a rename.

Every file/image delete first preserves the complete saved tree as an immutable
snapshot in the same transaction. Use **History**, compare the pre-delete revision
and restore it to recover exact bytes. At history quota, deletion stops if it
cannot preserve that revision. Existing snapshots can be reused at the quota;
history is never silently pruned. Project deletion remains available at quota.
Deleting a live file does not erase its bytes from retained history.

Structural operations pause typing/autosave, await in-flight saves, flush other
buffers and check the fresh server tree before proceeding. Failed saves/conflicts
stop the action; selecting discard explicitly permits deleting only that target's
unsaved work after the server acknowledges success. Native dialogs trap focus,
support Escape/cancel, prevent duplicate submissions and restore focus on close.
App links and browser Back protect unsaved buffers with save/download/stay/discard.
Refresh/close retains the native warning and 24-hour tab recovery limits.

Cross-tab messages contain IDs only. Focus/visibility/reconnect also revalidate
ownership, session and project contents. Remote rename/edit produces a review
notice instead of replacing dirty source. A remote project deletion disables
saving/compilation while retaining text for download. After refresh, drafts whose
file/project no longer exists appear in an account-gated recovery list; they cannot
recreate deleted IDs. Session loss hides private editors; switching accounts or
logging out retains the documented cleanup rules. Other tabs' unsaved text cannot
be saved or guaranteed durable by a deletion in this tab.

Compiler jobs/output are invalidated by structural changes. Late saves or
compiles cannot resurrect deleted state or erase retained recovery data after
deletion/session loss. Selecting a new main file opens it in the editor. Existing
local compilation, actual PDF export/analysis, history and AI flows remain intact.

## Implementation and dependencies

Shared strict mutation DTOs live in packages/contracts; transaction/ownership and
cascade behavior live in packages/db. The API owns email/auth configuration.
Browser code imports no database or SMTP code and reaches only same-origin `/api`.
Auth's Drizzle adapter enables transactions for token/session/password atomicity.
Unexpected library errors propagate to the sanitized Fastify handler to avoid
the dependency's raw console fallback. Queries and reset-token URL paths are
redacted; lifecycle pages and API responses use no-referrer.

The new SMTP runtime dependency is Nodemailer **10.2.1**, **MIT-0**, including its
own TypeScript declarations. Its version is exact in pnpm-lock.yaml.
Mailpit **v1.32.0**, MIT, is an external development/test tool, downloaded into
ignored `.cache`; no tool binaries are committed. Source/license:
[Mailpit v1.32.0](https://github.com/axllent/mailpit/tree/v1.32.0) and
[Nodemailer 10.2.1](https://github.com/nodemailer/nodemailer/tree/v10.2.1).
The native helper verifies these upstream release archive SHA-256 values:

| Asset | SHA-256 |
| --- | --- |
| mailpit-windows-amd64.zip | `16915767a6c95dca569336e8f561f91cf355e9a33c57b91deedcc10a4bba7fd4` |
| mailpit-linux-amd64.tar.gz | `4b5993c978e8604c70d43927e2ad103b311bba3b1822fa0cf1d4ee4ec890a93c` |

Mail forwarding/relaying is not configured; ambient `MP_*` settings are excluded
by the native helper. The Docker alternative pins the release tag. Dependency
licenses remain their own obligations; the product's license is unchanged.

## Verification

The test setup uses real native PostgreSQL and the separate TEST_DATABASE_URL,
the actual loopback SMTP inbox and prepared real compiler assets. It removes only
synthetic users/messages and never resets a database. Password-write failure is
injected with a temporary trigger scoped to the synthetic user in the test database;
the trigger/function are removed in finally. This proves rollback retains both
the reset token and active sessions, rather than merely inspecting the config.

| Check | Completion result |
| --- | --- |
| pnpm lint | Passed; 114 checked files, no fixes needed |
| pnpm typecheck | Passed root and all workspace packages, including Nodemailer's bundled declarations |
| pnpm test | Passed; 46 tests in 10 files |
| pnpm test:integration | Passed; all 8 suites including verification/reset, injected reset rollback/log privacy and lifecycle/cascade/races |
| pnpm test:e2e | Passed; all 18 Chromium journeys, no skips, including real compilation and 5 new lifecycle journeys |
| pnpm build | Passed API/shared checks and Vite static build |
| pnpm test:e2e:built | Passed all 18 Chromium journeys, no skips, through the locally served production build |
| Visual review | Desktop/mobile deletion dialogs and account view inspected; no horizontal overflow |

Browser tests use API port **3101** and frontend **5273**, leaving normal
development ports 3001/5173 free. Start `pnpm mail:start` first; CI supplies a local
Mailpit service. Tests follow messages actually received by SMTP, not a debug token
endpoint. Unit tests cover paused buffers, late acknowledgements after deletion or
session loss and existing draft/save guarantees. PostgreSQL tests cover concurrent
reset redemption, expiry, revoked sessions, rollback, untrusted redirects, resend/
reset rate limits, SMTP outage privacy, foreign/mismatched IDs, save/rename/delete
races, main-file constraints, immutable deletion backups, restore, retention
rollback, dependent-row cleanup and released storage quota.

Browser coverage includes dirty rename, failed-save deletion then explicit discard,
main-file deletion denial, snapshot recovery, another tab's remotely deleted project
and orphan recovery after refresh, Back/app navigation, actual email verification/
reset and post-reset draft recovery, stale dashboard confirmation and recovery-draft
protection. Existing compiler/PDF/history/assistant/resume tests remain part of the run.

Checks are local evidence. Hosted proxy/cookie/CDN behavior, real inbox delivery,
other browsers/devices and the CI job itself have not been executed or established
by these checks. Review was by the implementing agent; no subagent or independent
reviewer was used. No deployment or paid resource was created.
