import {
  type CompileEvent,
  type CompileInput,
  compileEventSchema,
  compileInputSchema,
  compilerManifestSchema,
  compilerRuntimeEventSchema,
  limits,
  projectPathSchema,
  type SourceSnapshot,
} from "@overleaf-pro/contracts";

export const compilerBuildId = "busytex-tl2025-0ee2c65fb1ab";
export async function sha256(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function diagnostics(log: string) {
  const entries: {
    severity: "error" | "warning" | "info";
    message: string;
    path?: string;
    line?: number;
  }[] = [];
  for (const line of log.split(/\r?\n/)) {
    const located = /^(?:\.\/|\/work\/)?([^:]+\.tex):(\d+):\s*(.*)$/.exec(line);
    const warning = /Warning:|warning:|Overfull|Underfull/.test(line);
    if (located) {
      const path = projectPathSchema.safeParse(located[1]);
      entries.push({
        severity: "error",
        message: (located[3] ?? "LaTeX error").slice(0, 4000),
        ...(path.success ? { path: path.data } : {}),
        line: Math.max(1, Math.min(Number(located[2]), 1_000_000)),
      });
    } else if (/^!/.test(line) || warning)
      entries.push({
        severity: warning ? "warning" : "error",
        message: line.slice(0, 4000),
      });
    if (entries.length === 100) break;
  }
  return entries;
}
type Loaded = {
  module: WebAssembly.Module;
  runtime: Uint8Array;
  index: unknown;
  engineCode: string;
};

export class BrowserCompiler {
  private loaded: Loaded | undefined;
  private controller: AbortController | undefined;
  private worker: Worker | undefined;
  cancel() {
    this.controller?.abort();
    this.worker?.terminate();
    this.worker = undefined;
  }
  dispose() {
    this.cancel();
    this.loaded = undefined;
  }
  private async load(signal: AbortSignal): Promise<Loaded> {
    if (this.loaded) return this.loaded;
    const fetchBytes = async (path: string) => {
      const response = await fetch(`/compiler/${path}`, {
        credentials: "omit",
        signal,
        cache: "no-cache",
      });
      if (!response.ok)
        throw new Error(
          "Compiler assets are unavailable. Follow the local compiler setup in README.",
        );
      if (
        Number(response.headers.get("content-length") ?? 0) >
        10 * 1024 * 1024
      )
        throw new Error("Compiler asset size limit");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024)
        throw new Error("Compiler asset size limit");
      return bytes;
    };
    const manifestBytes = await fetchBytes("manifest.json");
    const manifest = compilerManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(manifestBytes)),
    );
    const loadParts = async (parts: typeof manifest.shards.engine) => {
      const chunks = await Promise.all(
        parts.map(async (part) => {
          const bytes = await fetchBytes(part.path);
          if (
            bytes.length !== part.bytes ||
            (await sha256(bytes)) !== part.sha256
          )
            throw new Error("Compiler asset integrity check failed");
          return bytes;
        }),
      );
      const result = new Uint8Array(chunks.reduce((s, b) => s + b.length, 0));
      let offset = 0;
      for (const b of chunks) {
        result.set(b, offset);
        offset += b.length;
      }
      return result;
    };
    const [wasm, compressed, indexBytes, engineBytes] = await Promise.all([
      loadParts(manifest.shards.engine),
      loadParts(manifest.shards.runtime),
      fetchBytes("runtime.json"),
      fetchBytes("engine.js"),
    ]);
    if (
      (await sha256(wasm)) !==
        "3efcd116f16e058048f0870d5fbe75eafe6441063d9e7f83e617bf57102645bd" ||
      (await sha256(engineBytes)) !==
        "53374fbb04e9b485c5854ae107cb68c3d3b79735e684c6049a7597013a23ff2b" ||
      (await sha256(indexBytes)) !== manifest.indexSha256
    )
      throw new Error("Compiler asset integrity check failed");
    const reader = new Blob([new Uint8Array(compressed)])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    const runtime = new Uint8Array(manifest.runtimeBytes);
    let offset = 0;
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > runtime.length) {
        await reader.cancel();
        throw new Error("Compiler runtime size limit");
      }
      runtime.set(value, offset);
      offset += value.length;
    }
    if (
      offset !== runtime.length ||
      (await sha256(runtime)) !== manifest.runtimeSha256
    )
      throw new Error("Compiler runtime integrity check failed");
    const module = await WebAssembly.compile(new Uint8Array(wasm));
    signal.throwIfAborted();
    this.loaded = {
      module,
      runtime,
      index: JSON.parse(new TextDecoder().decode(indexBytes)),
      engineCode: new TextDecoder().decode(engineBytes),
    };
    return this.loaded;
  }
  async compile(
    raw: CompileInput,
    requestId: string,
    receive: (event: CompileEvent) => void,
  ) {
    this.cancel();
    const input = compileInputSchema.parse(raw);
    const snapshot = input.snapshot;
    const controller = new AbortController();
    this.controller = controller;
    const state = (
      value: "loading" | "running" | "failed" | "timed-out" | "cancelled",
      message?: string,
    ) =>
      receive(
        compileEventSchema.parse({
          type: "state",
          requestId,
          state: value,
          diagnostics: message
            ? [{ severity: "error", message: message.slice(0, 4000) }]
            : [],
        }),
      );
    let timer = setTimeout(() => controller.abort("load-timeout"), 30_000);
    try {
      state("loading");
      const loaded = await this.load(controller.signal);
      const files = await verifiedFiles(snapshot);
      controller.signal.throwIfAborted();
      clearTimeout(timer);
      timer = setTimeout(
        () => controller.abort("compile-timeout"),
        limits.compileTimeoutMs,
      );
      const result = await new Promise<
        ReturnType<typeof compilerRuntimeEventSchema.parse>
      >((resolve, reject) => {
        const worker = new Worker("/compiler/worker.js");
        this.worker = worker;
        const abort = () => {
          worker.terminate();
          reject(new Error("Compilation interrupted"));
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        worker.onerror = () => {
          controller.signal.removeEventListener("abort", abort);
          worker.terminate();
          reject(new Error("Compiler worker failed. Retry compilation."));
        };
        worker.onmessage = ({ data }: MessageEvent<unknown>) => {
          const event = compilerRuntimeEventSchema.safeParse(data);
          if (!event.success) {
            controller.signal.removeEventListener("abort", abort);
            worker.terminate();
            reject(new Error("Invalid compiler response"));
            return;
          }
          if (event.data.type === "running") {
            state("running");
            return;
          }
          controller.signal.removeEventListener("abort", abort);
          worker.terminate();
          this.worker = undefined;
          resolve(event.data);
        };
        worker.postMessage({
          ...loaded,
          files,
          mainFile: snapshot.mainFile,
          passes: 3,
        });
      });
      const messages = diagnostics(result.logs ?? "");
      if (result.type !== "succeeded" || !result.pdf) {
        receive(
          compileEventSchema.parse({
            type: "state",
            requestId,
            state: "failed",
            diagnostics: messages.length
              ? messages
              : [
                  {
                    severity: "error",
                    message:
                      "Compilation failed. Check the source and supported packages.",
                  },
                ],
          }),
        );
        return;
      }
      const bytes = new Uint8Array(result.pdf);
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
        throw new Error("Compiler returned invalid PDF bytes");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
      const task = pdfjs.getDocument({
        data: bytes.slice(),
        stopAtErrors: true,
      });
      const stop = () => {
        void task.destroy();
      };
      controller.signal.addEventListener("abort", stop, { once: true });
      try {
        const pdf = await task.promise;
        if (pdf.numPages > 20)
          throw new Error("Compiled PDF exceeds the 20-page preview limit");
      } finally {
        controller.signal.removeEventListener("abort", stop);
        await task.destroy();
      }
      controller.signal.throwIfAborted();
      receive(
        compileEventSchema.parse({
          type: "succeeded",
          requestId,
          snapshotId: null,
          captureId: input.captureId,
          projectId: snapshot.projectId,
          revision: snapshot.revision,
          compilerBuildId,
          pdf: bytes,
          pdfSha256: await sha256(bytes),
          diagnostics: messages,
        }),
      );
    } catch (error) {
      if (controller.signal.aborted)
        state(
          controller.signal.reason === "load-timeout" ||
            controller.signal.reason === "compile-timeout"
            ? "timed-out"
            : "cancelled",
        );
      else
        state(
          "failed",
          error instanceof Error ? error.message : "Compilation failed",
        );
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (this.controller === controller) {
        this.worker?.terminate();
        this.worker = undefined;
        this.controller = undefined;
      }
    }
  }
}
async function verifiedFiles(snapshot: SourceSnapshot) {
  const files = [];
  for (const file of snapshot.files) {
    const bytes = new TextEncoder().encode(file.content);
    if ((await sha256(bytes)) !== file.sha256)
      throw new Error("Source integrity check failed");
    files.push({ path: file.path, bytes });
  }
  for (const asset of snapshot.assets) {
    const bytes = Uint8Array.from(atob(asset.dataBase64), (c) =>
      c.charCodeAt(0),
    );
    if ((await sha256(bytes)) !== asset.sha256)
      throw new Error("Asset integrity check failed");
    files.push({ path: asset.path, bytes });
  }
  return files;
}
