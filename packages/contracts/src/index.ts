import { z } from "zod";

export const limits = {
  textFileBytes: 256 * 1024,
  assetBytes: 2 * 1024 * 1024,
  projectBytes: 8 * 1024 * 1024,
  projectFiles: 50,
  compileTimeoutMs: 15_000,
  pdfBytes: 5 * 1024 * 1024,
} as const;

export const errorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "UNAUTHORIZED",
          "FORBIDDEN",
          "NOT_FOUND",
          "CONFLICT",
          "INVALID_REQUEST",
          "UNAVAILABLE",
          "INTERNAL",
        ]),
        message: z.string(),
        requestId: z.string(),
      })
      .strict(),
  })
  .strict();
export const healthSchema = z
  .object({ status: z.literal("ok"), service: z.literal("overleaf-pro-api") })
  .strict();
export const readinessSchema = z
  .object({
    status: z.enum(["ready", "unavailable"]),
    database: z.enum(["ready", "not-configured", "unavailable"]),
  })
  .strict();
export const sessionSchema = z
  .object({
    user: z
      .object({ id: z.string(), name: z.string(), email: z.email() })
      .strict(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const projectPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes(":") &&
      [...path].every(
        (char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
      ) &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Use a relative POSIX path without traversal or empty segments",
  );
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceFileSchema = z
  .object({
    id: z.uuid(),
    path: projectPathSchema,
    version: z.int().positive(),
    content: z
      .string()
      .refine(
        (value) =>
          new TextEncoder().encode(value).length <= limits.textFileBytes,
        "Text file too large",
      ),
    sha256: hashSchema,
  })
  .strict();
export const sourceSnapshotSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    revision: z.int().positive(),
    mainFile: projectPathSchema,
    createdAt: z.iso.datetime(),
    files: z.array(sourceFileSchema).min(1).max(limits.projectFiles),
    assets: z
      .array(
        z
          .object({
            path: projectPathSchema,
            sha256: hashSchema,
            bytes: z.int().min(0).max(limits.assetBytes),
          })
          .strict(),
      )
      .max(limits.projectFiles),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const paths = [...snapshot.files, ...snapshot.assets].map(
      (file) => file.path,
    );
    if (new Set(paths).size !== paths.length)
      context.addIssue({ code: "custom", message: "Duplicate snapshot paths" });
    if (!snapshot.files.some((file) => file.path === snapshot.mainFile))
      context.addIssue({ code: "custom", message: "Main file is missing" });
    const size =
      snapshot.files.reduce(
        (sum, file) => sum + new TextEncoder().encode(file.content).length,
        0,
      ) + snapshot.assets.reduce((sum, asset) => sum + asset.bytes, 0);
    if (paths.length > limits.projectFiles || size > limits.projectBytes)
      context.addIssue({ code: "custom", message: "Project limit exceeded" });
  });
export const updateFileSchema = z
  .object({
    baseVersion: z.int().positive(),
    content: sourceFileSchema.shape.content,
  })
  .strict();
export const diagnosticSchema = z
  .object({
    severity: z.enum(["error", "warning", "info"]),
    message: z.string().max(4000),
    path: projectPathSchema.optional(),
    line: z.int().positive().optional(),
  })
  .strict();
export const compileRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("compile"),
      requestId: z.uuid(),
      snapshot: sourceSnapshotSchema,
    })
    .strict(),
  z.object({ type: z.literal("cancel"), requestId: z.uuid() }).strict(),
]);
export const compileEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("state"),
      requestId: z.uuid(),
      state: z.enum([
        "loading",
        "queued",
        "running",
        "failed",
        "timed-out",
        "cancelled",
      ]),
      diagnostics: z.array(diagnosticSchema).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("succeeded"),
      requestId: z.uuid(),
      snapshotId: z.uuid(),
      revision: z.int().positive(),
      compilerBuildId: z.string().min(1),
      pdf: z
        .instanceof(Uint8Array)
        .refine((bytes) => bytes.length <= limits.pdfBytes),
      pdfSha256: hashSchema,
      diagnostics: z.array(diagnosticSchema).max(100),
    })
    .strict(),
]);
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type CompileRequest = z.infer<typeof compileRequestSchema>;
export type CompileEvent = z.infer<typeof compileEventSchema>;
