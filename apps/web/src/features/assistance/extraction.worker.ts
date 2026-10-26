import { type PdfLine, pdfExtractionSchema } from "@overleaf-pro/contracts";
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;
self.onmessage = async (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (
    !(data instanceof Uint8Array) ||
    data.byteLength < 8 ||
    data.byteLength > 5 * 1024 * 1024 ||
    new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-"
  ) {
    self.postMessage({ error: "Choose a valid PDF no larger than 5 MiB." });
    return;
  }
  const bytes = data.byteLength;
  const digest = await crypto.subtle.digest("SHA-256", data.slice());
  const pdfSha256 = [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  // PDF.js's default startup reads window.location. Supply a real parser port
  // when its display API is itself running inside a dedicated worker.
  const parser = new Worker(pdfjs.GlobalWorkerOptions.workerSrc, {
    type: "module",
  });
  // PDF.js 6.4.299 types port as null, but its runtime supports a Worker.
  // Browser E2E verifies this bridge against the pinned library.
  // @ts-expect-error Upstream constructor declaration omits the supported Worker port.
  const pdfWorker = new pdfjs.PDFWorker({ port: parser });
  const task = pdfjs.getDocument({
    worker: pdfWorker,
    data,
    stopAtErrors: true,
    useSystemFonts: false,
    disableFontFace: true,
    disableAutoFetch: true,
    verbosity: 0,
  });
  let encrypted = false;
  task.onPassword = () => {
    encrypted = true;
    void task.destroy();
  };
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 20)
      throw new Error("PDF analysis supports at most 20 pages.");
    const lines: PdfLine[] = [];
    let total = 0;
    let items = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const reader = page.streamTextContent().getReader();
      let text = "";
      let x = 0;
      let y = 0;
      let line = 0;
      const flush = () => {
        const trimmed = text.trim();
        if (trimmed)
          lines.push({ page: pageNumber, line: ++line, text: trimmed, x, y });
        text = "";
      };
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        for (const item of next.value.items) {
          if (!("str" in item)) continue;
          items++;
          total += item.str.length;
          if (items > 20000 || total > 100000)
            throw new Error("PDF extracted text exceeds analysis limits.");
          const px = Math.max(
            0,
            Math.min(1, item.transform[4] / viewport.width),
          );
          const py = Math.max(
            0,
            Math.min(1, 1 - item.transform[5] / viewport.height),
          );
          if (
            text &&
            (Math.abs(py - y) > 0.008 ||
              px < x - 0.02 ||
              text.length + item.str.length > 1900)
          )
            flush();
          if (!text) {
            x = px;
            y = py;
          }
          text += item.str;
          if (item.hasEOL) flush();
        }
      }
      flush();
      page.cleanup();
    }
    self.postMessage({
      extraction: pdfExtractionSchema.parse({
        pdfSha256,
        pdfBytes: bytes,
        pages: pdf.numPages,
        extractionVersion: "pdfjs-6.4.299-lines-v1",
        lines,
      }),
    });
  } catch (error) {
    self.postMessage({
      error: encrypted
        ? "Password-protected PDFs are unsupported."
        : error instanceof Error && /^PDF /.test(error.message)
          ? error.message
          : "PDF extraction failed. The file may be malformed, encrypted, or unsupported. No estimate was assigned.",
    });
  } finally {
    await task.destroy();
    pdfWorker.destroy();
    parser.terminate();
  }
};
