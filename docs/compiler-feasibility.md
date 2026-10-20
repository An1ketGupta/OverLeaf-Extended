# Part 0A: compiler feasibility gate

Status (2026-10-20): **open; no execution route selected**. The application exposes
no compile endpoint and ships no engine binary or third-party compiler assets.

## Observations and comparison

| Gate | Native server compiler on Render Free | Browser WASM candidate |
| --- | --- | --- |
| Runtime availability | Local Docker CLI exists, daemon unavailable; pdflatex/xelatex absent | SwiftLaTeX engine API documented upstream; no assets installed |
| Synthetic template compatibility | Not measured | Not measured |
| Cold/warm wall time and memory | Not measured on the actual free instance | Not measured on representative browsers/devices |
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
