import {
  assetDeleteSchema,
  assetReplaceSchema,
  assetWriteSchema,
  compileInputSchema,
  createProjectSchema,
  createSnapshotSchema,
  createTextFileSchema,
  deleteEntrySchema,
  mainFileSchema,
  projectListSchema,
  projectSchema,
  renameEntrySchema,
  renameProjectSchema,
  resourceIdSchema,
  restoreSnapshotSchema,
  snapshotListSchema,
  sourceAssetSchema,
  sourceFileSchema,
  sourceSnapshotSchema,
  updateFileSchema,
} from "@overleaf-pro/contracts";
import {
  type Database,
  ProjectError,
  projectRepository,
} from "@overleaf-pro/db";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Auth } from "./auth.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  database: Database | undefined,
  auth: Auth | undefined,
) {
  app.route({
    method: ["GET", "POST", "PUT", "DELETE"],
    url: "/api/projects",
    handler: handle,
  });
  app.route({
    method: ["GET", "POST", "PUT", "DELETE"],
    url: "/api/projects/*",
    bodyLimit: 3 * 1024 * 1024,
    handler: handle,
  });
  const repository = database ? projectRepository(database.pool) : undefined;
  async function handle(request: FastifyRequest, reply: FastifyReply) {
    const fail = (status: number, code: string, message: string) =>
      reply
        .code(status)
        .send({ error: { code, message, requestId: request.id } });
    if (!repository || !auth)
      return fail(503, "UNAVAILABLE", "Project storage is unavailable");
    const { response: session, headers } = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    if (headers.getSetCookie().length)
      reply.header("set-cookie", headers.getSetCookie());
    if (!session) return fail(401, "UNAUTHORIZED", "Sign in required");
    if (!session.user.emailVerified)
      return fail(
        403,
        "FORBIDDEN",
        "Verify your email before opening private projects.",
      );
    const segments =
      request.url.split("?")[0]?.split("/").filter(Boolean) ?? [];
    try {
      if (segments.length === 2) {
        if (request.method === "GET")
          return projectListSchema.parse(
            await repository.list(session.user.id),
          );
        if (request.method === "POST") {
          const body = createProjectSchema.safeParse(request.body);
          if (!body.success)
            return fail(
              400,
              "INVALID_REQUEST",
              "Enter a project name of 1–100 characters",
            );
          const id = await repository.create(
            session.user.id,
            body.data.name,
            body.data.templateId,
          );
          return reply
            .code(201)
            .send(
              projectSchema.parse(await repository.get(session.user.id, id)),
            );
        }
      }
      const id = resourceIdSchema.safeParse(segments[2]);
      if (!id.success)
        return fail(400, "INVALID_REQUEST", "Invalid project ID");
      if (segments.length === 3 && request.method === "PUT") {
        const body = renameProjectSchema.safeParse(request.body);
        if (!body.success)
          return fail(
            400,
            "INVALID_REQUEST",
            "Enter a valid name and expected revision.",
          );
        return projectSchema.parse(
          await repository.rename(
            session.user.id,
            id.data,
            body.data.baseRevision,
            body.data.name,
          ),
        );
      }
      if (segments.length === 3 && request.method === "DELETE") {
        const body = restoreSnapshotSchema.safeParse(request.body);
        if (!body.success)
          return fail(
            400,
            "INVALID_REQUEST",
            "Expected project revision required.",
          );
        await repository.delete(
          session.user.id,
          id.data,
          body.data.baseRevision,
        );
        return reply.code(204).send();
      }
      if (
        (segments[3] === "files" || segments[3] === "assets") &&
        ((segments.length === 6 &&
          segments[5] === "rename" &&
          request.method === "POST") ||
          (segments.length === 5 &&
            segments[3] === "files" &&
            request.method === "DELETE"))
      ) {
        const entryId = resourceIdSchema.safeParse(segments[4]);
        const body = (
          request.method === "DELETE" ? deleteEntrySchema : renameEntrySchema
        ).safeParse(request.body);
        if (!entryId.success || !body.success)
          return fail(
            400,
            "INVALID_REQUEST",
            "Expected revision, version and valid path for rename.",
          );
        return projectSchema.parse(
          await repository.mutateEntry(
            session.user.id,
            id.data,
            entryId.data,
            body.data.baseRevision,
            body.data.baseVersion,
            segments[3],
            "path" in body.data && typeof body.data.path === "string"
              ? body.data.path
              : undefined,
          ),
        );
      }
      if (
        segments.length === 4 &&
        segments[3] === "compile-input" &&
        request.method === "POST"
      ) {
        const body = restoreSnapshotSchema.safeParse(request.body);
        if (!body.success)
          return fail(
            400,
            "INVALID_REQUEST",
            "Expected project revision required",
          );
        return compileInputSchema.parse(
          await repository.compileInput(
            session.user.id,
            id.data,
            body.data.baseRevision,
          ),
        );
      }
      if (
        segments.length === 4 &&
        segments[3] === "main-file" &&
        request.method === "POST"
      ) {
        const body = mainFileSchema.safeParse(request.body);
        if (!body.success)
          return fail(
            400,
            "INVALID_REQUEST",
            "Choose an existing .tex file and expected revision",
          );
        await repository.setMainFile(
          session.user.id,
          id.data,
          body.data.baseRevision,
          body.data.path,
        );
        return projectSchema.parse(
          await repository.get(session.user.id, id.data),
        );
      }
      if (
        segments.length === 4 &&
        segments[3] === "assets" &&
        request.method === "POST"
      ) {
        const body = assetWriteSchema.safeParse(request.body);
        if (!body.success)
          return fail(400, "INVALID_REQUEST", "Invalid bounded asset upload");
        return reply
          .code(201)
          .send(
            sourceAssetSchema.parse(
              await repository.writeAsset(
                session.user.id,
                id.data,
                body.data.baseRevision,
                body.data.path,
                body.data.dataBase64,
              ),
            ),
          );
      }
      if (segments.length === 5 && segments[3] === "assets") {
        const assetId = resourceIdSchema.safeParse(segments[4]);
        if (!assetId.success)
          return fail(400, "INVALID_REQUEST", "Invalid asset ID");
        if (request.method === "PUT") {
          const body = assetReplaceSchema.safeParse(request.body);
          if (!body.success)
            return fail(400, "INVALID_REQUEST", "Invalid bounded asset update");
          return sourceAssetSchema.parse(
            await repository.writeAsset(
              session.user.id,
              id.data,
              body.data.baseRevision,
              undefined,
              body.data.dataBase64,
              assetId.data,
              body.data.baseVersion,
            ),
          );
        }
        if (request.method === "DELETE") {
          const body = assetDeleteSchema.safeParse(request.body);
          if (!body.success)
            return fail(
              400,
              "INVALID_REQUEST",
              "Expected revision and asset version required",
            );
          await repository.deleteAsset(
            session.user.id,
            id.data,
            assetId.data,
            body.data.baseRevision,
            body.data.baseVersion,
          );
          return reply.code(204).send();
        }
      }
      if (segments.length === 3 && request.method === "GET")
        return projectSchema.parse(
          await repository.get(session.user.id, id.data),
        );
      if (
        segments.length === 4 &&
        segments[3] === "snapshots" &&
        request.method === "GET"
      )
        return snapshotListSchema.parse(
          await repository.listSnapshots(session.user.id, id.data),
        );
      if (
        segments.length === 6 &&
        segments[3] === "snapshots" &&
        segments[5] === "restore" &&
        request.method === "POST"
      ) {
        const snapshotId = resourceIdSchema.safeParse(segments[4]);
        const body = restoreSnapshotSchema.safeParse(request.body);
        if (!snapshotId.success || !body.success)
          return fail(400, "INVALID_REQUEST", "Invalid restore request");
        return projectSchema.parse(
          await repository.restoreSnapshot(
            session.user.id,
            id.data,
            snapshotId.data,
            body.data.baseRevision,
          ),
        );
      }
      if (
        segments.length === 4 &&
        segments[3] === "snapshots" &&
        request.method === "POST"
      ) {
        const body = createSnapshotSchema.safeParse(request.body);
        if (!body.success)
          return fail(
            400,
            "INVALID_REQUEST",
            "A base project revision is required",
          );
        return reply
          .code(201)
          .send(
            sourceSnapshotSchema.parse(
              await repository.createSnapshot(
                session.user.id,
                id.data,
                body.data.baseRevision,
                body.data.name,
              ),
            ),
          );
      }
      if (
        segments.length === 5 &&
        segments[3] === "snapshots" &&
        request.method === "GET"
      ) {
        const snapshotId = resourceIdSchema.safeParse(segments[4]);
        if (!snapshotId.success)
          return fail(400, "INVALID_REQUEST", "Invalid snapshot ID");
        return sourceSnapshotSchema.parse(
          await repository.getSnapshot(
            session.user.id,
            id.data,
            snapshotId.data,
          ),
        );
      }
      if (
        segments.length === 4 &&
        segments[3] === "files" &&
        request.method === "POST"
      ) {
        const body = createTextFileSchema.safeParse(request.body);
        if (!body.success)
          return fail(
            400,
            "INVALID_REQUEST",
            "Use a relative file path and at most 256 KiB of text",
          );
        await repository.addFile(
          session.user.id,
          id.data,
          body.data.path,
          body.data.content,
          body.data.baseRevision,
        );
        return reply
          .code(201)
          .send(
            projectSchema.parse(await repository.get(session.user.id, id.data)),
          );
      }
      if (
        segments.length === 5 &&
        segments[3] === "files" &&
        request.method === "PUT"
      ) {
        const body = updateFileSchema.safeParse(request.body);
        const fileId = resourceIdSchema.safeParse(segments[4]);
        if (!body.success || !fileId.success)
          return fail(400, "INVALID_REQUEST", "Invalid file update");
        return sourceFileSchema.parse(
          await repository.save(
            session.user.id,
            id.data,
            fileId.data,
            body.data.baseVersion,
            body.data.content,
          ),
        );
      }
      return fail(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ProjectError)
        return fail(
          error.status,
          error.status === 409
            ? "CONFLICT"
            : error.status === 404
              ? "NOT_FOUND"
              : "INVALID_REQUEST",
          error.message,
        );
      throw error;
    }
  }
}
