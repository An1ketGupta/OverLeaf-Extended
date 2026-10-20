import {
  createProjectSchema,
  createSnapshotSchema,
  createTextFileSchema,
  projectListSchema,
  projectSchema,
  resourceIdSchema,
  sourceFileSchema,
  textSnapshotSchema,
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
    method: ["GET", "POST", "PUT"],
    url: "/api/projects",
    handler: handle,
  });
  app.route({
    method: ["GET", "POST", "PUT"],
    url: "/api/projects/*",
    bodyLimit: 2 * 1024 * 1024,
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
          const id = await repository.create(session.user.id, body.data.name);
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
      if (segments.length === 3 && request.method === "GET")
        return projectSchema.parse(
          await repository.get(session.user.id, id.data),
        );
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
            textSnapshotSchema.parse(
              await repository.createSnapshot(
                session.user.id,
                id.data,
                body.data.baseRevision,
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
        return textSnapshotSchema.parse(
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
