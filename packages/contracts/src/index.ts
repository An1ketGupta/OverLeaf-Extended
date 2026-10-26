import { z } from "zod";

export * from "./assistance.js";

export const limits = {
  textFileBytes: 256 * 1024,
  assetBytes: 2 * 1024 * 1024,
  projectBytes: 8 * 1024 * 1024,
  projectFiles: 50,
  compileTimeoutMs: 15_000,
  pdfBytes: 5 * 1024 * 1024,
  snapshotsPerProject: 20,
  accountSnapshotBytes: 32 * 1024 * 1024,
  accountAssetBytes: 32 * 1024 * 1024,
  compileInputBytes: 16 * 1024 * 1024,
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
export const assetBase64Schema = z
  .string()
  .min(4)
  .max(4 * Math.ceil(limits.assetBytes / 3))
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine((value) => {
    try {
      return (
        btoa(atob(value)) === value && atob(value).length <= limits.assetBytes
      );
    } catch {
      return false;
    }
  }, "Invalid bounded base64");
export const sourceAssetSchema = z
  .object({
    id: z.uuid(),
    path: projectPathSchema,
    version: z.int().positive(),
    sha256: hashSchema,
    bytes: z.int().positive().max(limits.assetBytes),
    mediaType: z.enum(["image/png", "image/jpeg", "application/pdf"]),
    dataBase64: assetBase64Schema,
  })
  .strict()
  .refine(
    (asset) => atob(asset.dataBase64).length === asset.bytes,
    "Asset byte length mismatch",
  );
export type SourceAsset = z.infer<typeof sourceAssetSchema>;
export const assetWriteSchema = z
  .object({
    baseRevision: z.int().positive(),
    path: projectPathSchema,
    dataBase64: assetBase64Schema,
  })
  .strict();
export const assetReplaceSchema = z
  .object({
    baseRevision: z.int().positive(),
    baseVersion: z.int().positive(),
    dataBase64: assetBase64Schema,
  })
  .strict();
export const assetDeleteSchema = z
  .object({ baseRevision: z.int().positive(), baseVersion: z.int().positive() })
  .strict();
export const mainFileSchema = z
  .object({
    baseRevision: z.int().positive(),
    path: projectPathSchema.refine((path) => path.endsWith(".tex")),
  })
  .strict();
export const sourceFileSchema = z
  .object({
    id: z.uuid(),
    path: projectPathSchema,
    version: z.int().positive(),
    content: z
      .string()
      .refine(
        (value) =>
          !value.includes("\0") &&
          new TextDecoder("utf-8", { ignoreBOM: true }).decode(
            new TextEncoder().encode(value),
          ) === value,
        "Text must be valid Unicode without null bytes",
      )
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
    assets: z.array(sourceAssetSchema).max(limits.projectFiles),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const paths = [...snapshot.files, ...snapshot.assets].map(
      (file) => file.path,
    );
    if (new Set(paths).size !== paths.length)
      context.addIssue({ code: "custom", message: "Duplicate snapshot paths" });
    if (
      paths.some((path) =>
        paths.some((parent) => path.startsWith(`${parent}/`)),
      )
    )
      context.addIssue({
        code: "custom",
        message: "A snapshot file cannot also be a directory",
      });
    if (
      new Set(snapshot.files.map((file) => file.id)).size !==
      snapshot.files.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate snapshot file IDs",
      });
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
export const createSnapshotSchema = z
  .object({
    baseRevision: z.int().positive(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(
        (value) =>
          [...value].every(
            (char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
          ),
        "Snapshot names cannot contain control characters",
      )
      .optional(),
  })
  .strict();
export const restoreSnapshotSchema = z
  .object({ baseRevision: z.int().positive() })
  .strict();
export const compileInputSchema = z
  .object({
    kind: z.literal("ephemeral"),
    captureId: z.uuid(),
    snapshot: sourceSnapshotSchema,
  })
  .strict()
  .refine(
    (input) =>
      input.captureId === input.snapshot.id &&
      new TextEncoder().encode(JSON.stringify(input)).length <=
        limits.compileInputBytes,
    "Capture identifier mismatch",
  );
export type CompileInput = z.infer<typeof compileInputSchema>;
const compilerShardSchema = z
  .object({
    path: z.string().regex(/^(engine|runtime)-\d+\.bin$/),
    bytes: z
      .int()
      .positive()
      .max(8 * 1024 * 1024),
    sha256: hashSchema,
  })
  .strict();
export const compilerManifestSchema = z
  .object({
    buildId: z.literal("busytex-tl2025-0ee2c65fb1ab"),
    engineSha256: hashSchema,
    engineCodeSha256: hashSchema,
    runtimeSha256: z.literal(
      "0ee2c65fb1ab226f6ec5c44b911ab1257d873f69e334548295913005bcfd87d5",
    ),
    indexSha256: hashSchema,
    runtimeBytes: z
      .int()
      .positive()
      .max(128 * 1024 * 1024),
    shards: z
      .object({
        engine: z.array(compilerShardSchema).min(1).max(8),
        runtime: z.array(compilerShardSchema).min(1).max(16),
      })
      .strict(),
  })
  .strict();
export const snapshotSummarySchema = z
  .object({
    id: z.uuid(),
    revision: z.int().positive(),
    createdAt: z.iso.datetime(),
    name: z.string().min(1).max(100).nullable(),
  })
  .strict();
export const snapshotListSchema = z
  .array(snapshotSummarySchema)
  .max(limits.snapshotsPerProject);
export const templateIdSchema = z.enum([
  "resume-classic",
  "resume-compact",
  "report",
]);
export type TemplateId = z.infer<typeof templateIdSchema>;
export const templateCatalog = [
  {
    id: "resume-classic",
    name: "Classic resume",
    description: "Single-column resume with clear section headings.",
    files: ["main.tex"],
  },
  {
    id: "resume-compact",
    name: "Compact resume",
    description: "Concise resume with projects and technical skills.",
    files: ["main.tex"],
  },
  {
    id: "report",
    name: "Research report",
    description: "A report with separate introduction and findings files.",
    files: ["main.tex", "sections/introduction.tex", "sections/findings.tex"],
  },
] as const;
// The current persistence layer stores text only. Asset bytes need a separate
// validated transport after the compiler gate; metadata alone cannot be exported.
export const textSnapshotSchema = sourceSnapshotSchema.refine(
  (snapshot) => snapshot.assets.length === 0,
  "Asset snapshots are not supported yet",
);
export const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      [...value].every(
        (char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
      ),
    "Project names cannot contain control characters",
  );
export const createProjectSchema = z
  .object({ name: projectNameSchema, templateId: templateIdSchema.optional() })
  .strict();
export const createTextFileSchema = z
  .object({
    baseRevision: z.int().positive(),
    path: projectPathSchema,
    content: sourceFileSchema.shape.content,
  })
  .strict();
export const renameProjectSchema = z
  .object({ baseRevision: z.int().positive(), name: projectNameSchema })
  .strict();
export const renameEntrySchema = z
  .object({
    baseRevision: z.int().positive(),
    baseVersion: z.int().positive(),
    path: projectPathSchema,
  })
  .strict();
export const deleteEntrySchema = assetDeleteSchema;
export const projectSchema = z
  .object({
    id: z.uuid(),
    name: projectNameSchema,
    mainFile: projectPathSchema,
    revision: z.int().positive(),
    updatedAt: z.iso.datetime(),
    files: z.array(sourceFileSchema).min(1).max(limits.projectFiles),
    assets: z.array(sourceAssetSchema).max(limits.projectFiles).optional(),
  })
  .strict()
  .superRefine((project, context) => {
    const allPaths = [...project.files, ...(project.assets ?? [])].map(
      (file) => file.path,
    );
    if (
      new Set(allPaths).size !== allPaths.length ||
      allPaths.length > limits.projectFiles ||
      allPaths.some((path) =>
        allPaths.some((parent) => path.startsWith(`${parent}/`)),
      ) ||
      new Set(project.files.map((file) => file.path)).size !==
        project.files.length ||
      new Set(project.files.map((file) => file.id)).size !==
        project.files.length ||
      !project.files.some((file) => file.path === project.mainFile) ||
      project.files.reduce(
        (sum, file) => sum + new TextEncoder().encode(file.content).length,
        0,
      ) +
        (project.assets ?? []).reduce((sum, asset) => sum + asset.bytes, 0) >
        limits.projectBytes
    )
      context.addIssue({ code: "custom", message: "Invalid project files" });
  });
export const projectSummarySchema = z
  .object({
    id: z.uuid(),
    name: projectNameSchema,
    revision: z.int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const projectListSchema = z.array(projectSummarySchema).max(100);
export const resourceIdSchema = z.uuid();
export const localDraftSchema = z
  .object({
    userId: z.string().min(1),
    projectId: z.uuid(),
    fileId: z.uuid(),
    baseVersion: z.int().positive(),
    content: sourceFileSchema.shape.content,
    savedAt: z.int().positive(),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export type SourceFile = z.infer<typeof sourceFileSchema>;
export type LocalDraft = z.infer<typeof localDraftSchema>;
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
      snapshotId: z.uuid().nullable(),
      captureId: z.uuid(),
      projectId: z.uuid(),
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
export const compilerRuntimeEventSchema = z
  .object({
    type: z.enum(["running", "succeeded", "failed"]),
    pass: z.int().positive().max(3).optional(),
    status: z.number().optional(),
    logs: z.string().max(210000).optional(),
    message: z.string().max(4000).optional(),
    pdf: z
      .instanceof(Uint8Array)
      .refine((b) => b.length > 0 && b.length <= limits.pdfBytes)
      .optional(),
    memoryBytes: z.number().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    blockedHostAPIs: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();
