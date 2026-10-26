# Implementation plan: Part 1 accounts and project/file management

Prepared and approved 2026-10-24. **Status: completed for localhost / desktop
Chromium, 2026-10-25.** Evidence is recorded in [part-1.md](part-1.md).
The approved plan below preserves the implementation scope. Public deployment
and real email delivery retain their separate gates.

## Objective and boundaries

Finish Part 1 for the agreed personal-project, localhost, desktop Chromium scope:
manage private projects/files safely, complete locally delivered email verification
and password recovery, and demonstrate cleanup, ownership and concurrent edits.

Retain the selected browser compiler, same-origin `/api` boundary, strict shared
contracts, immutable snapshots and server-computed hashes. Use Node 24.22.0,
pnpm 10.34.7 and the existing lockfile. Preserve all existing staged, unstaged and
untracked work. Work sequentially without subagents.

Public registration/deployment, external email delivery, Neon eligibility and
compiler publication/device checks retain their separate gates. This plan adds
no paid service, external account, public compiler or product license change.
Self-service account deletion and email-address changes are outside this task;
account-deletion cascades will still be verified using synthetic test accounts.

## Findings from the current implementation

- Project creation/list/read, source creation/save, ownership, quotas and stale
  file-save rejection already exist.
- Main-file selection, bounded image/PDF assets, full source/asset snapshots,
  named history, transactional restore, source export and local compilation
  already exist. The Part 1 roadmap paragraph still lists some of these as pending.
- Project rename/delete and source-file rename/delete are absent. Asset deletion
  exists; asset rename and deletion confirmation/recovery need integration.
- Better Auth 1.7.12 supports the required lifecycle, but `auth.ts` supplies no
  email callbacks and does not require verified email. `/auth-check` remains a
  synthetic-account prototype. Existing users may have `emailVerified=false`.
- The Drizzle auth adapter currently leaves transaction support disabled. The
  installed reset implementation can consume a token, revoke sessions and change
  a password in one transaction when this is enabled.
- Workspace buffers already serialize saves and retain drafts on errors/conflicts.
  Recovery uses account-scoped sessionStorage and cross-tab logout invalidation.
  Missing-file drafts are not offered by the current model, which only loads
  buffers for files still on the server.
- Explicit workspace exit saves buffers; refresh has a beforeunload warning.
  Structural changes and all navigation paths need one consistent guard.
- Project foreign keys already cascade files, assets, snapshots, snapshot names
  and AI proposals. Saved resume analyses belong to accounts independently of
  projects. These distinctions must be tested and explained in deletion UI.
- Logging strips query strings, but password-reset callbacks put tokens in the
  URL path. Redaction must cover those paths as well.
- Existing integration and browser tests cover ownership and basic save conflicts;
  they do not establish the complete recovery/deletion lifecycle requested here.

## Phase 1: define contracts and mutation guarantees

Extend `packages/contracts` and `docs/contracts.md` before implementation. Reuse
existing API conventions and Better Auth's native lifecycle endpoints rather than
introducing a second authentication protocol.

| Operation | Proposed request | Result |
| --- | --- | --- |
| Rename project | `PUT /api/projects/:id` with `{baseRevision,name}` | Updated project |
| Delete project | `DELETE /api/projects/:id` with `{baseRevision}` | 204 |
| Rename source file | `POST /api/projects/:id/files/:fileId/rename` with `{baseRevision,baseVersion,path}` | Updated project |
| Delete source file | `DELETE /api/projects/:id/files/:fileId` with `{baseRevision,baseVersion}` | Updated project |
| Rename asset | `POST /api/projects/:id/assets/:assetId/rename` with `{baseRevision,baseVersion,path}` | Updated project |

Retain content-save DTOs and existing asset replace/delete routes. Add
`baseRevision` to source-file creation and update every caller/test so structural
writes consistently reject an unseen project revision. Project list summaries
will include their revision for dashboard actions; confirmation reads a fresh
project and pins its revision rather than silently accepting later changes.

All new requests use strict Zod validation, owner-scoped IDs, trusted Origin,
private/no-store responses and existing error envelopes. Invalid input returns
400, absent/foreign resources 404, and stale tokens/path collisions 409.
Authenticate and authorize before exposing resource state.

Use the existing account-then-project lock order where both locks are needed.
Compare tokens and perform changes in one transaction. Successful renames advance
the project revision; file/asset rename also advances its version while preserving
its ID and bytes/hash. A stale content save must not undo a rename.

