import type { PdfExtraction } from "@overleaf-pro/contracts";
export const resumeLines = [
  "Avery Chen",
  "avery@example.test | +1 (555) 010-1234",
  "Experience",
  "Software Engineer, Example Studio 2021-2024",
  "- Built JavaScript services with PostgreSQL for internal reporting.",
  "- Improved build reliability through automated tests and code review.",
  "Education",
  "BSc Computer Science, Example University 2020",
  "Skills",
  "JavaScript, TypeScript, PostgreSQL, React",
];
export function extracted(lines = resumeLines): PdfExtraction {
  return {
    pdfSha256: "a".repeat(64),
    pdfBytes: 500,
    pages: 1,
    extractionVersion: "pdfjs-6.4.299-lines-v1",
    lines: lines.map((text, i) => ({
      page: 1,
      line: i + 1,
      text,
      x: 0.1,
      y: 0.1 + i * 0.05,
    })),
  };
}
// Original synthetic PDF fixture, no compiler or PDF-generation product substitute.
export function fixturePdf(
  pages: string[][] = [resumeLines],
  encrypted = false,
) {
  const escapePdf = (s: string) => s.replace(/([\\()])/g, "\\$1");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const lines of pages) {
    const stream = `BT /F1 12 Tf 50 750 Td 18 TL ${lines.map((s, i) => `${i ? "T* " : ""}(${escapePdf(s)}) Tj`).join("\n")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  if (encrypted)
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"00".repeat(32)}> /U <${"01".repeat(32)}> /P -4 >>`,
    );
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<${"ab".repeat(16)}><${"ab".repeat(16)}>]` : ""} >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
