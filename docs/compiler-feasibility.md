# Part 0A: compiler feasibility gate

**User scope update, 2026-10-24:** this is a personal project, with localhost
testing for now. The measured BusyTeX/XeTeX browser route is accepted for local
desktop Chromium integration. Hosted delivery and broader devices are publication
checks and no longer block local Part 3. Engine assets are generated into ignored
local files, not committed or approved for public redistribution. See
compiler-licenses.md for the local-use review and publication checklist. Earlier
evaluation-only status below records the original gate and evidence.

Status (2026-10-24): **local gate passed; browser XeTeX/xdvipdfmx selected for
desktop Chromium on localhost**. Part 3 now integrates the measured route and
passes real browser workflows against both development and built local assets.
Engine binaries are downloaded/prepared locally and ignored by Git. There is no
server compile endpoint. Redistribution, actual hosting and broader device
support remain publication work, not prerequisites for the requested local build.

## Local evaluation and evidence

Run with pinned Node 24.22.0 / pnpm 10.34.7:

```sh
pnpm compiler:prepare
pnpm compiler:benchmark
```

Preparation explicitly downloads about 230 MB of pinned upstream evaluation assets;
it is excluded from normal installation, tests, build and CI. The benchmark makes
no upstream requests and uses only fixed synthetic repository fixtures. It starts
a random loopback-only server and a fresh Chromium context without application
credentials. Preparation also stages the same pinned runtime under the ignored
apps/web/public/compiler directory for local Part 3 use. No arbitrary server
TeX execution is enabled. See [runner](../scripts/compiler-feasibility.ts) and
[candidate pins](../scripts/compiler/candidate.json).

The evaluated alternative is Siglum v0.1.0's BusyTeX/TeX Live 2025 binary, using
XeTeX and xdvipdfmx directly. None of Siglum's higher-level compiler, automatic
source shims, CTAN resolver, IndexedDB document cache or runtime npm dependencies
are adopted. Source is compiled without silent compatibility rewrites. Enumitem
3.11 is a separately pinned MIT-licensed input because it is absent from the
upstream package bundle.