Apply existing normalized-path, size and shared text/asset namespace rules,
including traversal, duplicate paths and file/directory collisions. Renaming the
main file updates `mainFile` atomically and requires a `.tex` destination. Deleting
the main file is blocked until another existing `.tex` file is selected. The project
must always retain a valid main source file. Paths inside LaTeX commands are not
rewritten automatically; explain that references may need editing.

## Phase 2: persistence and deletion policy

Implement repository operations in `packages/db` and thin HTTP adapters in
`apps/api`. Reuse existing foreign keys and tables; add a migration only if a
demonstrated schema gap requires one. Any migration includes SQL, generated
snapshot and journal together.

- Before source-file or asset deletion, capture/reuse an immutable snapshot of
  the current complete saved tree in the same transaction. If preservation fails
  or history quota is exhausted, roll back deletion and show the reason.
- File/asset deletion removes the live object and advances the project revision.
  History deliberately retains old bytes for recovery; clarify that this does
  not erase the file from historical snapshots.
- Project deletion is permanent after explicit confirmation and an opportunity
  to export/download work. It does not create a backup inside the project being
  deleted. Cascade all its files, asset bytes, snapshots, labels and proposals.
  Account-owned resume reports remain available independently.
- Failed/stale/unauthorized operations change nothing. Concurrent save, rename,
  delete, capture, restore and proposal-apply requests must produce a valid serial
  outcome or an explicit conflict/missing-resource response.
- Verify that released project/asset/history/proposal quotas are usable again.
  Avoid new background cleanup services or hidden retention pruning.

## Phase 3: dashboard, workspace and unsaved work

Add project rename/delete controls to the dashboard and workspace, source-file
controls to the file tree, and asset rename/confirmed deletion to image controls.
Use accessible dialogs, clear loading/errors, disabled duplicate submissions,
keyboard focus restoration and the existing responsive design.

Introduce a shared workspace mutation guard. Pause typing/autosave while an
operation establishes its saved base, await in-flight saves, and validate a fresh
server tree against the acknowledged buffers before submitting revision-bound
changes. Save errors, conflicts and unresolved recovery stop the operation while
preserving text. Rename keeps editor state/tab identity where possible.

Deletion dialogs identify the target and permanence/recovery policy. Unsaved work
offers save, download, cancel, or an explicit discard choice for deletion. A
failed save never implicitly becomes discard. Navigation through app links,
browser Back and logout follows the same policy; refresh/close retains the native
browser warning and documented draft limitations.

Update buffers, tree, tabs, active file and project metadata together after an
acknowledged mutation. Remove only the matching explicitly discarded/deleted
local drafts. Cancel/invalidate affected compiler jobs and outputs; ignore late
save/compile/export responses after deletion, navigation or account changes.

For cross-tab changes, send content-free invalidations and revalidate on focus,
visibility and reconnect. The server's ownership/version checks remain authoritative.
Never refresh a dirty editor automatically. A remotely renamed file requires
review/reconciliation; a remotely deleted file/project becomes unavailable for
saving, while its already-held draft remains downloadable/recoverable by the same
account. Add orphan-draft recovery for missing files/projects instead of silently
ignoring those records. Logout/account switching retains the existing privacy
cleanup rules. Closed/suspended tabs cannot be guaranteed to acknowledge events;
disclose that deletion cannot save another tab's unsaved text.

## Phase 4: locally complete account verification and recovery

Replace the prototype-only journey with account/sign-in, registration,
verification/resend, forgotten-password and reset-password screens. Keep
`/auth-check` as a compatibility redirect or development diagnostic as appropriate;
update existing links/tests to the account journey.

Configure the pinned Better Auth APIs and enable Drizzle adapter transactions:

- Require email verification for password sign-in, send verification on signup,
  and provide resend. Verification completion returns to the account screen and
  requires explicit sign-in, avoiding a link silently switching the active account.
- Handle existing unverified local accounts through resend/verification without
  deleting accounts or marking them verified in bulk. Validate that existing
  sessions cannot bypass the required verification boundary.
- Use expiring reset tokens, minimum 12-character passwords, confirmation input,
  same-origin callback URLs and safe messages for invalid/expired links. Reset
  requests/resends use generic responses that avoid revealing account existence.
- Revoke all sessions on successful password reset. Verify concurrent redemption
  permits one successful use and failed password validation leaves the token usable.
  Other tabs hide private editors when session invalidation is detected, retaining
  drafts under the same account's existing recovery policy.
