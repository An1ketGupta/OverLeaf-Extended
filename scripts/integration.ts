import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@overleaf-pro/db";
import { buildApp } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { requireTestDatabase } from "./test-database.js";

const database = createDatabase(requireTestDatabase());
const email = `part0-${randomUUID()}@example.test`;
const origin = "http://localhost:5173";
const config = readConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  TRUSTED_ORIGINS: origin,
  AUTH_SECRET: randomUUID(),
  AUTH_ALLOW_SIGNUP: "true",
});
const app = buildApp(config, { database });
function cookieHeader(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
try {
  await database.migrate();
  await database.migrate(); // A second run must preserve existing data/schema.
  assert.equal((await app.inject("/api/ready")).statusCode, 200);
  assert.equal((await app.inject("/api/session")).statusCode, 401);
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin },
    payload: {
      name: "Synthetic Test",
      email,
      password: "synthetic-test-password-42",
    },
  });
  assert.equal(signup.statusCode, 200, `Signup returned ${signup.statusCode}`);
  const cookies = signup.headers["set-cookie"];
  const cookie = cookieHeader(cookies);
  assert.ok(cookie.length > 0, "Signup must set a session cookie");
  for (const value of Array.isArray(cookies) ? cookies : [cookies ?? ""]) {
    assert.match(value, /HttpOnly/i);
    assert.match(value, /SameSite=Lax/i);
    assert.doesNotMatch(value, /Domain=/i);
  }
  const restored = await app.inject({
    url: "/api/session",
    headers: { cookie },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().user.email, email);
  assert.equal(restored.headers["cache-control"], "private, no-store");
  await database.pool.query(
    'UPDATE "session" SET expires_at = now() + interval \'5 days\' WHERE user_id = (SELECT id FROM "user" WHERE email = $1)',
    [email],
  );
  const renewed = await app.inject({
    url: "/api/session",
    headers: { cookie },
  });
  assert.equal(renewed.statusCode, 200);
  assert.ok(
    renewed.headers["set-cookie"],
    "Session renewal cookies must reach the browser",
  );
  const forgedOrigin = await app.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    headers: { cookie, origin: "https://attacker.example" },
    payload: {},
  });
  assert.equal(forgedOrigin.statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: { cookie },
        payload: {},
      })
    ).statusCode,
    403,
  );
  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    headers: { cookie, origin },
    payload: {},
  });
  assert.equal(logout.statusCode, 200);
  assert.equal(
    (await app.inject({ url: "/api/session", headers: { cookie } })).statusCode,
    401,
  );
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin },
    payload: {
      email,
      password: "synthetic-test-password-42",
      rememberMe: false,
    },
  });
  assert.equal(login.statusCode, 200);
  assert.ok(
    Array.isArray(login.headers["set-cookie"]) &&
      login.headers["set-cookie"].length >= 2,
    "Auth bridge must preserve multiple Set-Cookie headers",
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/session",
        headers: { cookie: cookieHeader(login.headers["set-cookie"]) },
      })
    ).statusCode,
    200,
  );
  const httpsOrigin = "https://staging.example.test";
  const secureApp = buildApp(
    readConfig({
      NODE_ENV: "production",
      APP_ORIGIN: httpsOrigin,
      TRUSTED_ORIGINS: httpsOrigin,
      AUTH_SECRET: config.AUTH_SECRET,
      DATABASE_URL: requireTestDatabase(),
    }),
    { database },
  );
  try {
    const secureLogin = await secureApp.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: httpsOrigin },
      payload: { email, password: "synthetic-test-password-42" },
    });
    assert.equal(secureLogin.statusCode, 200);
    for (const value of [secureLogin.headers["set-cookie"]].flat()) {
      assert.ok(value);
      assert.match(value, /; Secure/i);
      assert.doesNotMatch(value, /Domain=/i);
    }
  } finally {
    await secureApp.close();
  }
  console.log(
    "PASS: real PostgreSQL migrations/idempotence, readiness, signup/signin, session restoration/renewal, multiple Set-Cookie forwarding, signout invalidation, origin protection, no-store, and production Secure host-only cookies.",
  );
  console.log(
    "Actual Vercel/Render forwarding and CDN behavior remain unverified.",
  );
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "Integration failed. Check test database access/schema and auth compatibility.",
  );
  process.exitCode = 1;
} finally {
  // Delete only this run's synthetic account. Never reset/drop a configured database.
  await database.pool
    .query('DELETE FROM "user" WHERE email = $1', [email])
    .catch(() => {});
  await app.close();
  await database.close();
}
