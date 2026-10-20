import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

// Never print validation input: URLs/secrets may be present in the environment.
async function main() {
  let config: ReturnType<typeof readConfig>;
  try {
    config = readConfig();
  } catch {
    throw new Error("Invalid environment configuration; check .env.example");
  }
  const app = buildApp(config, { logger: true });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close();
    });
  await app.listen({ port: config.PORT, host: config.HOST });
}
main().catch(() => {
  console.error(
    "API startup failed; check configuration and port availability.",
  );
  process.exitCode = 1;
});
