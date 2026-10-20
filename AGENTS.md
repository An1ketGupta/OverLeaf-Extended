# Working in OverLeaf-Pro

Read ROADMAP.md and docs/part-0.md before changing implementation. Part 0 is
in progress: compiler selection, hosted authentication, and Neon account access
remain gates. Do not build a dependent compiler integration until a route passes.

- Keep hosting free with no card, subscription, or expiring trial. Docker is allowed.
- This is a commercial product. Select plans and dependencies compatible with
  commercial use; Vercel Hobby is excluded. Render Free is a staging candidate,
  not an approved production backend. Commercial launch hosting remains an open
  Part 0 gate; see docs/commercial-use.md. Do not infer permission to spend money.
- Use the pinned Node/pnpm and pnpm-lock.yaml. TypeScript is strict; validate inputs
  through packages/contracts. Add packages only for real shared behavior.
- apps/web contains public browser code. Never import packages/db, server auth,
  or future AI provider code into it. Only same-origin /api calls reach the API.
- apps/api owns HTTP/auth integration. packages/db owns schema and all migrations.
  Commit generated migration SQL, snapshots, and journal together; no schema push
  against shared data. Use a separate TEST_DATABASE_URL; never reset a user database.
- Snapshots are immutable. File versions are optimistic concurrency tokens. Hashes
  supplied by clients are not attestation. See docs/contracts.md before extending DTOs.
- Do not expose public arbitrary TeX execution. Docker packaging alone is not job
  isolation. Compiler assets require pinned provenance, hashes, and license review.
- Analyze actual PDF bytes and disclose extraction limitations. Never describe our
  estimates as an employer's ATS score or invent resume facts.
- Keep logs free of document contents, passwords, cookies, tokens, and connection URLs.
- Run pnpm lint, typecheck, test, and build for relevant changes. For API/auth/schema
  work run test:integration against real PostgreSQL and test:e2e with its test database.
  Report unavailable checks explicitly; mocks/localhost do not verify hosted behavior.
- Avoid unrelated changes. Do not delegate to subagents unless the user requests it.

See README.md for setup and docs/architecture.md for deployment boundaries.
