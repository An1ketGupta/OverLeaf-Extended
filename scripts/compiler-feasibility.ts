import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  limits,
  projectPathSchema,
  sourceSnapshotSchema,
} from "@overleaf-pro/contracts";
import { chromium } from "@playwright/test";
import candidate from "./compiler/candidate.json" with { type: "json" };

// Evaluation only: no service, credentials, user files or product integration.
const cache = resolve(".cache/compiler-feasibility/candidate");
const output = join(cache, "results");
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const assetPath = (file: string) => join(cache, file);
type Entry = { bundle: string; start: number; end: number };
type RuntimeFile = { path: string; start: number; end: number; sha256: string };
type InputFile = { path: string; bytes: number[] };
type Result = {
  type: string;
  wallMs: number;
  uiTicks: number;
  durationMs?: number;
  memoryBytes?: number;
  logs?: string;
  message?: string;
  pdf?: number[];
  enteredRun?: boolean;
  blockedHostAPIs?: Record<string, boolean>;
};
type Probe = {
  initializeProbe(options?: { cancelAfterMs?: number }): Promise<{
    durationMs: number;
    decodedRuntimeBytes: number;
  }>;
  runProbe(input: {
    files: InputFile[];
    mainFile: string;
    passes: number;
    timeoutMs: number;
    cancel: boolean;
  }): Promise<Result>;
  inspectProbe(
    bytes: number[],
  ): Promise<{ pages: string[]; pageCount: number }>;
};

async function verifyDownloads() {
  for (const asset of candidate.assets) {
    const bytes = await readFile(assetPath(asset.file));
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
      throw new Error(`Candidate asset integrity failed: ${asset.file}`);
  }
}

