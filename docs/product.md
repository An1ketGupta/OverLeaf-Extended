# Product flows and Part 0 scope

`/` shows live API/database readiness and the pending compiler gate. `/auth-check`
exercises the real auth bridge with synthetic accounts. `/projects` opens private
projects, and `/projects/:projectId` edits/autosaves actual source with explicit
conflict review and private tab recovery. Its PDF.js preview opens local PDFs;
compilation remains unavailable. See part-2.md for verified local behavior.

The first product journey is account -> private template copy -> edit/autosave ->
immutable snapshot -> actual compile -> preview/download. Save conflicts preserve
the user's buffer and require reconciliation. Failed compiles retain the last
successful preview with a stale label. Cancellation or a newer revision prevents
an older result from replacing the current preview.

AI work follows select/request -> validated proposal -> diff -> explicit apply or
reject. Apply must check every base file version atomically and preserve a prior
snapshot. Explanations and suggestions cannot invent resume facts. No provider
configuration may disable core editing or deterministic analysis.

Resume analysis follows choose actual PDF -> bounded extraction -> extracted-text
preview -> compatibility findings and separate job coverage -> optional save by PDF
hash. Failed/image-only extraction yields unknown checks, not a fabricated score.
Uploaded and browser-generated PDFs are client-provided artifacts. An internal
estimate is neither an employer ATS score nor a hiring probability.

Parts 1-6 implement the complete flows. Part 2 and its minimum project/file storage
prerequisite are implemented locally; full Part 1, hosted gates and compiler/AI/
analysis workflows remain pending.
