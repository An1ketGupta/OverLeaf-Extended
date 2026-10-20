function identity(value: string) {
  const url = new URL(value);
  // Recognize the common direct/pooler and loopback aliases, without comparing secrets.
  const host = url.hostname
    .replace(/-pooler(?=\.)/, "")
    .replace(/^(localhost|127\.0\.0\.1|\[::1\])$/, "loopback");
  return `${host}:${url.port || "5432"}${decodeURIComponent(url.pathname)}`;
}
export function requireTestDatabase(env: NodeJS.ProcessEnv = process.env) {
  const testUrl = env.TEST_DATABASE_URL;
  if (!testUrl)
    throw new Error(
      "TEST_DATABASE_URL is required. Use a separate test database/Neon branch; integration tests do not silently skip.",
    );
  for (const other of [env.DATABASE_URL, env.DATABASE_MIGRATION_URL]) {
    if (other && identity(other) === identity(testUrl))
      throw new Error("Test and development databases must be separate.");
  }
  return testUrl;
}
