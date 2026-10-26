import { z } from "zod";

export const aiRequestSchema = z
  .object({
    requestId: z.uuid(),
    projectId: z.uuid(),
    baseRevision: z.int().positive(),
    mode: z.enum(["explain", "rewrite", "generate", "question", "diagnostic"]),
    instruction: z.string().trim().min(1).max(2000),
    fileIds: z
      .array(z.uuid())
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    selection: z
      .object({
        fileId: z.uuid(),
        from: z.int().nonnegative(),
        to: z.int().nonnegative(),
      })
      .strict()
      .optional(),
    diagnostics: z.string().max(4000).default(""),
    shareWithProvider: z.literal(true),
  })
  .strict();
export const aiOutputSchema = z
  .object({
    answer: z.string().min(1).max(8000),
    refused: z.boolean(),
    edits: z
      .array(
        z
          .object({
            fileId: z.uuid(),
            content: z
              .string()
              .max(20000)
              .refine(
                (v) =>
                  !v.includes("\0") &&
                  new TextDecoder("utf-8", { ignoreBOM: true }).decode(
                    new TextEncoder().encode(v),
                  ) === v &&
                  new TextEncoder().encode(v).length <= 24000,
              ),
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .refine((v) => new Set(v.edits.map((e) => e.fileId)).size === v.edits.length)
  .refine((v) => !v.refused || v.edits.length === 0);
export const aiProposalSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    baseRevision: z.int().positive(),
    status: z.enum([
      "pending",
      "ready",
      "refused",
      "failed",
      "expired",
      "rejected",
      "applied",
    ]),
    createdAt: z.iso.datetime(),
    model: z.string().max(120),
    promptVersion: z.literal("latex-assistant-v1"),
    result: aiOutputSchema.nullable(),
    failure: z.string().max(200).nullable(),
    usage: z
      .object({
        inputTokens: z.int().nonnegative(),
        outputTokens: z.int().nonnegative(),
      })
      .strict()
      .nullable(),
    backupSnapshotId: z.uuid().nullable(),
    appliedRevision: z.int().positive().nullable(),
  })
  .strict();
export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiOutput = z.infer<typeof aiOutputSchema>;
export type AiProposal = z.infer<typeof aiProposalSchema>;

export const requirementSchema = z
  .object({
    text: z.string().trim().min(1).max(120),
    kind: z.enum(["required", "preferred"]),
  })
  .strict();
export const pdfLineSchema = z
  .object({
    page: z.int().min(1).max(20),
    line: z.int().min(1).max(20000),
    text: z.string().min(1).max(2000),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export const pdfExtractionSchema = z
  .object({
    pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
    pdfBytes: z
      .int()
      .min(8)
      .max(5 * 1024 * 1024),
    pages: z.int().min(1).max(20),
    extractionVersion: z.literal("pdfjs-6.4.299-lines-v1"),
    lines: z.array(pdfLineSchema).max(20000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.lines.some((l) => l.page > v.pages) ||
      new Set(v.lines.map((l) => `${l.page}:${l.line}`)).size !==
        v.lines.length ||
      v.lines.reduce((s, l) => s + l.text.length, 0) > 100000
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid or oversized extraction",
      });
  });
export const resumeInputSchema = z
  .object({
    extraction: pdfExtractionSchema,
    requirements: z
      .array(requirementSchema)
      .max(30)
      .refine(
        (v) =>
          new Set(v.map((r) => `${r.kind}:${r.text.toLowerCase()}`)).size ===
          v.length,
        "Duplicate requirements",
      ),
  })
  .strict();
export const resumeReportSchema = z
  .object({
    rulesVersion: z.literal("resume-rules-v1"),
    pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
    supported: z.boolean(),
    estimate: z.int().min(0).max(100).nullable(),
    limitations: z.array(z.string().max(500)).max(10),
    findings: z
      .array(
        z
          .object({
            label: z.string(),
            state: z.enum(["detected", "not-detected", "unknown"]),
            weight: z.int(),
            contribution: z.int().nullable(),
            evidence: z.array(pdfLineSchema).max(5),
          })
          .strict(),
      )
      .max(10),
    matches: z
      .array(
        z
          .object({
            requirement: requirementSchema,
            state: z.enum(["evidence-found", "not-found", "unknown"]),
            evidence: z.array(pdfLineSchema).max(5),
          })
          .strict(),
      )
      .max(30),
    advice: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const savedResumeSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    input: resumeInputSchema,
    report: resumeReportSchema,
    attestation: z.literal("client-provided-extraction"),
  })
  .strict();
export const savedResumeListSchema = z
  .array(z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).strict())
  .max(20);
export type PdfExtraction = z.infer<typeof pdfExtractionSchema>;
export type PdfLine = z.infer<typeof pdfLineSchema>;
export type ResumeInput = z.infer<typeof resumeInputSchema>;
export type ResumeReport = z.infer<typeof resumeReportSchema>;
