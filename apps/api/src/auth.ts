import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type Database, schema } from "@overleaf-pro/db";
import { betterAuth } from "better-auth";
import type { Config } from "./config.js";

export function createAuth(database: Database, config: Config) {
  return betterAuth({
    database: drizzleAdapter(database.db, { provider: "pg", schema }),
    baseURL: config.APP_ORIGIN,
    basePath: "/api/auth",
    secret: config.AUTH_SECRET,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: config.AUTH_ALLOW_SIGNUP !== "true",
      minPasswordLength: 12,
    },
    advanced: {
      useSecureCookies: config.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: [] },
    },
    // The application logs status/request IDs; raw adapter errors can contain private data.
    logger: { disabled: true },
    // No proxy-supplied IP is trusted. Deployment must validate proxy handling before enabling it.
    rateLimit: { enabled: true, window: 60, max: 30, storage: "memory" },
  });
}
export type Auth = ReturnType<typeof createAuth>;
