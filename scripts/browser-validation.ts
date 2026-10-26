import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { CompileEvent, SourceSnapshot } from "@overleaf-pro/contracts";
import { chromium, type Page } from "@playwright/test";
import { verifyCompilerAssets } from "./compiler-checks.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// Synthetic fixtures only. The real product adapter and PDF worker run in Chromium.
export async function compileSynthetic(page: Page, content: string) {
  const snapshot: SourceSnapshot = {
    id: randomUUID(),
    projectId: randomUUID(),
    revision: 1,
    mainFile: "main.tex",
    createdAt: new Date().toISOString(),
    assets: [],
    files: [
      {
        id: randomUUID(),
        path: "main.tex",
        version: 1,
        content,
        sha256: hash(content),
      },
    ],
  };
  return page.evaluate(async (source) => {
    const compilerPath = "/src/features/workspace/browser-compiler.ts";
    const extractionPath = "/src/features/assistance/extract.ts";
    const { BrowserCompiler } = await import(compilerPath);
    const { extractPdf } = await import(extractionPath);
    const compiler = new BrowserCompiler();
    const events: CompileEvent[] = [];
    try {
      await compiler.compile(
        { kind: "ephemeral", captureId: source.id, snapshot: source },
        crypto.randomUUID(),
        (event: CompileEvent) => events.push(event),
      );
      const result = events.at(-1);
      if (!result) throw new Error("Compiler returned no result");
      if (result.type !== "succeeded")
        return {
          state: result.state,
          diagnostics: result.diagnostics,
          text: "",
          pdf: [] as number[],
          pdfSha256: null,
          compilerBuildId: null,
        };
      const extraction = await extractPdf(
        new File([new Uint8Array(result.pdf)], "synthetic.pdf", {
          type: "application/pdf",
        }),
        new AbortController().signal,
      );
      return {
        state: "succeeded",
        diagnostics: result.diagnostics,
        text: extraction.lines
          .map((line: { text: string }) => line.text)
          .join(" ")
          .replace(/\s+/g, " "),
        pdf: [...result.pdf],
        pdfSha256: result.pdfSha256,
        compilerBuildId: result.compilerBuildId,
      };
    } finally {
      compiler.dispose();
    }
  }, snapshot);
}

export async function withBrowserCompiler<T>(run: (page: Page) => Promise<T>) {
  await verifyCompilerAssets();
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot allocate test port");
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  const origin = `http://127.0.0.1:${address.port}`;
  const require = createRequire(
    new URL("../apps/web/package.json", import.meta.url),
  );
  const vite = join(
    dirname(require.resolve("vite/package.json")),
    "bin/vite.js",
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(GROQ_|AI_|AUTH_|DATABASE_|TEST_DATABASE_|VITE_)/.test(key),
    ),
  );
  const child = spawn(
    process.execPath,
    [
      vite,
      "--host",
      "127.0.0.1",
      "--port",
      String(address.port),
      "--strictPort",
    ],
    { cwd: "apps/web", env, stdio: "ignore", windowsHide: true },
  );
  let startupError = false;
  child.on("error", () => {
    startupError = true;
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError || child.exitCode !== null)
        throw new Error("Synthetic browser server exited");
      ready = await fetch(`${origin}/compiler/manifest.json`, {
        signal: AbortSignal.timeout(1000),
      })
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("Synthetic browser server readiness timed out");
    const browser = await chromium.launch({ env });
    try {
      const page = await browser.newPage();
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      await page.goto(origin);
      return await run(page);
    } finally {
      await browser.close();
    }
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
}
