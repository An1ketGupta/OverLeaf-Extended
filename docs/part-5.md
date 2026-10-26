# Part 5 progress — 2026-10-20

**2026-10-24 integration update:** Part 3 now supplies bounded real compiler
diagnostics to the assistant's existing review/consent flow. The localhost compiler
gate is passed. Live provider eligibility/output validation remains unverified.
The original record below describes the earlier independent implementation.

Independent AI editing is implemented. Part 5 remains incomplete because Part 0A
has not selected a compiler, and no eligible live provider account/key has been
validated. Hosted authentication and commercial launch hosting remain open.

The workspace **AI assistant** saves/reconciles source before sending a bounded
request. Users select up to four files, optionally a selection, and choose code
explanation, rewrite, generation, project questions, or diagnostic explanation.
Diagnostics are supplied text until real compiler diagnostics become available.
Files are at most 24,000 UTF-8 bytes each; serialized context is at most 48,000
bytes. Instructions are at most 2,000 characters; diagnostics at most 4,000.
Context is explicitly selected rather than discovered through remote tools.

The server-only Groq adapter is disabled by default. It pins
`llama-3.3-70b-versatile`, JSON mode, 4,096 maximum completion tokens, a 10-second
deadline including response reads, and a 128,000-byte response limit. One active
request/account, two/instance, and twelve starts/account/minute are allowed.
Rate/concurrency limits are per process and reset on restart; provider quotas
still apply. No queue, automatic retries, provider tools, remote URL input,
paid fallback, or browser key is present. Model quality and current account
eligibility must be verified before enabling it for real documents.

Set `GROQ_API_KEY` and `AI_SHARING_ENABLED=true` on the API only, using an eligible
Free account with no payment method. Per-request sharing consent is also required
in the dialog. Never configure a paid tier to work around quota exhaustion.
`AI_LIVE_CHECK=true` plus `pnpm test:ai:live` explicitly opts into a small original
synthetic explanation request. That command is not part of normal tests or CI.

Provider output is untrusted JSON. Unknown/duplicate file targets, oversized
content, malformed/truncated responses, edits in explanation modes, and selected
rewrites that change surrounding text are rejected. Output is plain escaped text,
never executable HTML. Refusals, failed requests, pending/interrupted requests,
and validated proposals have separate stored states. No provider failure changes
project files. A request pending for thirty seconds expires when checked; late
results cannot revive rejected, expired, or deleted requests.

The diff shows all changes together. Atomic apply locks the owner, proposal and
project, checks the project revision and context file versions, captures a safety
snapshot, recomputes hashes and updates every proposed file in one transaction.
A snapshot quota failure rolls everything back. Idempotent request IDs return the
existing result; reusing an ID with different input conflicts. Repeating apply
returns its recorded result without applying again. This does not promise
exactly-once provider inference or free retries after a lost response.

After apply, reopen the assistant and check the applied request to restore its
backup. Quick restore requires the exact applied revision still to be current.
If later work exists, compare through History instead. Compilation remains
disabled and applied changes are explicitly unverified by a compiler.

Requests retain the selected source context, output, request fingerprint, request
ID, model/prompt version, timestamps, token usage when returned, and apply/backup
metadata. Raw provider errors, instructions and diagnostics are not stored as
separate fields; private source context and outputs are document data in PostgreSQL,
never application logs. Delete requests through Recent requests. History is
bounded by fifty requests and an 8 MiB reserved logical budget/account, with
200,000 bytes reserved/request (so the byte budget can be reached first).
Deleting a request does not delete its immutable safety snapshot. Deleting a
project/account cascades its proposals.

The dialog discloses provider sharing before submission. Groq's checked
[data policy](https://console.groq.com/docs/your-data) describes default inference
non-retention with reliability/abuse exceptions of up to thirty days and account
data controls for opting out. Review the account's actual controls and terms;
this application cannot attest those settings. Official
[API reference](https://console.groq.com/docs/api-reference),
[JSON output guidance](https://console.groq.com/docs/structured-outputs), and
[model catalog](https://console.groq.com/docs/models) informed the adapter.
Orbit discovery was consulted but returned a shortened path; the official
`/openai/v1/chat/completions` path takes precedence. No provider account was created.

Verification uses deterministic provider fixtures, including a real local HTTP
server exercising the actual adapter. Postman CLI and the in-app browser execution
tool were unavailable; the repository Playwright harness runs real Fastify,
PostgreSQL, and Chromium against a test-only HTTP provider. Its fixture switch is
in scripts/e2e-api.ts, never in the production server/configuration. These checks
establish local behavior, not live quality, hosted cookies, or provider retention.

## Verification actually run

Pinned Node 24.22.0 / pnpm 10.34.7 were used. Typecheck, build and forty unit
tests passed. All five PostgreSQL integration scripts passed against the separate
native test database, including proposal replay, account isolation, stale apply,
multi-file apply, restore, provider failure/refusal, expired requests, snapshot
quota rollback, and report deletion. Eleven Chromium E2E tests passed, including
the real request/diff/apply/reload/restore journey through the synthetic HTTP
provider. Desktop/mobile screenshots were inspected.

Repository-wide `pnpm lint`, targeted Biome checks, the frozen-lockfile install
and `git diff --check` passed. No live provider check, external deployment, hosted
auth check, or compiler integration was performed.
