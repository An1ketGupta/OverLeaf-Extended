import {
  type PdfExtraction,
  pdfExtractionSchema,
} from "@overleaf-pro/contracts";
export function extractPdf(
  file: File,
  signal: AbortSignal,
): Promise<PdfExtraction> {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024 || file.size < 8) {
      reject(new Error("Choose a PDF no larger than 5 MiB."));
      return;
    }
    if (signal.aborted) {
      reject(new Error("Analysis cancelled."));
      return;
    }
    const worker = new Worker(
      new URL("./extraction.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const abort = () => fail("Analysis cancelled. No estimate was assigned.");
    const timer = setTimeout(
      () =>
        fail(
          "PDF extraction timed out after 15 seconds. No estimate was assigned.",
        ),
      15000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      const parsed = pdfExtractionSchema.safeParse(event.data?.extraction);
      if (!parsed.success) {
        fail(
          typeof event.data?.error === "string"
            ? event.data.error
            : "Invalid extraction. No estimate was assigned.",
        );
        return;
      }
      cleanup();
      resolve(parsed.data);
    };
    worker.onerror = () => fail("PDF worker failed. No estimate was assigned.");
    void file
      .arrayBuffer()
      .then((buffer) => {
        if (!signal.aborted)
          worker.postMessage(new Uint8Array(buffer), [buffer]);
      })
      .catch(() => fail("Could not read PDF bytes."));
  });
}
