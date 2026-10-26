import {
  type PdfLine,
  type ResumeInput,
  type ResumeReport,
  resumeInputSchema,
  resumeReportSchema,
} from "@overleaf-pro/contracts";

const aliases: Record<string, string[]> = {
  javascript: ["javascript", "js"],
  typescript: ["typescript", "ts"],
  "node.js": ["node.js", "nodejs"],
  "react.js": ["react.js", "reactjs", "react"],
  postgresql: ["postgresql", "postgres"],
  "c++": ["c++"],
  "c#": ["c#"],
};
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑–—]/g, "-");
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function containsTerm(text: string, term: string) {
  const normalized = normalize(term);
  const candidates = aliases[normalized] ??
    Object.values(aliases).find((group) => group.includes(normalized)) ?? [
      term,
    ];
  return candidates.some((t) =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}_+#])${escaped(normalize(t)).replace(/\s+/g, "\\s+")}(?=$|[^\\p{L}\\p{N}_+#])`,
      "u",
    ).test(normalize(text)),
  );
}
export function analyzeResume(input: ResumeInput): ResumeReport {
  const { extraction, requirements } = resumeInputSchema.parse(input);
  const { lines, pages } = extraction;
  const all = lines.map((l) => l.text).join("\n");
  const textPages = new Set(
    lines.filter((l) => /\p{L}/u.test(l.text)).map((l) => l.page),
  );
  const supported =
    (all.match(/\p{L}/gu)?.length ?? 0) >= 80 &&
    textPages.size === pages &&
    ![...all].some((c) => c.charCodeAt(0) < 9 || c === "\uFFFD");
  const limitations = [
    "Our compatibility estimate describes detected text structure, not an employer's ATS score, parser simulation, or hiring probability.",
    "PDF reading order, columns, ligatures, hidden text, and fonts can distort extraction. Inspect the text and evidence against the PDF. OCR is not supported.",
    "Not detected means no evidence in extracted text; it does not establish that a qualification is absent. Dates and contact details are pattern detections, not verified facts.",
  ];
  if (!supported)
    limitations.push(
      "Extraction is incomplete, image-only, too short, or contains decoding errors. All checks are unknown; no estimate is assigned.",
    );
  if (lines.some((l) => l.x > 0.5))
    limitations.push(
      "Text appears away from the left column. Check reading order carefully; this may be a multi-column layout.",
    );
  const rules = [
    {
      label: "Email contact",
      weight: 15,
      test: (s: string) => /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(s),
    },
    {
      label: "Phone contact",
      weight: 10,
      test: (s: string) =>
        [...s.matchAll(/\+?\d[\d ()-]{6,}\d/g)].some((m) => {
          const count = m[0].replace(/\D/g, "").length;
          return count >= 10 && count <= 15;
        }),
    },
    {
      label: "Experience heading",
      weight: 20,
      test: (s: string) =>
        /^\s*(work\s+|professional\s+)?experience\s*[:|]?\s*$/i.test(s),
    },
    {
      label: "Education heading",
      weight: 15,
      test: (s: string) => /^\s*education\s*[:|]?\s*$/i.test(s),
    },
    {
      label: "Skills heading",
      weight: 15,
      test: (s: string) => /^\s*(technical\s+)?skills\s*[:|]?\s*$/i.test(s),
    },
    {
      label: "Date patterns",
      weight: 10,
      test: (s: string) => /\b(19|20)\d{2}\b/.test(s),
    },
    {
      label: "Bullet structure",
      weight: 15,
      test: (s: string) => /^\s*[•●▪*-]\s+\S/u.test(s),
    },
  ];
  const findings: ResumeReport["findings"] = rules.map((rule) => {
    const evidence = supported
      ? lines.filter((l) => rule.test(l.text)).slice(0, 5)
      : [];
    return {
      label: rule.label,
      weight: rule.weight,
      state: !supported
        ? "unknown"
        : evidence.length
          ? "detected"
          : "not-detected",
      contribution: supported ? (evidence.length ? rule.weight : 0) : null,
      evidence,
    };
  });
  const matches: ResumeReport["matches"] = requirements.map((requirement) => {
    const evidence: PdfLine[] = supported
      ? lines.filter((l) => containsTerm(l.text, requirement.text)).slice(0, 5)
      : [];
    return {
      requirement,
      state: !supported
        ? "unknown"
        : evidence.length
          ? "evidence-found"
          : "not-found",
      evidence,
    };
  });
  return resumeReportSchema.parse({
    rulesVersion: "resume-rules-v1",
    pdfSha256: extraction.pdfSha256,
    supported,
    estimate: supported
      ? findings.reduce((s, f) => s + (f.contribution ?? 0), 0)
      : null,
    limitations,
    findings,
    matches,
    advice: supported
      ? [
          "Use action + task + verified outcome when rewriting a bullet. Supply a real baseline, time frame, or metric if available; otherwise retain a factual qualitative result.",
          "For each requirement without evidence, check your actual experience. Add only facts you can support; repeating keywords does not improve this analysis.",
          "Review section headings and reading order in the extracted text. This rubric checks English headings and cannot assess visual quality, qualification truth, seniority, or date chronology.",
        ]
      : [
          "Try exporting a text-based PDF, then inspect its extracted text. Do not infer missing qualifications from this extraction.",
        ],
  });
}
