# Part 7: integrated verification and recovery

**Complete for the localhost milestone, 2026-10-26**, with the limitations below.
Final evidence is in [validation-part-7.md](validation-part-7.md). Scope remains localhost / desktop
Chromium, real separate PostgreSQL test data, loopback Mailpit and synthetic AI.

The complete browser journey uses actual UI signup/verification/signin, a private
resume template, edit/save/reload, real compile/download, reviewed AI diff/apply,
exact-byte PDF analysis, private report reload and safety-history restore with
recompilation. No frontend fake substitutes for the compiler or HTTP adapter.

New service tests own a child API process and a TCP relay to the test database.
They stop/restart that process, drop existing database sockets, preserve draft
bytes across failures and reconcile lost acknowledgements through explicit conflict
review. Persisted session expiry hides private editors; signing in as the same
account recovers the tab draft. Pending AI requests remain pending/expire honestly
across restart. Delayed replies cannot revive rejected, expired or deleted data.
The shared PostgreSQL process and development database are never stopped/reset.

Verification: 51 unit tests, eight existing plus three new real PostgreSQL suites,
all 31 built-app browser journeys without skips, development journeys with the
documented clean rerun, and all 70 isolated compiler evaluator cases passed.
Lint, strict typecheck, build, Postman HTTP recovery and source backup checks pass.

Fixes close the source-export retention dependency, add validated ZIP recovery
into fresh private projects, bound session reads, suppress obsolete project-read
results, and contain/restore focus in dialogs. Export has a separate transport
bound so valid escaped source can still be backed up when compilation refuses it.
Existing snapshots and optimistic version/ownership guarantees remain intact.
Malformed backup assets return validation failures without throwing from quota
refinements or creating a partial project.

An in-flight transaction drill also reproduced an API process crash: checked-out
PostgreSQL clients lacked an error-event listener after the pool removed its idle
listener. All connected clients now retain a content-free listener; query failures
still reject, transactions roll back and pg removes unusable clients. The regression
holds a real project lock, drops the waiting API socket, verifies liveness/readiness
and unchanged source/version, then reconnects and saves the retained draft.

Actual compiler results are held at the browser message boundary in a regression
test, then delivered after cancel/newer source. Neither replaces current output,
workers are terminated and a later real compile succeeds. Existing compiler
isolation/hash/timeout/parser/asset tests and deletion/logout workflows remain.

Quota tests cover concurrent allocation, exact decoded input limits, full retained
history, actual account asset storage, proposal reservations, report count/bytes,
rollback and capacity reuse. Source ZIP recovery compares exact nested Unicode
source and image bytes after deleting the original, then compiles the new project.
See [backup-recovery.md](backup-recovery.md) for limits, recovery steps and the
separate unexecuted whole-database backup drill.

Keyboard checks cover editor escape/search/save, dialog Tab wrapping/Escape/return
focus and narrow Files/Source transitions. Screens at 320/390 px and a 640 px
reflow viewport exercise controls/errors/evidence. These checks do not establish
physical mobile performance, screen-reader conformance or native browser zoom.
Timings separate cold local asset loading from five warm product compiles and
from the evaluator's worker-only measurements. Synthetic provider timings are
not real network inference latency or a general performance guarantee.

No schema migration, runtime dependency, product license change, deployment,
external account or paid service was added. Existing uncommitted Parts 4–6 work
was preserved. Postman simulation is local and uses only synthetic contexts.
Hosted auth/CDN/email, database/host eligibility, compiler redistribution, broader
devices/browsers and independent security/release review remain publication gates.