The manifest records exact release URLs, byte lengths, SHA-256, source release
commit and BusyTeX submodule revision. Preparation verifies downloads before
extracting allowlisted package-data entries, then creates a file/hash inventory.
The selected evaluation runtime contains 3,692 files, 80,995,466 decoded bytes and
36,321,748 gzip bytes. The engine WASM is 30,767,701 bytes. Both are divided into
at most 8 MiB chunks with hashes verified by Node and again in the browser; a
deliberately corrupted chunk must fail verification. This addresses the
[Cloudflare Pages 25 MiB individual-asset limit](https://developers.cloudflare.com/pages/platform/limits/)
in a local delivery prototype. Actual account eligibility, CDN headers, transfer
times and deployment behavior remain unverified.

### Local compatibility and bounded execution evidence

The benchmark runs each successful fixture once with a fresh worker and five
additional times with warm immutable assets. These are worker-start measurements
after asset initialization, not internet cold-download latency. It parses actual
PDF bytes with PDF.js, checks extracted text, renders every page, and saves PDFs,
page PNGs, synthetic-only final-pass logs, source/PDF hashes and raw measurements.
Raw results are in .cache/compiler-feasibility/candidate/results; the checked-in
[measurement record](compiler-evidence/2026-10-24-chromium.json) preserves the run.

| Document | Verified output |
| --- | --- |
| Classic resume fixture | One page; contact, experience and education text; accented text visually checked |
| Unicode resume fixture | One page; Zoë García, Montréal and café extracted correctly with fontspec/Latin Modern |
| Report fixture | Four pages; separately compiled chart.pdf, nested input, three passes, resolved chapter/figure/citation and contents |
| Classic and compact catalog resumes | One page each; rendered headings, contact details and readable content |
| Catalog report | Five pages; three passes, contents, nested sections, table and bibliography |

All of these generated pages were visually inspected. On the measured Intel
i7-13650HX Windows machine, resumes compiled in approximately 0.5–1.5 seconds and
reports in approximately 1.5–2.7 seconds including worker start. Exact individual
measurements, browser version and machine identifiers are in the record above.
WASM linear memory observed after execution was 330,498,048 bytes (about 315 MiB).
That excludes filesystem/JS copies, previous pass instances awaiting GC, PDF.js,
browser overhead and transient peaks. It is not process RSS or a hard browser
memory quota. These desktop measurements do not establish mobile suitability.

The harness also exercises invalid syntax, unsupported packages, parent-enforced
timeout of an infinite loop, cancellation during a running loop, successful
subsequent compilation, fresh-project filesystem separation and disabled shell
escape. A fresh worker/module is created for each job, with fresh C globals per
pass; only that job's auxiliary files survive between its passes. Final-pass
diagnostics determine reference resolution; first-pass warnings are expected.
The recorded final run passed 70 compilation runs across the fixture and failure
scenarios, plus corrupt-delivery rejection and cancellation/recovery while loading
assets. The loader has a separate 30-second deadline; running jobs use the shared
15-second limit (the timeout probe deliberately uses a shorter deadline).

The worker has CSP connect-src 'none', blocked fetch/XHR/WebSocket/script-loading/
storage host APIs, no document object and no API/auth bridge. Packages are loaded
from the verified in-memory bundle. Host-API probes and job separation demonstrate
the tested boundary; they are not an independent complete security review. The
runtime's Emscripten glue includes native shell execution when run under Node, so
this browser evaluation is specifically not a safe Node/server sandbox.
The [exact WASM import list](compiler-evidence/2026-10-24-wasm-imports.json) includes
system, socket and connection calls. Browser host restrictions are necessary;
WASM execution alone would not establish their denial. The import list contains
no imported JavaScript-evaluation function, but that observation is not a complete
audit of every possible engine or converter input.

### Historical project checks before local product integration

| Command | Actual outcome |
| --- | --- |
| pnpm compiler:prepare | Passed: pinned downloads verified, package inventory and delivery shards generated |
| pnpm compiler:benchmark | Passed: real PDFs, text/render checks and tested failure/isolation/asset-loading behavior; 0 failing assertions |
| pnpm lint | Passed |
| pnpm typecheck | Passed for root and all workspace packages |
| pnpm test | 40 tests passed |
| pnpm build | Passed; the product bundle contains no candidate compiler |
| pnpm test:e2e | 2 passed, 9 database-dependent tests skipped because TEST_DATABASE_URL is absent |
| pnpm test:integration | Unavailable: exits explicitly because TEST_DATABASE_URL is absent; no PostgreSQL integration pass is claimed |
| pnpm check:environment | Correct pinned Node; Docker daemon, PATH psql, pdflatex and xelatex unavailable |

This change modifies evaluation scripts and documentation only. No HTTP/worker
product DTO, database schema, migration or product UI was changed. Existing staged,
unstaged and untracked work was preserved. No deployment, account creation, live
AI call or paid service was used. No independent reviewer/subagent was invoked.

### Candidate comparison and publication checks

| Candidate | Finding | Decision |
| --- | --- | --- |
| Native TeX on actual Render Free staging | Local Docker daemon and native TeX are unavailable; no staging configuration/access. Actual host capacity, OS sandbox support, secrets/network isolation and cancellation have not been demonstrated. | Unverified; no public compile endpoint. |
| SwiftLaTeX v20022022 | Downloaded and inspected privately. XeTeX returns XDV and requires a separate converter. The old documented package hostname failed DNS resolution; the configured texlive2 hostname timed out. Wrapper EPL/GPL-with-Classpath headers differ from the repository AGPL label. No passing offline fixture run was obtained for this candidate. | Not selected; upstream package availability and complete asset-level licensing need resolution. |
| Siglum/BusyTeX v0.1.0 browser candidate | Real local PDFs and fixture checks pass; bounded allowlisted packages and chunked asset delivery work on the measured desktop Chromium setup. | Selected for local integration under the user's localhost clarification; publication checks remain below. |

The following remain required before public hosting or redistributing assets:

1. Complete linked engine/library, format, package and font license/notice and
   corresponding-source inventory for the exact redistributed subset. The
   [Siglum wrapper license](https://github.com/SiglumProject/siglum/blob/2a44e46f216d04bf52235cae271cd5e31c881a92/LICENSE)
   does not by itself cover the binary: [BusyTeX's upstream license explanation](https://github.com/busytex/busytex#license)
   distinguishes its own MIT code from linked TeX Live/dependency licenses.
   Resolve the intended product distribution model before accepting obligations;
   this work has not changed the product license or declared every asset MIT.
2. Validate asset delivery and the execution boundary on an eligible actual free
   staging host. No host account was created or deployment performed. Commercial
   launch hosting remains its separate open decision.
3. Verify a defined supported browser/device matrix, cold network loading,
   representative low-memory behavior and remaining security/failure probes.
   Only local desktop Chromium is measured here; Firefox, WebKit and physical
   mobile devices are not verified. Any tighter supported subset must be explicit.

The user explicitly accepted localhost testing, so the local route is now
integrated. See [Part 3 completion](part-3.md) for asset persistence, non-retained
captures, diagnostics, preview/download, stale-result controls, generated-PDF
analysis and current verification. The publication checklist does not claim that
localhost proves hosted behavior.

## Observations and comparison

| Gate | Native server compiler on Render Free | Original SwiftLaTeX browser candidate (historical) |
| --- | --- | --- |
| Runtime availability | Local Docker CLI exists, daemon unavailable; pdflatex/xelatex absent | SwiftLaTeX engine API documented upstream; no assets installed |
| Synthetic template compatibility | Not measured | Not measured |
| Cold/warm wall time and memory | Not measured on the actual free instance | Alternative BusyTeX candidate measured on local desktop Chromium only; see above |
| Per-job filesystem/network/secret isolation | Not established by service-level Docker | Worker API/package fetch restrictions not audited |
| Cancellation, timeout, cleanup | Not measured | Not measured |
| Asset/package/font pins and redistribution | Distribution not selected | Complete engine/TeX/font inventory and notices pending |
| Verdict | Pending; cannot accept arbitrary documents | Pending; cannot integrate as a working compiler |

The [SwiftLaTeX README](https://github.com/SwiftLaTeX/SwiftLaTeX) documents PdfTeX/
XeTeX, virtual files, worker closing, and a configurable TeX Live endpoint. It also
describes package fetching from CTAN or its mirror and states AGPL-3.0 for repository
code. Those facts do not establish a reproducible offline package bundle, ongoing
maintenance, every asset's license, or this application's compatibility. Inspect a
specific engine revision/build and its package/font notices before adopting it.

Render's [Free service limits](https://render.com/docs/free) remain part of the
deployment gate: sleeping services, ephemeral files, and shared resource quotas.
Docker's availability does not provide job isolation. Do not add privileged Docker,
an unapproved paid service, or HTML-to-PDF to bypass this gate.

## Reproducible evaluation protocol

1. Select specific upstream revisions and toolchains for a minimal TeX server image
   and a SwiftLaTeX engine. Record source commit, engine version, build commands,
   SHA-256 for every distributed asset, individual licenses/notices, and update policy.
   Do not use `latest` URLs or a live uncontrolled package mirror in the product.
2. Prepare tests/fixtures/compiler: two resume styles, Unicode/fonts, a report with
   nested source and an original image. Record exact source/image hashes. For each
   candidate, inspect output pages, extracted names/sections, missing glyphs,
   diagnostics, reference resolution, and package inventory.
3. Server: deploy a synthetic-only prototype on the actual 512 MiB/0.1 CPU free
   instance with one job at a time plus API overhead. Measure cold start and at least
   five warm runs per fixture, RSS/peak memory, image size, output size, timeout,
   cancellation, and cleanup. The hosting budget must include external traffic.
4. Prove read/write boundaries between jobs, no access to service environment or
   credentials, and denial of arbitrary network access. Shell escape flags alone
   do not satisfy these requirements. An OS sandbox must actually be supported on
   the host. Exercise failures only in disposable environments with synthetic secrets.
5. Browser: host pinned assets with a narrow package allowlist on the proposed free
   frontend, measure compressed transfer size and deployment limits, cold/warm time,
   UI responsiveness, and browser memory where observable. Audit worker network APIs,
   cookie/storage access, host bridges, required headers, and cross-origin isolation.
   Test termination/cancellation, worker recreation, and project filesystem separation.
6. Record invalid TeX, missing packages, infinite loops, cancellation during load/run,
   and project switching. Distinguish hard byte/time limits from observed browser
   memory; an observation is not a memory quota.
7. Attach commands, raw measurements, hardware/browser/host/build identifiers, and
   pass/fail evidence to this file. Select a route only when compatibility, licensing,
   capacity, delivery, and isolation pass. If neither passes, report the precise
   blocker and discuss scope before starting Part 3.

No compiler build ID or package/font version is invented as a placeholder pin.
The shared request/result transport exists, but the engine adapter, asset transport,
and worker host implementation remain gated. `pnpm check:environment` checks local
tool availability; it never reports a successful compilation benchmark.
