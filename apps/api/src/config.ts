import { z } from "zod";

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    url.origin === value &&
    !value.includes("*")
  );
}, "Expected an HTTP(S) origin without a path, trailing slash, or credentials");
const databaseUrl = z
  .url()
  .refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    "Expected a PostgreSQL URL",
  );
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: origin.default("http://localhost:5173"),
  AUTH_SECRET: z.string().min(32).optional(),
  DATABASE_URL: databaseUrl.optional(),
  TRUSTED_ORIGINS: z.string().default("http://localhost:5173"),
  AUTH_ALLOW_SIGNUP: z.enum(["true", "false"]).default("false"),
  // Local capture only. A future hosted delivery adapter requires separate validation.
  MAIL_ENABLED: z.enum(["true", "false"]).default("false"),
  MAIL_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  GROQ_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z
    .literal("llama-3.3-70b-versatile")
    .default("llama-3.3-70b-versatile"),
  AI_SHARING_ENABLED: z.enum(["true", "false"]).default("false"),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = envSchema.parse({
    ...env,
    DATABASE_URL: env.DATABASE_URL || undefined,
    GROQ_API_KEY: env.GROQ_API_KEY || undefined,
  });
  const trustedOrigins = z
    .array(origin)
    .parse(config.TRUSTED_ORIGINS.split(",").map((value) => value.trim()));
  if (!trustedOrigins.includes(config.APP_ORIGIN))
    throw new Error("TRUSTED_ORIGINS must include APP_ORIGIN");
  if (config.DATABASE_URL && !config.AUTH_SECRET)
    throw new Error("AUTH_SECRET is required when DATABASE_URL is set");
  if (config.NODE_ENV === "production") {
    if (!config.DATABASE_URL || !config.AUTH_SECRET)
      throw new Error("Production requires DATABASE_URL and AUTH_SECRET");
    if (config.AUTH_SECRET.startsWith("replace-"))
      throw new Error("Replace the example AUTH_SECRET in production");
    if (trustedOrigins.some((value) => !value.startsWith("https://")))
      throw new Error("Production origins must use HTTPS");
    if (config.AUTH_ALLOW_SIGNUP === "true")
      throw new Error(
        "Public signup requires validated hosted email delivery; keep it disabled in production",
      );
    if (config.MAIL_ENABLED === "true")
      throw new Error(
        "Local mail capture is not a production delivery service",
      );
  }
  return { ...config, trustedOrigins };
}
export type Config = ReturnType<typeof readConfig>;
