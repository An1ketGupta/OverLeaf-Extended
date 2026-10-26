# Assistant recovery simulation

Local synthetic contract fixture for the Groq-compatible endpoint already used
by apps/api/src/assistant-provider.ts. No owning-team mock was pulled and no remote
workspace lookup, binding or hosted mock was used; this original fixture follows
the existing adapter's wire contract.
No real provider key or document is sent. The adapter sends POST
`/openai/v1/chat/completions`, model/messages/JSON response format and no streaming.

Start: `postman simulation run postman/simulations/recovery/recovery.sim.yaml --port 4910 --output ndjson --no-history`.
Run: `pnpm test:provider:recovery` while the simulation is listening.
The simulation routes `/assistant/openai/v1/chat/completions` to that wire endpoint.
Instruction selects success/refusal/truncated/malformed/429/503/html/hang responses.
The runner checks actual adapter calls, bounded errors and later success; it never
stubs fetch. Inspect the simulation request log to establish that the member ran.

Validated 2026-10-26 with Postman CLI 1.75.0 and the actual provider adapter:
success/refusal, malformed/truncated output, 429/503/HTML, deadline failure and
later success passed. The member logged eight completed responses; the hanging
request was aborted by the adapter and did not produce a completed response event.
The unreachable-port case never reached the member. CLI 1.75.0 rejected a directory
in the member path; pointing directly at default.js worked. No member was silent.

Execution evidence and remaining limitations are recorded in
docs/validation-part-7.md. This does not measure live AI quality,
provider retention, or real account quotas. Keep logs synthetic and uncommitted.
