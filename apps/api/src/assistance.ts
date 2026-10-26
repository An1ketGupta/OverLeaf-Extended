import {
  aiRequestSchema,
  resourceIdSchema,
  resumeInputSchema,
} from "@overleaf-pro/contracts";
import {
  analysisRepository,
  type Database,
  ProjectError,
  projectRepository,
} from "@overleaf-pro/db";
import { analyzeResume } from "@overleaf-pro/resume";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type AssistantProvider,
  validateAssistantOutput,
} from "./assistant-provider.js";
import type { Auth } from "./auth.js";
import type { Config } from "./config.js";

export function registerAssistanceRoutes(
  app: FastifyInstance,
  database: Database | undefined,
  auth: Auth | undefined,
  config: Config,
  provider?: AssistantProvider,
) {
  const projects = database ? projectRepository(database.pool) : undefined;
  const analyses = database ? analysisRepository(database.pool) : undefined;
  let running = 0;
  const activeUsers = new Set<string>();
  const starts = new Map<string, { count: number; until: number }>();
  for (const url of [
    "/api/ai-proposals",
    "/api/ai-proposals/*",
    "/api/resume-analyses",
    "/api/resume-analyses/*",
  ])
    app.route({
      method: ["GET", "POST", "DELETE"],
      url,
      bodyLimit: 2 * 1024 * 1024,
      handler,
    });
  async function handler(request: FastifyRequest, reply: FastifyReply) {
    const fail = (status: number, code: string, message: string) =>
      reply
        .code(status)
        .send({ error: { code, message, requestId: request.id } });
    if (!projects || !analyses || !auth)
      return fail(503, "UNAVAILABLE", "Private storage is unavailable");
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
        "Verify your email before opening private data.",
      );
    const userId = session.user.id;
    const parts = request.url.split("?")[0]?.split("/").filter(Boolean) ?? [];
    const ai = parts[1] === "ai-proposals";
    try {
      if (parts.length === 2) {
        if (request.method === "GET")
          return ai
            ? await projects.listProposals(userId)
            : await analyses.list(userId);
        if (request.method === "POST" && !ai) {
          const input = resumeInputSchema.safeParse(request.body);
          if (!input.success)
            return fail(
              400,
              "INVALID_REQUEST",
              "Invalid or oversized PDF extraction/requirements",
            );
          return reply
            .code(201)
            .send(
              await analyses.save(
                userId,
                input.data,
                analyzeResume(input.data),
              ),
            );
        }
        if (request.method === "POST" && ai) {
          const input = aiRequestSchema.safeParse(request.body);
          if (!input.success)
            return fail(
              400,
              "INVALID_REQUEST",
              "Invalid assistance request or sharing consent missing",
            );
          if (!provider)
            return fail(
              503,
              "UNAVAILABLE",
              "AI is not configured. Editing and PDF analysis remain available.",
            );
          if (running >= 2 || activeUsers.has(userId))
            return fail(
              503,
              "UNAVAILABLE",
              "Assistance is busy. Wait before retrying.",
            );
          for (const [id, window] of starts)
            if (window.until <= Date.now()) starts.delete(id);
          const window = starts.get(userId);
          if ((window?.count ?? 0) >= 12 || (!window && starts.size >= 1000))
            return fail(
              503,
              "UNAVAILABLE",
              "Assistance request limit reached. Wait one minute before retrying.",
            );
          starts.set(userId, {
            count: (window?.count ?? 0) + 1,
            until: window?.until ?? Date.now() + 60000,
          });
          running++;
          activeUsers.add(userId);
          try {
            const started = await projects.beginProposal(
              userId,
              input.data,
              config.AI_MODEL,
            );
            if (!started.fresh)
              return await projects.proposal(userId, started.proposal.id);
            try {
              const output = await provider(input.data, started.context);
              const validated = validateAssistantOutput(
                input.data,
                started.context,
                output.result,
              );
              await projects.finishProposal(
                userId,
                started.proposal.id,
                validated,
                output.usage,
                null,
              );
            } catch {
              await projects.finishProposal(
                userId,
                started.proposal.id,
                null,
                null,
                "Provider unavailable, incomplete, refused by validation, or timed out. No edits applied.",
              );
            }
            return reply
              .code(201)
              .send(await projects.proposal(userId, started.proposal.id));
          } finally {
            running--;
            activeUsers.delete(userId);
          }
        }
      }
      const id = resourceIdSchema.safeParse(parts[2]);
      if (!id.success)
        return fail(400, "INVALID_REQUEST", "Invalid resource ID");
      if (parts.length === 3 && request.method === "GET")
        return ai
          ? await projects.proposal(userId, id.data)
          : await analyses.get(userId, id.data);
      if (parts.length === 3 && request.method === "DELETE") {
        if (ai) await projects.deleteProposal(userId, id.data);
        else await analyses.delete(userId, id.data);
        return reply.code(204).send();
      }
      if (
        ai &&
        parts.length === 4 &&
        request.method === "POST" &&
        (parts[3] === "apply" || parts[3] === "reject")
      ) {
        if (
          request.body !== undefined &&
          (typeof request.body !== "object" ||
            request.body === null ||
            Object.keys(request.body).length)
        )
          return fail(400, "INVALID_REQUEST", "Action takes no fields");
        if (parts[3] === "apply")
          return await projects.applyProposal(userId, id.data);
        await projects.rejectProposal(userId, id.data);
        return await projects.proposal(userId, id.data);
      }
      return fail(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ProjectError)
        return fail(
          error.status,
          error.status === 404
            ? "NOT_FOUND"
            : error.status === 409
              ? "CONFLICT"
              : "INVALID_REQUEST",
          error.message,
        );
      throw error;
    }
  }
}
