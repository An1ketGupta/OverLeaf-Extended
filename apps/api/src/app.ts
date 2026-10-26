import {
  healthSchema,
  readinessSchema,
  sessionSchema,
} from "@overleaf-pro/contracts";
import { createDatabase, type Database } from "@overleaf-pro/db";
import { fromNodeHeaders } from "better-auth/node";
import Fastify from "fastify";
import { registerAssistanceRoutes } from "./assistance.js";
import {
  type AssistantProvider,
  createAssistantProvider,
} from "./assistant-provider.js";
import { createAuth } from "./auth.js";
import type { Config } from "./config.js";
import { registerProjectRoutes } from "./projects.js";

export const safeRequestPath = (url: string) =>
  (url.split("?")[0] ?? "/").replace(
    /(\/api\/auth\/reset-password\/)[^/]+/g,
    "$1[redacted]",
  );

export function buildApp(
  config: Config,
  options: {
    database?: Database;
    logger?: boolean;
    assistantProvider?: AssistantProvider;
  } = {},
) {
  const database =
    options.database ??
    (config.DATABASE_URL ? createDatabase(config.DATABASE_URL) : undefined);
  const auth = database ? createAuth(database, config) : undefined;
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "res.headers.set-cookie",
          ],
          serializers: {
            req: (request) => ({
              method: request.method,
              url: safeRequestPath(request.url),
            }),
          },
        }
      : false,
    bodyLimit: 300 * 1024,
    requestTimeout: 15_000,
    trustProxy: false,
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Request-Id", request.id);
    const requestOrigin = request.headers.origin;
    if (requestOrigin && !config.trustedOrigins.includes(requestOrigin)) {
      return reply.code(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Origin is not allowed",
          requestId: request.id,
        },
      });
    }
    // Browser clients use same-origin /api via Vite/Vercel; no permissive CORS needed.
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !requestOrigin
    ) {
      return reply.code(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Origin header is required",
          requestId: request.id,
        },
      });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined;
    const status =
      typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
        ? statusCode
        : 500;
    // Do not log database/provider errors or request bodies: they can contain secrets.
    request.log.error({ requestId: request.id, status }, "Request failed");
    return reply.code(status).send({
      error: {
        code: status < 500 ? "INVALID_REQUEST" : "INTERNAL",
        message: status < 500 ? "Invalid request" : "Request failed",
        requestId: request.id,
      },
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
      },
    }),
  );
  app.get("/api/health", async () =>
    healthSchema.parse({ status: "ok", service: "overleaf-pro-api" }),
  );
  app.get("/api/ready", async (_request, reply) => {
    let status: "ready" | "not-configured" | "unavailable" = database
      ? "ready"
      : "not-configured";
    try {
      await database?.readiness();
    } catch {
      status = "unavailable";
    }
    return reply.code(status === "ready" ? 200 : 503).send(
      readinessSchema.parse({
        status: status === "ready" ? "ready" : "unavailable",
        database: status,
      }),
    );
  });
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      if (!auth)
        return reply.code(503).send({
          error: {
            code: "UNAVAILABLE",
            message: "Authentication needs a configured database",
            requestId: request.id,
          },
        });
      if (
        request.url.split("?")[0] === "/api/auth/sign-up/email" &&
        config.MAIL_ENABLED !== "true"
      )
        return reply.code(503).send({
          error: {
            code: "UNAVAILABLE",
            message:
              "Start and enable the local email service before creating an account.",
            requestId: request.id,
          },
        });
      // Use configured public origin rather than trusting client Host/Forwarded headers.
      const response = await auth.handler(
        new Request(new URL(request.url, config.APP_ORIGIN), {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body !== undefined
            ? { body: JSON.stringify(request.body) }
            : {}),
        }),
      );
      reply.code(response.status);
      response.headers.forEach((value, name) => {
        if (!["set-cookie", "cache-control"].includes(name))
          reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(await response.text());
    },
  });
  app.get("/api/session", async (request, reply) => {
    if (!auth)
      return reply.code(503).send({
        error: {
          code: "UNAVAILABLE",
          message: "Authentication needs a configured database",
          requestId: request.id,
        },
      });
    const { response: result, headers } = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    const cookies = headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    if (!result?.user.emailVerified)
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Sign in required",
          requestId: request.id,
        },
      });
    return sessionSchema.parse({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
      },
      expiresAt: result.session.expiresAt.toISOString(),
    });
  });
  registerProjectRoutes(app, database, auth);
  registerAssistanceRoutes(
    app,
    database,
    auth,
    config,
    options.assistantProvider ??
      (config.AI_SHARING_ENABLED === "true" && config.GROQ_API_KEY
        ? createAssistantProvider({
            key: config.GROQ_API_KEY,
            model: config.AI_MODEL,
          })
        : undefined),
  );
  app.addHook("onClose", async () => {
    await auth?.drainMail();
    if (!options.database) await database?.close();
  });
  return app;
}
