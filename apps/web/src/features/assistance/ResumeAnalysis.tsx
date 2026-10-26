import {
  type PdfExtraction,
  type PdfLine,
  type ResumeReport,
  requirementSchema,
  savedResumeListSchema,
  savedResumeSchema,
} from "@overleaf-pro/contracts";
import { analyzeResume } from "@overleaf-pro/resume";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { onLogout } from "../workspace/drafts.js";
import { PdfPreview } from "../workspace/PdfPreview.js";
import { assistanceRequest } from "./api.js";
import { takeCompiledPdf } from "./compiled-pdf.js";
import { extractPdf } from "./extract.js";
import "../workspace/workspace.css";
import "./assistance.css";

export function ResumeAnalysis() {
  const [file, setFile] = useState<File>();
  const [compiledOrigin, setCompiledOrigin] =
    useState<ReturnType<typeof takeCompiledPdf>>();
  useEffect(() => {
    const pending = takeCompiledPdf();
    if (pending) {
      setFile(pending.file);
      setCompiledOrigin(pending);
    }
  }, []);
  const [page, setPage] = useState(1);
  const [extraction, setExtraction] = useState<PdfExtraction>();
  const [required, setRequired] = useState("");
  const [preferred, setPreferred] = useState("");
  const [report, setReport] = useState<ResumeReport>();
  const [message, setMessage] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; createdAt: string }[]>([]);
  const controller = useRef<AbortController>(undefined);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(
    () =>
      onLogout(() => {
        generation.current++;
        controller.current?.abort();
        setFile(undefined);
        setCompiledOrigin(undefined);
        setExtraction(undefined);
        setReport(undefined);
        setSaved([]);
        setMessage("Signed out. Private reports cleared from this page.");
      }),
    [],
  );
  const requirements = () =>
    [
      ...required
        .split("\n")
        .filter((v) => v.trim())
        .map((text) => ({ text, kind: "required" as const })),
      ...preferred
        .split("\n")
        .filter((v) => v.trim())
        .map((text) => ({ text, kind: "preferred" as const })),
    ].map((v) => requirementSchema.parse(v));
  async function run(operation: () => Promise<void>) {
    setSaving(true);
    setMessage("");
    const current = generation.current;
    try {
      await operation();
    } catch (error) {
      if (alive.current && current === generation.current)
        setMessage(
          error instanceof Error ? error.message : "Report unavailable.",
        );
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  async function refreshSaved() {
    const current = generation.current;
    const result = await assistanceRequest("resume-analyses");
    if (alive.current && current === generation.current)
      setSaved(savedResumeListSchema.parse(result));
  }
  useEffect(() => {
    const current = ++generation.current;
    controller.current?.abort();
    setExtraction(undefined);
    setReport(undefined);
    setMessage("");
    setPage(1);
    if (!file) {
      setExtracting(false);
      return;
    }
    const next = new AbortController();
    controller.current = next;
    setExtracting(true);
    void extractPdf(file, next.signal)
      .then((result) => {
        if (current !== generation.current || !alive.current) return;
        setExtraction(result);
        setReport(analyzeResume({ extraction: result, requirements: [] }));
      })
      .catch((error) => {
        if (current === generation.current && alive.current)
          setMessage(
            error instanceof Error ? error.message : "Extraction failed.",
          );
      })
      .finally(() => {
        if (current === generation.current && alive.current)
          setExtracting(false);
      });
    return () => next.abort();
  }, [file]);
  function evidence(items: PdfLine[]) {
    return items.map((item) => (
      <button
        type="button"
        className="evidence-button"
        key={`${item.page}:${item.line}`}
        onClick={() => setPage(item.page)}
      >
        p.{item.page}, line {item.line} ({Math.round(item.x * 100)}%,{" "}
        {Math.round(item.y * 100)}%): {item.text}
      </button>
    ));
  }
  return (
    <main className="resume-analysis">
      <nav className="inline-actions">
        <Link to="/projects">← Projects</Link>
        <Link to="/">Home</Link>
      </nav>
      <h1>Understand your resume PDF</h1>
      {compiledOrigin && (
        <p>
          Generated locally from saved revision {compiledOrigin.revision}.
          Analysis uses these exact PDF bytes; browser provenance is unverified
          by the server.
        </p>
      )}
      <p>
        Open a PDF to analyze its actual bytes locally. Inspect text beside the
        PDF. Saving a report shares extracted text and requirements with your
        private account; PDF bytes stay in this browser. AI is not required.
      </p>
      <div className="analysis-columns">
        <div className="analysis-preview">
          <PdfPreview
            externalFile={file}
            onFileChange={(file) => {
              setFile(file);
              setCompiledOrigin(undefined);
            }}
            requestedPage={page}
          />
        </div>
        <section aria-label="Resume report" className="analysis-report">
          {extracting && (
            <p role="status">
              Extracting PDF text…{" "}
              <button type="button" onClick={() => controller.current?.abort()}>
                Cancel extraction
              </button>
            </p>
          )}
          <p role="status">{message}</p>
          {extraction && (
            <>
              <p className="hash-label">
                Exact PDF SHA-256: {extraction.pdfSha256}
                <br />
                {extraction.pages} pages · {extraction.pdfBytes} bytes ·{" "}
                {extraction.extractionVersion}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    const reqs = requirements();
                    if (reqs.length > 30)
                      throw new Error("Use at most 30 requirements.");
                    setReport(
                      analyzeResume({ extraction, requirements: reqs }),
                    );
                    setMessage(
                      "Analysis updated. Saved reports remain unchanged.",
                    );
                  } catch {
                    setMessage(
                      "Use up to 30 requirements, each at most 120 characters.",
                    );
                  }
                }}
              >
                <p>
                  Enter one concrete term or exact phrase per line. Separate
                  required qualifications from preferences. Phrase matches
                  identify text evidence only; they do not establish
                  proficiency, years of experience, or qualification truth.
                </p>
                <label>
                  Required terms or phrases
                  <textarea
                    maxLength={3600}
                    value={required}
                    onChange={(e) => setRequired(e.target.value)}
                    placeholder={"Java\nPostgreSQL"}
                  />
                </label>
                <label>
                  Preferred terms or phrases
                  <textarea
                    maxLength={3600}
                    value={preferred}
                    onChange={(e) => setPreferred(e.target.value)}
                    placeholder="TypeScript"
                  />
                </label>
                <button type="submit" disabled={saving}>
                  Update analysis and job coverage
                </button>
              </form>
            </>
          )}
          {report && (
            <>
              <h2>
                {report.estimate === null
                  ? "Compatibility: unknown"
                  : `Our compatibility estimate: ${report.estimate}/100`}
              </h2>
              <ul>
                {report.limitations.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              <table>
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Finding / contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {report.findings.map((f) => (
                    <tr key={f.label}>
                      <td>
                        {f.label}
                        {evidence(f.evidence)}
                      </td>
                      <td>
                        {f.state} · {f.contribution ?? "unknown"}/{f.weight}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Job evidence coverage</h3>
              {["required", "preferred"].map((kind) => {
                const matches = report.matches.filter(
                  (m) => m.requirement.kind === kind,
                );
                return (
                  <section key={kind}>
                    <h4>
                      {kind === "required" ? "Required" : "Preferred"}:{" "}
                      {report.supported
                        ? `${matches.filter((m) => m.state === "evidence-found").length}/${matches.length} terms with evidence`
                        : "unknown"}
                    </h4>
                    {matches.map((m) => (
                      <article key={m.requirement.text}>
                        <strong>{m.requirement.text}</strong> · {m.state}
                        {evidence(m.evidence)}
                      </article>
                    ))}
                  </section>
                );
              })}
              <h3>Factual writing suggestions</h3>
              <ul>
                {report.advice.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              <small>
                {report.rulesVersion} · controlled aliases; repeated keywords
                give no additional credit.
              </small>
              <p>
                <button
                  type="button"
                  disabled={saving || !extraction}
                  onClick={() =>
                    void run(async () => {
                      if (!extraction) return;
                      // Save the exact analyzed requirement set, never newly edited form text.
                      const current = generation.current;
                      const result = savedResumeSchema.parse(
                        await assistanceRequest("resume-analyses", "POST", {
                          extraction,
                          requirements: report.matches.map(
                            (m) => m.requirement,
                          ),
                        }),
                      );
                      if (alive.current && current === generation.current) {
                        setMessage(
                          `Private report saved: ${result.id}. Client-provided extraction, not server-attested PDF output.`,
                        );
                        await refreshSaved();
                      }
                    })
                  }
                >
                  Save private report
                </button>
              </p>
            </>
          )}
          {extraction && (
            <details>
              <summary>Inspect all extracted text and page locations</summary>
              <div className="extracted-text">{evidence(extraction.lines)}</div>
            </details>
          )}
          <h3>Saved reports</h3>
          <button
            type="button"
            disabled={saving}
            onClick={() => void run(refreshSaved)}
          >
            Load my saved reports
          </button>
          <ul className="history-list">
            {saved.map((item) => (
              <li key={item.id}>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <button
                  type="button"
                  disabled={saving || extracting}
                  onClick={() =>
                    void run(async () => {
                      const current = generation.current;
                      const data = savedResumeSchema.parse(
                        await assistanceRequest(`resume-analyses/${item.id}`),
                      );
                      if (!alive.current || current !== generation.current)
                        return;
                      if (
                        extraction?.pdfSha256 !==
                        data.input.extraction.pdfSha256
                      ) {
                        setMessage(
                          "Open the exact PDF matching this saved report to compare evidence beside its pages. Saved extraction and report can be downloaded below.",
                        );
                        const blob = new Blob([JSON.stringify(data, null, 2)], {
                          type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `resume-report-${data.id}.json`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        return;
                      }
                      setReport(data.report);
                      setRequired(
                        data.input.requirements
                          .filter((r) => r.kind === "required")
                          .map((r) => r.text)
                          .join("\n"),
                      );
                      setPreferred(
                        data.input.requirements
                          .filter((r) => r.kind === "preferred")
                          .map((r) => r.text)
                          .join("\n"),
                      );
                      setMessage(
                        "Saved report loaded for this exact PDF hash. Extraction is client-provided.",
                      );
                    })
                  }
                >
                  Open report
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void run(async () => {
                      await assistanceRequest(
                        `resume-analyses/${item.id}`,
                        "DELETE",
                      );
                      await refreshSaved();
                    })
                  }
                >
                  Delete report
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
