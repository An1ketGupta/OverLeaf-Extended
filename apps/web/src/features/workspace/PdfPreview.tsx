import { limits } from "@overleaf-pro/contracts";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

export function PdfPreview() {
  const [file, setFile] = useState<File>();
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(400);
  const [message, setMessage] = useState("");
  const [rendered, setRendered] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const pageHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPdf(undefined);
    setPage(1);
    setZoom(1);
    setRendered(false);
    if (!file) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setMessage("Opening PDF…");
    void (async () => {
      if (file.size > limits.pdfBytes)
        throw new Error("Choose a PDF no larger than 5 MiB.");
      const data = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-")
        throw new Error("This file does not contain a PDF header.");
      const engine = await import("pdfjs-dist");
      if (cancelled) return;
      engine.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
      const task = engine.getDocument({
        data,
        stopAtErrors: true,
        useSystemFonts: true,
      });
      destroy = () => {
        void task.destroy();
      };
      task.onPassword = () => {
        if (!cancelled)
          setMessage(
            "Password-protected PDFs are not supported in this preview.",
          );
        void task.destroy();
      };
      const document = await task.promise;
      if (cancelled) return;
      if (document.numPages > 20)
        throw new Error("This preview supports PDFs with up to 20 pages.");
      setPdf(document);
      setMessage("");
    })().catch((error: unknown) => {
      if (!cancelled)
        setMessage(
          error instanceof Error && /Choose|header|20 pages/.test(error.message)
            ? error.message
            : "Could not open this PDF. It may be damaged or password-protected.",
        );
      destroy?.();
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [file]);
  useEffect(() => {
    const host = pageHost.current;
    if (!pdf || !host) return;
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `PDF page ${page} of ${pdf.numPages}`);
    host.replaceChildren(canvas);
    setRendered(false);
    void pdf
      .getPage(page)
      .then(async (documentPage) => {
        if (cancelled) return;
        const original = documentPage.getViewport({ scale: 1 });
        const scale = Math.min(
          (Math.max(width - 40, 100) / original.width) * zoom,
          2,
        );
        const viewport = documentPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (viewport.width * viewport.height * ratio * ratio > 8_000_000)
          throw new Error("Page dimensions exceed preview limits.");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const task = documentPage.render({
          canvas,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        cancelRender = () => task.cancel();
        await task.promise;
        if (!cancelled) {
          setRendered(true);
          setMessage("");
        }
      })
      .catch(() => {
        if (!cancelled)
          setMessage(
            "This page could not be rendered within the preview limits.",
          );
      });
    return () => {
      cancelled = true;
      cancelRender?.();
      canvas.remove();
    };
  }, [pdf, page, zoom, width]);
  return (
    <section className="pdf-panel" aria-label="PDF preview">
      <div className="panel-heading">
        <span>PDF preview</span>
        <span className="subtle">
          {pdf ? `${pdf.numPages} pages` : "No output yet"}
        </span>
      </div>
      <div className="preview-controls">
        <label className="quiet-button upload-button">
          Open PDF
          <input
            aria-label="Open PDF"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) setFile(selected);
              event.target.value = "";
            }}
          />
        </label>
        {file && (
          <button
            type="button"
            onClick={() => {
              setFile(undefined);
              setMessage("");
            }}
          >
            Close PDF
          </button>
        )}
        {pdf && (
          <>
            <button
              type="button"
              aria-label="Previous PDF page"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              ‹
            </button>
            <span>
              {page} / {pdf.numPages}
            </span>
            <button
              type="button"
              aria-label="Next PDF page"
              disabled={page === pdf.numPages}
              onClick={() => setPage(page + 1)}
            >
              ›
            </button>
            <select
              aria-label="PDF zoom"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            >
              <option value={1}>Fit width</option>
              <option value={1.25}>125%</option>
              <option value={1.5}>150%</option>
            </select>
          </>
        )}
      </div>
      <div className="pdf-viewport" ref={container}>
        {!file ? (
          <div className="preview-empty">
            <div className="paper-icon" aria-hidden="true">
              Aa
              <span />
            </div>
            <span className="eyebrow">ROOM FOR THE FINISHED DRAFT</span>
            <h2>
              Your words,
              <br />
              <em>beautifully set.</em>
            </h2>
            <p>
              Your compiled document will appear here when compilation is
              available.
            </p>
            <p className="subtle">
              You can open an existing PDF to preview it locally.
            </p>
          </div>
        ) : (
          <>
            <div className="pdf-file-label">
              Opened locally · {file.name}
              <br />
              <span>This PDF is not compiled from this project.</span>
            </div>
            <p className="pdf-message" role="status">
              {message ||
                (rendered ? `Page ${page} ready.` : "Rendering page…")}
            </p>
            <div ref={pageHost} className="pdf-page" />
          </>
        )}
      </div>
    </section>
  );
}
