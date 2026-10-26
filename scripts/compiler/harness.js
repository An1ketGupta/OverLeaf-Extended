/* Loaded only by the loopback synthetic feasibility runner. */
let runtime;
let index;
let module;
let engineCode;
globalThis.initializeProbe = async (options = {}) => {
  const started = performance.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 30_000);
  const cancel =
    options.cancelAfterMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(), options.cancelAfterMs);
  try {
    const shards = await fetch("/shards.json", {
      signal: controller.signal,
    }).then((r) => r.json());
    const load = async (parts) => {
      engineCode = await fetch("/engine.js", {
        credentials: "omit",
        signal: controller.signal,
      }).then((r) => r.text());
      const buffers = await Promise.all(
        parts.map(async (part) => {
          const response = await fetch(`/${part.path}`, {
            credentials: "omit",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Shard unavailable");
          const bytes = new Uint8Array(await response.arrayBuffer());
          const digest = new Uint8Array(
            await crypto.subtle.digest("SHA-256", bytes),
          );
          const sha256 = Array.from(digest, (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          if (bytes.length !== part.bytes || sha256 !== part.sha256)
            throw new Error("Shard integrity failed");
          return bytes;
        }),
      );
      const joined = new Uint8Array(
        buffers.reduce((size, bytes) => size + bytes.length, 0),
      );
      let offset = 0;
      for (const bytes of buffers) {
        joined.set(bytes, offset);
        offset += bytes.length;
      }
      return joined;
    };
    const [wasm, compressed, metadata] = await Promise.all([
      load(shards.engine),
      load(shards.runtime),
      fetch("/runtime.json", { signal: controller.signal }).then((r) =>
        r.json(),
      ),
    ]);
    const nextRuntime = new Uint8Array(
      await new Response(
        new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
    const nextModule = await WebAssembly.compile(wasm);
    controller.signal.throwIfAborted();
    index = metadata;
    runtime = nextRuntime;
    module = nextModule;
    return {
      durationMs: performance.now() - started,
      decodedRuntimeBytes: runtime.length,
    };
  } finally {
    clearTimeout(deadline);
    clearTimeout(cancel);
    controller.abort();
  }
};

globalThis.runProbe = (input) =>
  new Promise((resolve) => {
    const worker = new Worker("/worker.js");
    const started = performance.now();
    let cancel;
    let enteredRun = false;
    let ticks = 0;
    const heartbeat = setInterval(() => ticks++, 20);
    const finish = (result) => {
      worker.terminate();
      clearTimeout(deadline);
      clearTimeout(cancel);
      clearInterval(heartbeat);
      resolve({
        ...result,
        wallMs: performance.now() - started,
        uiTicks: ticks,
        enteredRun,
      });
    };
    const deadline = setTimeout(
      () => finish({ type: "timed-out" }),
      input.timeoutMs,
    );
    worker.onerror = (event) =>
      finish({ type: "failed", message: event.message });
    worker.onmessage = ({ data }) => {
      if (data.type === "running") {
        enteredRun = true;
        if (input.cancel && !cancel)
          cancel = setTimeout(() => finish({ type: "cancelled" }), 50);
        return;
      }
      finish({ ...data, pdf: data.pdf ? Array.from(data.pdf) : undefined });
    };
    worker.postMessage({
      module,
      engineCode,
      index,
      runtime,
      mainFile: input.mainFile,
      passes: input.passes,
      files: input.files.map((file) => ({
        path: file.path,
        bytes: new Uint8Array(file.bytes),
      })),
    });
  });

globalThis.inspectProbe = async (bytes) => {
  const pdfjs = await import("/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 20) throw new Error("Page limit");
    const pages = [];
    document.body.replaceChildren();
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str ?? "").join(" "));
      const canvas = document.createElement("canvas");
      const viewport = page.getViewport({ scale: 1 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      document.body.append(canvas);
      await page.render({ canvas, viewport }).promise;
    }
    return { pages, pageCount: pdf.numPages };
  } finally {
    await task.destroy();
  }
};
