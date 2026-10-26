# Product flows and Part 0 scope

`/` shows API/database readiness. `/account` supplies sign-in, verified local
registration and resend; `/forgot-password` and `/reset-password` complete recovery
through the local inbox. `/auth-check` remains a compatibility path. `/projects`
opens private projects with rename/delete; `/projects/:projectId` edits/autosaves
source with explicit conflict review, file management and private tab recovery.
PDF.js previews actual locally compiled PDFs as well as uploaded files. See
part-1.md, part-2.md and part-3.md for local behavior and remaining hosted gates.

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

Parts 1-6 have their documented local implementations. Project/file deletion
protects drafts and preserves file bytes through history; project deletion is
permanent and cascades its dependent data. Password reset revokes old sessions
while same-account tab drafts remain recoverable. Hosted auth/email, live AI and
publication retain the gates in their own progress documents.