async function prepare() {
  await mkdir(cache, { recursive: true });
  for (const asset of candidate.assets) {
    const existing = await readFile(assetPath(asset.file)).catch(
      () => undefined,
    );
    if (existing?.length === asset.bytes && hash(existing) === asset.sha256)
      continue;
    console.log(
      `Downloading pinned evaluation asset: ${asset.file} (${asset.bytes} bytes)`,
    );
    const response = await fetch(asset.url, {
      signal: AbortSignal.timeout(600_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Download failed: ${asset.file}`);
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      received += chunk.length;
      if (received > asset.bytes)
        throw new Error(`Download exceeds pinned size: ${asset.file}`);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
      throw new Error(`Downloaded asset integrity failed: ${asset.file}`);
    await writeFile(assetPath(asset.file), bytes);
  }
  await verifyDownloads();
  // Extract only simple package-data filenames from the hash-verified archive.
  // No scripts, node_modules, symlinks or arbitrary archive paths are selected.
  const listing = execFileSync("tar", ["-tzf", assetPath("bundles.tar.gz")], {
    encoding: "utf8",
  });
  const entries = listing
    .split(/\r?\n/)
    .filter((name) => /^bundles\/[a-z0-9-]+\.(json|data\.gz)$/.test(name));
  if (!entries.length)
    throw new Error("Candidate package archive has no supported entries");
  execFileSync("tar", [
    "-xzf",
    assetPath("bundles.tar.gz"),
    "-C",
    cache,
    ...entries,
  ]);
  const metadata = JSON.parse(
    await readFile(assetPath("bundles/bundles.json"), "utf8"),
  ) as {
    bundles: Record<string, { requires?: string[] }>;
  };
  const manifest = JSON.parse(
    await readFile(assetPath("bundles/file-manifest.json"), "utf8"),
  ) as Record<string, Entry>;
  const selected = new Set(candidate.bundles);
  for (const name of selected)
    for (const dependency of metadata.bundles[name]?.requires ?? [])
      selected.add(dependency);
  const index: RuntimeFile[] = [];
  const parts: Buffer[] = [];
  let size = 0;
  const add = (path: string, bytes: Buffer) => {
    if (
      !path.startsWith("/") ||
      path.split("/").some((part) => part === "..") ||
      path.includes("\\")
    )
      throw new Error("Unsafe package path");
    if (size + bytes.length > 256 * 1024 * 1024)
      throw new Error("Evaluation package byte limit");
    index.push({
      path,
      start: size,
      end: size + bytes.length,
      sha256: hash(bytes),
    });
    parts.push(bytes);
    size += bytes.length;
  };
  for (const name of selected) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Unsafe bundle name");
    const data = gunzipSync(
      await readFile(assetPath(`bundles/${name}.data.gz`)),
      { maxOutputLength: 128 * 1024 * 1024 },
    );
    for (const [path, entry] of Object.entries(manifest)) {
      if (entry.bundle !== name) continue;
      if (
        !Number.isSafeInteger(entry.start) ||
        !Number.isSafeInteger(entry.end) ||
        entry.start < 0 ||
        entry.end < entry.start ||
        entry.end > data.length
      )
        throw new Error("Invalid package byte range");
      add(path, data.subarray(entry.start, entry.end));
    }
  }
  add(
    "/texlive/texmf-dist/tex/latex/enumitem/enumitem.sty",
    await readFile(assetPath("enumitem.sty")),
  );
  if (new Set(index.map((entry) => entry.path)).size !== index.length)
    throw new Error("Duplicate runtime paths");
  const runtime = Buffer.concat(parts);
  const compressed = gzipSync(runtime);
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;
  await writeFile(assetPath("runtime.gz"), compressed);
  await writeFile(assetPath("runtime.json"), indexJson);
  const shards: Record<
    string,
    { path: string; bytes: number; sha256: string }[]
  > = {};
  for (const [name, bytes] of [
    ["engine", await readFile(assetPath("busytex.wasm"))],
    ["runtime", compressed],
  ] as const) {
    shards[name] = [];
    for (let offset = 0; offset < bytes.length; offset += 8 * 1024 * 1024) {
      const chunk = bytes.subarray(offset, offset + 8 * 1024 * 1024);
      const path = `${name}-${offset}.bin`;
      await writeFile(assetPath(path), chunk);
      shards[name].push({ path, bytes: chunk.length, sha256: hash(chunk) });
    }
  }
  await writeFile(
    assetPath("shards.json"),
    `${JSON.stringify(shards, null, 2)}\n`,
  );
  await writeFile(
    assetPath("prepared.json"),
    JSON.stringify(
      {
        candidate: candidate.id,
        runtimeSha256: hash(runtime),
        gzipSha256: hash(compressed),
        indexSha256: hash(indexJson),
        bytes: size,
        transferBytes: compressed.length,
        files: index.length,
        bundles: [...selected],
      },
      null,
      2,
    ),
  );
  console.log(
    `Prepared evaluation-only runtime: ${index.length} files, ${size} decoded / ${compressed.length} gzip bytes.`,
  );
  const publicDir = resolve("apps/web/public/compiler");
  await mkdir(publicDir, { recursive: true });
  for (const group of Object.values(shards))
    for (const shard of group)
      await copyFile(assetPath(shard.path), join(publicDir, shard.path));
  await copyFile(assetPath("busytex.js"), join(publicDir, "engine.js"));
  await copyFile(assetPath("runtime.json"), join(publicDir, "runtime.json"));
  await copyFile("scripts/compiler/worker.js", join(publicDir, "worker.js"));
  await writeFile(
    join(publicDir, "manifest.json"),
    JSON.stringify(
      {
        buildId: `busytex-tl2025-${hash(runtime).slice(0, 12)}`,
        engineSha256: candidate.assets.find((a) => a.file === "busytex.wasm")
          ?.sha256,
        engineCodeSha256: candidate.assets.find((a) => a.file === "busytex.js")
          ?.sha256,
        runtimeSha256: hash(runtime),
        indexSha256: hash(indexJson),
        runtimeBytes: size,
        shards,
      },
      null,
      2,
    ),
  );
  console.log(
    "Prepared ignored compiler assets for localhost. Redistribution review remains separate.",
  );
}

async function fixture(directory: string): Promise<InputFile[]> {
  // Fixed repository fixtures only; never accept arbitrary user source directories.
  const paths =
    directory === "tests/fixtures/compiler/report"
      ? ["main.tex", "sections/method.tex"]
      : directory === "templates/report"
        ? ["main.tex", "sections/introduction.tex", "sections/findings.tex"]
        : ["main.tex"];
  const files = await Promise.all(
    paths.map(async (path) => {
      projectPathSchema.parse(path);
      return { path, content: await readFile(join(directory, path), "utf8") };
    }),
  );
  sourceSnapshotSchema.parse({
    id: randomUUID(),
    projectId: randomUUID(),
    revision: 1,
    mainFile: "main.tex",
    createdAt: new Date().toISOString(),
    assets: [],
    files: files.map((file) => ({
      ...file,
      id: randomUUID(),
      version: 1,
      sha256: hash(file.content),
    })),
  });
  return files.map((file) => ({
    path: file.path,
    bytes: [...Buffer.from(file.content)],
  }));
}

async function benchmark() {
  await verifyDownloads();
  const prepared = JSON.parse(
    await readFile(assetPath("prepared.json"), "utf8"),
  );
  const runtime = await readFile(assetPath("runtime.gz"));
  const runtimeIndex = await readFile(assetPath("runtime.json"));
  if (
    hash(runtime) !== prepared.gzipSha256 ||
    hash(runtimeIndex) !== prepared.indexSha256
  )
    throw new Error(
      "Prepared runtime integrity failed; rerun compiler:prepare",
    );
  await mkdir(output, { recursive: true });
  const routes = new Map<string, { bytes: Buffer; mime: string }>();
  const route = async (url: string, file: string, mime: string) => {
    routes.set(url, { bytes: await readFile(file), mime });
  };
  routes.set("/", {
    bytes: Buffer.from(
      '<!doctype html><html lang="en"><title>Compiler evaluation</title><body><script src="/harness.js"></script></body></html>',
    ),
    mime: "text/html",
  });
  await route("/engine.js", assetPath("busytex.js"), "text/javascript");
  await route("/engine.wasm", assetPath("busytex.wasm"), "application/wasm");
  await route(
    "/runtime.gz",
    assetPath("runtime.gz"),
    "application/octet-stream",
  );
  await route("/runtime.json", assetPath("runtime.json"), "application/json");
  await route("/shards.json", assetPath("shards.json"), "application/json");
  const shards = JSON.parse(
    await readFile(assetPath("shards.json"), "utf8"),
  ) as Record<string, { path: string; bytes: number; sha256: string }[]>;
  for (const group of Object.values(shards)) {
    for (const shard of group) {
      if (!/^(engine|runtime)-\d+\.bin$/.test(shard.path))
        throw new Error("Unsafe shard path");
      const bytes = await readFile(assetPath(shard.path));
      if (bytes.length !== shard.bytes || hash(bytes) !== shard.sha256)
        throw new Error("Shard integrity failed");
      await route(
        `/${shard.path}`,
        assetPath(shard.path),
        "application/octet-stream",
      );
    }
  }
  for (const [name, expected] of [
    [
      "engine",
      candidate.assets.find((asset) => asset.file === "busytex.wasm")?.sha256,
    ],
    ["runtime", prepared.gzipSha256],
  ] as const) {
    const chunks = await Promise.all(
      (shards[name] ?? []).map((shard) => readFile(assetPath(shard.path))),
    );
    if (hash(Buffer.concat(chunks)) !== expected)
      throw new Error("Reassembled shard integrity failed");
  }
  await route("/worker.js", "scripts/compiler/worker.js", "text/javascript");
  await route("/harness.js", "scripts/compiler/harness.js", "text/javascript");
  await route(
    "/pdf.mjs",
    "apps/web/node_modules/pdfjs-dist/build/pdf.mjs",
    "text/javascript",
  );
  await route(
    "/pdf.worker.mjs",
    "apps/web/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    "text/javascript",
  );
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    const item = routes.get(path);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self'; connect-src ${path === "/worker.js" ? "'none'" : "'self'"}; style-src 'unsafe-inline'; font-src 'self' data: blob:; img-src data: blob:`,
    );
    if (!item || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", item.mime);
    response.end(item.bytes);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Loopback server failed");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const denied: string[] = [];
  await page.route("**/*", (request) => {
    const url = new URL(request.request().url());
    if (
      url.origin === `http://127.0.0.1:${address.port}` &&
      routes.has(url.pathname)
    )
      return request.continue();
    denied.push(url.pathname);
    return request.abort();
  });
  const results: Record<string, unknown>[] = [];
  let failures = 0;
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    const initialization = await page.evaluate(() =>
      (globalThis as unknown as Probe).initializeProbe(),
    );
    const run = async (
      name: string,
      files: InputFile[],
      expected: string[],
      passes = 1,
      expectedState = "succeeded",
      cancel = false,
    ) => {
      const first = results.length;
      let successfulPdf: number[] | undefined;
      const count = expectedState === "succeeded" ? 6 : 1;
      for (let iteration = 0; iteration < count; iteration++) {
        const result = await page.evaluate(
          (input) => (globalThis as unknown as Probe).runProbe(input),
          {
            files,
            mainFile: "main.tex",
            passes,
            timeoutMs:
              expectedState === "timed-out" ? 1000 : limits.compileTimeoutMs,
            cancel,
          },
        );
        const { pdf, logs, ...measurements } = result;
        let extracted: { pages: string[]; pageCount: number } | undefined;
        if (pdf) {
          extracted = await page.evaluate(
            (bytes) => (globalThis as unknown as Probe).inspectProbe(bytes),
            pdf,
          );
          successfulPdf = pdf;
          if (iteration === 0) {
            await writeFile(join(output, `${name}.pdf`), Buffer.from(pdf));
            await page.screenshot({
              path: join(output, `${name}.png`),
              fullPage: true,
            });
            for (let index = 0; index < extracted.pageCount; index++) {
              await page
                .locator("canvas")
                .nth(index)
                .screenshot({
                  path: join(output, `${name}-page-${index + 1}.png`),
                });
            }
          }
        }
        const text = extracted?.pages.join(" ").replace(/\s+/g, " ") ?? "";
        const passed =
          result.type === expectedState &&
          expected.every((value) => text.includes(value)) &&
          (!pdf || pdf.length <= limits.pdfBytes) &&
          (!pdf ||
            (Object.values(result.blockedHostAPIs ?? {}).length === 5 &&
              Object.values(result.blockedHostAPIs ?? {}).every(Boolean))) &&
          result.uiTicks > 0 &&
          (expectedState !== "timed-out" || result.enteredRun) &&
          (name !== "invalid" ||
            (logs ?? "").includes("Undefined control sequence")) &&
          (name !== "missing-package" ||
            (logs ?? "").includes("overleafproMissingPackage")) &&
          (!name.includes("report") ||
            !/undefined references|undefined citations/.test(logs ?? ""));
        if (!passed) failures++;
        results.push({
          name,
          iteration,
          phase:
            iteration === 0 ? "fresh-worker-first" : "fresh-worker-warm-assets",
          passed,
          ...measurements,
          inputFiles: files.map((file) => ({
            path: file.path,
            bytes: file.bytes.length,
            sha256: hash(new Uint8Array(file.bytes)),
          })),
          pdfBytes: pdf?.length,
          pdfSha256: pdf ? hash(new Uint8Array(pdf)) : undefined,
          pageCount: extracted?.pageCount,
          expectedText: expected,
          extractedText: text,
          unresolvedReferences:
            /undefined references|undefined citations|Reference .+ undefined|Citation .+ undefined/.test(
              logs ?? "",
            ),
        });
        if (logs)
          await writeFile(join(output, `${name}-${iteration}.log`), logs);
        console.log(
          `${name} ${iteration + 1}/${count}: ${result.type}, ${Math.round(result.wallMs)} ms, checks ${passed ? "passed" : "FAILED"}`,
        );
      }
      if (results.length === first) throw new Error("No benchmark results");
      return successfulPdf;
    };
    const chart = await readFile("tests/fixtures/compiler/report/chart.tex");
    const chartPdf = await run(
      "chart",
      [{ path: "main.tex", bytes: [...chart] }],
      [],
      1,
    );
    await run(
      "resume-classic",
      await fixture("tests/fixtures/compiler/resume-classic"),
      ["Alex Example", "Experience", "Education"],
    );
    await run(
      "resume-unicode",
      await fixture("tests/fixtures/compiler/resume-unicode"),
      ["Zoë García", "Montréal", "café"],
    );
    const report = await fixture("tests/fixtures/compiler/report");
    if (chartPdf) report.push({ path: "chart.pdf", bytes: chartPdf });
    await run(
      "report",
      report,
      ["Synthetic Compiler Compatibility Report", "Chapter 1", "Figure 1.1"],
      3,
    );
    for (const name of ["resume-classic", "resume-compact", "report"]) {
      const files = await fixture(`templates/${name}`);
      await run(
        `template-${name}`,
        files,
        [
          name === "report"
            ? "A Synthetic Document Workflow Study"
            : "Experience",
        ],
        name === "report" ? 3 : 1,
      );
    }
    const source = (text: string): InputFile[] => [
      { path: "main.tex", bytes: [...Buffer.from(text)] },
    ];
    await run(
      "invalid",
      source(
        "\\documentclass{article}\\begin{document}\\UnknownCommand\\end{document}",
      ),
      [],
      1,
      "failed",
    );
    await run(
      "missing-package",
      source(
        "\\documentclass{article}\\usepackage{overleafproMissingPackage}\\begin{document}x\\end{document}",
      ),
      [],
      1,
      "failed",
    );
    const loop = source(
      "\\documentclass{article}\\begin{document}\\def\\forever{\\forever}\\forever\\end{document}",
    );
    await run("timeout", loop, [], 1, "timed-out");
    await run("cancel", loop, [], 1, "cancelled", true);
    await run(
      "project-a",
      [
        ...source(
          "\\documentclass{article}\\begin{document}First isolated project\\end{document}",
        ),
        {
          path: "private.txt",
          bytes: [...Buffer.from("SYNTHETIC-OTHER-PROJECT")],
        },
      ],
      ["First isolated project"],
    );
    await run(
      "project-b",
      source(
        "\\documentclass{article}\\begin{document}\\IfFileExists{private.txt}{LEAK}{ISOLATED}\\end{document}",
      ),
      ["ISOLATED"],
    );
    await run(
      "shell-disabled",
      source(
        "\\documentclass{article}\\begin{document}\\immediate\\write18{echo SYNTHETIC > escaped.txt}\\IfFileExists{escaped.txt}{LEAK}{SHELL DISABLED}\\end{document}",
      ),
      ["SHELL DISABLED"],
    );
    await run(
      "recovery",
      source(
        "\\documentclass{article}\\begin{document}Recovery succeeded\\end{document}",
      ),
      ["Recovery succeeded"],
    );
    // Exercise the actual browser verifier with one corrupted delivery shard.
    const firstShard = shards.engine?.[0];
    if (!firstShard) throw new Error("No engine shards");
    const original = routes.get(`/${firstShard.path}`);
    if (!original) throw new Error("Missing shard route");
    const corrupt = Buffer.from(original.bytes);
    corrupt[0] = (corrupt[0] ?? 0) ^ 255;
    routes.set(`/${firstShard.path}`, { ...original, bytes: corrupt });
    const corruptedDeliveryRejected = await page.evaluate(async () => {
      try {
        await (globalThis as unknown as Probe).initializeProbe();
        return false;
      } catch (error) {
        return (
          error instanceof Error && error.message === "Shard integrity failed"
        );
      }
    });
    routes.set(`/${firstShard.path}`, original);
    if (!corruptedDeliveryRejected) failures++;
    const loadCancellationPassed = await page.evaluate(async () => {
      try {
        await (globalThis as unknown as Probe).initializeProbe({
          cancelAfterMs: 1,
        });
        return false;
      } catch (error) {
        return error instanceof Error && error.name === "AbortError";
      }
    });
    if (!loadCancellationPassed) failures++;
    await page.evaluate(() =>
      (globalThis as unknown as Probe).initializeProbe(),
    );
    const summary = {
      candidate: candidate.id,
      selectedForLocalUse: failures === 0,
      publicReleaseApproved: false,
      scope: "localhost / desktop Chromium",
      gates: {
        licensing: "open",
        hostedDelivery: "unverified",
        serverCapacity: "unverified",
        localCompatibility: failures ? "failed" : "passed",
      },
      observedAt: new Date().toISOString(),
      browser: browser.version(),
      node: process.version,
      platform: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model,
      initialization,
      prepared,
      deniedNetworkRequests: denied,
      corruptedDeliveryRejected,
      loadCancellationPassed,
      largestDeliveryShardBytes: Math.max(
        ...Object.values(shards)
          .flat()
          .map((shard) => shard.bytes),
      ),
      requestedPaths: [...new Set(requests)],
      failures,
      results,
    };
    await writeFile(
      join(output, "measurements.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    console.log(
      `Evidence saved to ${output}; local acceptance ${failures ? "FAILED" : "passed"}. Publication checks remain separate.`,
    );
    if (failures) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}

if (process.argv[2] === "prepare") await prepare();
else if (process.argv[2] === "benchmark") await benchmark();
else
  throw new Error(
    "Use compiler:prepare or compiler:benchmark; synthetic fixtures only",
  );