- Bound link validity explicitly (proposed: one hour for verification and reset),
  apply resend/reset rate limits, reject untrusted redirects/origins, and handle
  transport failures without exposing provider errors or tokens.
- Preserve Better Auth's verification replay semantics: revisiting an already
  successful verification link is harmless/idempotent and creates no new session.
  Do not claim verification links have the reset token's single-use behavior.

Use an API-only SMTP transport and a pinned Mailpit local inbox, bound to loopback
with forwarding/relaying disabled. Provide native Windows startup plus optional
Docker setup, so Docker availability is not a prerequisite. Add only the transport
dependency needed for actual SMTP behavior, pinned in the existing lockfile with
its license recorded. Document the inbox and settings in `.env.example`/README.
Mailpit supports a native binary and local SMTP/UI; see its
[installation documentation](https://mailpit.axllent.org/docs/install/).

Browser tests follow links from messages actually received by the local inbox.
No token-returning debug endpoint, emailed link in logs, real recipient delivery,
paid provider or external account is required. Keep secrets and email transport
server-only; scrub token-bearing URL paths and query strings from logs, and apply
no-referrer handling to lifecycle pages. Local SMTP acceptance does not establish
delivery to real mailboxes or hosted email support.

Better Auth's [email/password documentation](https://www.better-auth.com/docs/authentication/email-password)
and [configuration reference](https://better-auth.com/docs/reference/options)
inform this design; the installed 1.7.12 implementation was also inspected and
remains the compatibility reference during implementation. No auth upgrade is
planned. Production signup stays disabled pending a separately validated delivery
and hosting configuration.

## Phase 5: verification and completion evidence

Extend the existing suites with meaningful checks against real PostgreSQL and
real browser contexts. Use only a distinct `TEST_DATABASE_URL`; never reset a
configured user database. New test accounts follow verification, with fixture
setup kept explicit. Clean only this run's synthetic users, verification records
and captured messages.

| Area | Required evidence |
| --- | --- |
| Project/file/asset management | Rename/delete, reload persistence, main-file invariants, invalid/colliding paths, quotas and immutable history; recover deleted bytes by restoring the safety snapshot |
| Unsaved work | Dirty and recovered drafts, failed/offline saves, typing during requests, cancel/discard/download, navigation/Back/refresh and no late response restoring deleted state |
| Account recovery | Actual local signup email, unverified sign-in denial, resend and verification, reset email/link/new password, old-password failure, existing-session revocation, invalid/expired/replayed links and concurrent reset redemption |
| Delivery/error/privacy | SMTP outage/timeouts and retry, rate limits, generic unknown-account responses, rejected redirects/origins, private/no-store cookies and content/token-free logs |
| Two-account isolation | Every project/file/asset/snapshot/proposal/report mutation/read/download, foreign child IDs and mismatched parent IDs; rejected operations leave both owners' data unchanged |
| Two-tab races | Content save versus save/rename/delete, project deletion with an open dirty tab, structural edits versus restore/capture/apply, focus refresh, logout and password-reset invalidation |
| Cleanup | Database assertions for project cascades and quota release; account-owned reports survive project deletion; synthetic account teardown removes its sessions/accounts/projects/reports, and remaining recovery tokens cannot revive it |
| Regression | Existing history/export/assistant/resume workflows and real local compile/PDF download still work after rename/deletion changes |

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`,
`pnpm test:e2e` and `pnpm build` with the pinned runtime. Run the relevant built-app
browser journeys, including existing real compiler tests with prepared assets.
Inspect desktop/narrow-screen dialogs and account forms visually. Start the
available local PostgreSQL/test fixture if needed; report any unavailable check
explicitly. Do not mark Part 1 locally complete from mocks, skipped required
tests or absent compiler assets.

Update ROADMAP.md, README, contracts/architecture/product documentation and add
`docs/part-1.md` with exact commands, outcomes and limitations. Correct stale
Part 1 status statements in touched current documentation while retaining clearly
historical evidence. Record implementing-agent review honestly; no independent
reviewer or hosted verification is implied.

## Approval and final acceptance

Approval authorizes the phases above for localhost implementation and validation.
Part 1 is locally complete when two verified accounts remain isolated, saved work
survives reload, management operations preserve or explicitly discard drafts,
stale changes cannot overwrite newer ones, deletion cleanup is proven, history
restores exact bytes, and both account email flows pass through the local inbox.

Hosted authentication, real mailbox delivery, Neon access, public release and
compiler publication remain separately recorded gates after local completion.
