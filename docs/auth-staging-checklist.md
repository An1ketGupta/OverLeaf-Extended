# Part 0B: deployed authentication acceptance

Local evidence covers the Better Auth/Drizzle handler, separate Set-Cookie values,
Secure/HttpOnly/SameSite/host-only attributes, session restoration and revocation,
missing/foreign Origin rejection, and private no-store responses. Browser tests
exercise signup, reload, signout, and sign-in through the real Vite proxy.

Status: actual Vercel-to-Render routing **not verified**; account access and deployed
hostnames are not configured. These checks remain prerequisites to hosted auth:

- Use the user's eligible Free accounts, apply migrations on a separate staging
  Neon branch, configure the exact frontend APP_ORIGIN/TRUSTED_ORIGINS, and keep
  public signup disabled. Create a synthetic account in a private development setup.
- Copy/fill the deployment templates. Verify `/api` preserves status, body, path,
  Content-Type, and separate Set-Cookie values; an API 404 must not become SPA HTML.
- Sign in through the HTTPS frontend, reload/new tab, check expiry and session
  renewal, sign out, and confirm old cookies cannot restore access. Inspect Secure,
  HttpOnly, SameSite=Lax, Path=/, and absence of Domain on the browser cookies.
- Compare two isolated browser contexts and direct unauthenticated Render requests.
  Repeat protected requests through the CDN; confirm no user data/cache reuse and
  inspect Cache-Control, CDN-Cache-Control, Vercel-CDN-Cache-Control, and cache status.
- Reject foreign/missing mutation origins and unapproved preview origins. Inspect
  the actual proxy chain before trusting any forwarded client-IP header for limits.
- Test Render sleep/restart, database wake-up/unavailability, frontend proxy timeouts,
  and accurate retry states. Use no artificial keepalive traffic.
- Specify email verification/password reset delivery in Part 1 and verify those
  flows through the same deployed proxy before enabling public registration.

Record deployment URLs, date, browser versions, checks, and evidence here. Never
put real cookies, auth secrets, database URLs/passwords, or private documents in
the evidence. Hosted forwarding remains pending regardless of localhost results.

References: [Better Auth Fastify integration](https://better-auth.com/docs/integrations/fastify),
[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
[Vercel external rewrites](https://vercel.com/docs/routing/rewrites).
