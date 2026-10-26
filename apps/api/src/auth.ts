import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type Database, schema } from "@overleaf-pro/db";
import { betterAuth } from "better-auth";
import type { Config } from "./config.js";
import { createMailer } from "./mail.js";

export function createAuth(database: Database, config: Config) {
  const mail = createMailer(config);
  const auth = betterAuth({
    database: drizzleAdapter(database.db, {
      provider: "pg",
      schema,
      transaction: true,
    }),
    baseURL: config.APP_ORIGIN,
    basePath: "/api/auth",
    secret: config.AUTH_SECRET,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: config.AUTH_ALLOW_SIGNUP !== "true",
      minPasswordLength: 12,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) =>
        mail.send(user.email, url, "reset"),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        mail.send(user.email, url, "verify"),
    },
    advanced: {
      useSecureCookies: config.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: [] },
    },
    // The application logs status/request IDs; raw adapter errors can contain private data.
    logger: { disabled: true },
    // better-call otherwise prints raw non-API errors despite the disabled auth logger.
    // Expected API errors retain native responses; unexpected errors reach Fastify's sanitized handler.
    onAPIError: { throw: true },
    // No proxy-supplied IP is trusted. Deployment must validate proxy handling before enabling it.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      storage: "memory",
      customRules: {
        "/sign-in/email": { window: 60, max: 30 },
        "/sign-up/email": { window: 60, max: 30 },
        "/request-password-reset": { window: 60, max: 10 },
        "/send-verification-email": { window: 60, max: 5 },
      },
    },
  });
  return Object.assign(auth, { drainMail: mail.drain });
}
export type Auth = ReturnType<typeof createAuth>;
