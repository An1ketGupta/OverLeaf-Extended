# Commercial-use decision — 2026-10-20

**Superseded scope, 2026-10-24:** the user clarified that this is a personal
project and requested localhost testing for now. This document preserves the
earlier commercial hosting investigation. It does not block local compiler
integration, select a host, authorize spending, or approve compiler redistribution.

The user confirmed that OverLeaf-Pro is intended for commercial use. This
supersedes the earlier personal-project hosting assumptions in ROADMAP.md and
the original Vercel/Render deployment examples. The existing requirements remain:
free hosting, no payment card, no paid subscription, no expiring trial; Docker
is permitted. Commercial intent does not authorize paid infrastructure.

## Hosting findings

Checked against provider documentation on 2026-10-20:

| Candidate | Decision and evidence |
| --- | --- |
| Vercel Hobby | Excluded. [Vercel's plan documentation](https://vercel.com/docs/plans/hobby) explicitly restricts Hobby to personal, non-commercial use. The existing rewrite JSON is a legacy routing example, not an eligible deployment choice for this product. |
| Render Free web service | Staging/evaluation candidate only. [Render's Free documentation](https://render.com/docs/free) advises against production use and documents sleeping services and quota limits. This does not establish a prohibition on all commercial development; it does prevent treating the prototype plan as a production recommendation. |
| Neon Free | Database candidate for development/staging within quotas. Its [pricing page](https://neon.com/pricing) distinguishes Free prototyping from paid production guarantees and lists limited restore history. Commercial launch requires account/terms validation, storage/compute sizing and an independent backup/restore plan; signup and connectivity remain unverified. |
| Cloudflare static hosting / Pages Functions | Frontend candidate to investigate, not a selected replacement. [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/) separates static assets from quota-limited Functions, and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) documents its Free plan. [Applicable terms](https://www.cloudflare.com/terms/) and account eligibility must be checked for the intended service, including payment-related restrictions if monetization is later implemented. No end-to-end API/auth proxy has been built or tested here. |

Commercial permission, free-plan eligibility and sufficient reliability/capacity
are separate checks. A complete commercial launch stack meeting all current
budget constraints has not been demonstrated. Do not promise free hosting at
arbitrary traffic levels or provision a paid plan to resolve a limit.

## Effect on the roadmap

- Part 0 must select commercially eligible hosts, validate no-card access and
  database separation, and test same-origin `/api` routing, cookies, caching,
  timeouts and service recovery on those actual hosts. Vercel-specific examples
  below the roadmap's updated decision describe the former proposal only.
- Keep the React/Vite, Fastify, contracts and PostgreSQL boundaries. A frontend
  host change does not itself authorize moving secrets or database code into the
  browser, or rewriting the API for a different runtime.
- Compiler feasibility remains open. Review each engine, package, font and
  template license against the actual distribution model. Commercial use does
  not imply either proprietary or open-source distribution, and a license name
  alone does not establish whether the intended integration meets its obligations.
- Public registration still waits for account/email lifecycle implementation.
  Launch also requires the planned ownership/security checks, retention/deletion,
  backups/restore and abuse/resource limits. Commercial intent does not add payment
  processing to the first-release scope or complete any existing gate.

## User input and access

The commercial-use question is resolved. The earlier request to create a Vercel
Hobby account for this project is withdrawn. Select an eligible hosting route
before asking the user to create replacement-host accounts. Account login/signup,
private environment configuration and deployment access will be needed for the
eventual selected staging setup. Do not request credentials in chat.

This change updates planning documents and the staging-template comment only.
No runtime, schema, deployment or account changes were made; application tests
were not rerun for this documentation update.
