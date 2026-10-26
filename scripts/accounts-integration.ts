import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createDatabase } from "@overleaf-pro/db";
import { buildApp, safeRequestPath } from "../apps/api/src/app.js";
import { readConfig } from "../apps/api/src/config.js";
import { clearTestMail, inboxLink } from "./test-account.js";
import { requireTestDatabase } from "./test-database.js";

const database = createDatabase(requireTestDatabase());
const origin = "http://localhost:5173";
const email = `recovery-${randomUUID()}@example.test`;
const password = "synthetic-original-password-42";
const config = readConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  TRUSTED_ORIGINS: origin,
  AUTH_SECRET: randomUUID(),
  AUTH_ALLOW_SIGNUP: "true",
  MAIL_ENABLED: "true",
});
const app = buildApp(config, { database });
const post = (url: string, payload: Record<string, unknown>, cookie?: string) =>
  app.inject({
    method: "POST",
    url,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    payload,
  });
const cookies = (response: Awaited<ReturnType<typeof post>>) =>
  response.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
const local = (link: string) => {
  const url = new URL(link);
  return url.pathname + url.search;
};
let userId: string | undefined;
const failureTrigger = `test_reset_${randomUUID().replaceAll("-", "")}`;
try {
  await database.migrate();
  assert.equal(
    (
      await post("/api/auth/sign-up/email", {
        name: "Recovery Test",
        email,
        password,
      })
    ).statusCode,
    200,
  );
  assert.equal((await app.inject("/api/session")).statusCode, 401);
  assert.equal(
    (await post("/api/auth/sign-in/email", { email, password })).statusCode,
    403,
  );
  const knownResend = await post("/api/auth/send-verification-email", {
    email,
  });
  const unknownResend = await post("/api/auth/send-verification-email", {
    email: `absent-${randomUUID()}@example.test`,
  });
  assert.equal(knownResend.statusCode, 200);
  assert.equal(unknownResend.statusCode, 200);
  assert.deepEqual(knownResend.json(), unknownResend.json());
  const verification = await inboxLink(email, "Verify your email");
  assert.equal((await app.inject(local(verification))).statusCode, 302);
  assert.equal(
    (await app.inject(local(verification))).statusCode,
    302,
    "Verification replay is harmless",
  );
  assert.equal(
    (await app.inject("/api/session")).statusCode,
    401,
    "Verification must not silently sign in",
  );
  const login = await post("/api/auth/sign-in/email", { email, password });
  assert.equal(login.statusCode, 200);
  const cookie = cookies(login);
  const second = await post("/api/auth/sign-in/email", { email, password });
  userId = (
    await app.inject({ url: "/api/session", headers: { cookie } })
  ).json().user.id as string;
  await database.pool.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [userId],
  );
  assert.equal(
    (await app.inject({ url: "/api/session", headers: { cookie } })).statusCode,
    401,
  );
  for (const url of [
    "/api/projects",
    "/api/ai-proposals",
    "/api/resume-analyses",
  ])
    assert.equal(
      (await app.inject({ url, headers: { cookie } })).statusCode,
      403,
      "Legacy unverified sessions cannot bypass verification",
    );
  assert.equal((await app.inject(local(verification))).statusCode, 302);
  const head = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) - 60 }),
  ).toString("base64url");
  const expired = `${head}.${payload}.${createHmac(
    "sha256",
    config.AUTH_SECRET ?? "",
  )
    .update(`${head}.${payload}`)
    .digest("base64url")}`;
  assert.equal(
    (await app.inject(`/api/auth/verify-email?token=${expired}`)).statusCode,
    401,
  );
  assert.equal(
    (await app.inject("/api/auth/verify-email?token=invalid")).statusCode,
    401,
  );
  assert.equal(
    (
      await post("/api/auth/request-password-reset", {
        email,
        redirectTo: "https://evil.example/reset",
      })
    ).statusCode,
    403,
  );
  const resetRequest = await post("/api/auth/request-password-reset", {
    email,
    redirectTo: `${origin}/reset-password`,
  });
  const absentReset = await post("/api/auth/request-password-reset", {
    email: `absent-${randomUUID()}@example.test`,
    redirectTo: `${origin}/reset-password`,
  });
  assert.equal(resetRequest.statusCode, 200);
  assert.deepEqual(resetRequest.json(), absentReset.json());
  const resetLink = await inboxLink(email, "Reset your password");
  assert.ok(
    !safeRequestPath(local(resetLink)).includes(
      resetLink.split("/reset-password/")[1]?.split("?")[0] ?? "missing",
    ),
  );
  const callback = await app.inject(local(resetLink));
  assert.equal(callback.statusCode, 302);
  const token = new URL(String(callback.headers.location)).searchParams.get(
    "token",
  );
  assert.ok(token);
  assert.equal(
    (await post("/api/auth/reset-password", { token, newPassword: "short" }))
      .statusCode,
    400,
  );
  // Force failure after token consumption/session deletion to prove transactional rollback.
  assert.ok(userId);
  const quotedUser = userId.replaceAll("'", "''");
  await database.pool.query(
    `CREATE FUNCTION "${failureTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${quotedUser}' AND NEW.password IS DISTINCT FROM OLD.password THEN RAISE EXCEPTION 'synthetic password write failure'; END IF; RETURN NEW; END $$`,
  );
  await database.pool.query(
    `CREATE TRIGGER "${failureTrigger}" BEFORE UPDATE ON account FOR EACH ROW EXECUTE FUNCTION "${failureTrigger}"()`,
  );
  const errorLogs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errorLogs.push(args);
  };
  try {
    const failedReset = await post("/api/auth/reset-password", {
      token,
      newPassword: "synthetic-rollback-password-42",
    });
    assert.equal(failedReset.statusCode, 500);
    assert.equal(failedReset.json().error.message, "Request failed");
  } finally {
    console.error = originalError;
  }
  assert.equal(
    errorLogs.length,
    0,
    "Database/auth failures must never print raw errors or password hashes",
  );
  assert.equal(
    (await app.inject({ url: "/api/session", headers: { cookie } })).statusCode,
    200,
    "Failed password writes must restore revoked sessions",
  );
  assert.equal(
    (
      await database.pool.query(
        "SELECT count(*)::int AS count FROM verification WHERE identifier=$1",
        [`reset-password:${token}`],
      )
    ).rows[0]?.count,
    1,
    "Failed resets must preserve the token",
  );
  await database.pool.query(`DROP TRIGGER "${failureTrigger}" ON account`);
  await database.pool.query(`DROP FUNCTION "${failureTrigger}"()`);
  const resets = await Promise.all(
    [0, 1].map(() =>
      post("/api/auth/reset-password", {
        token,
        newPassword: "synthetic-replacement-password-42",
      }),
    ),
  );
  assert.deepEqual(
    resets.map((result) => result.statusCode).sort(),
    [200, 400],
    "Only one concurrent token redemption may succeed",
  );
  for (const old of [cookie, cookies(second)])
    assert.equal(
      (await app.inject({ url: "/api/session", headers: { cookie: old } }))
        .statusCode,
      401,
    );
  assert.equal(
    (
      await post("/api/auth/reset-password", {
        token,
        newPassword: "another-synthetic-password-42",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await post("/api/auth/sign-in/email", { email, password })).statusCode,
    401,
  );
  assert.equal(
    (
      await post("/api/auth/sign-in/email", {
        email,
        password: "synthetic-replacement-password-42",
      })
    ).statusCode,
    200,
  );
  await post("/api/auth/request-password-reset", {
    email,
    redirectTo: `${origin}/reset-password`,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const newLink = await inboxLink(email, "Reset your password");
  const expiredToken = newLink.split("/reset-password/")[1]?.split("?")[0];
  assert.ok(expiredToken);
  await database.pool.query(
    "UPDATE verification SET expires_at=now()-interval '1 minute' WHERE identifier=$1",
    [`reset-password:${expiredToken}`],
  );
  assert.equal(
    (
      await post("/api/auth/reset-password", {
        token: expiredToken,
        newPassword: "another-synthetic-password-42",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, newPassword: password },
      })
    ).statusCode,
    403,
  );
  // A stopped local SMTP service must not reveal whether an account exists.
  const unavailable = buildApp({ ...config, MAIL_PORT: 1 }, { database });
  try {
    const replies = [];
    for (const address of [email, `absent-${randomUUID()}@example.test`])
      replies.push(
        await unavailable.inject({
          method: "POST",
          url: "/api/auth/request-password-reset",
          headers: { origin },
          payload: { email: address },
        }),
      );
    assert.equal(replies[0]?.statusCode, 200);
    assert.deepEqual(replies[0]?.json(), replies[1]?.json());
    const limited = [];
    for (let i = 0; i < 11; i++)
      limited.push(
        await unavailable.inject({
          method: "POST",
          url: "/api/auth/request-password-reset",
          headers: { origin },
          payload: { email: "absent@example.test" },
        }),
      );
    assert.ok(limited.some((reply) => reply.statusCode === 429));
  } finally {
    await unavailable.close();
  }
  // A valid reset record referencing a removed user cannot recreate their account.
  const leftoverToken = randomUUID();
  await database.pool.query(
    "INSERT INTO verification(id,identifier,value,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [randomUUID(), `reset-password:${leftoverToken}`, userId],
  );
  await database.pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  assert.equal(
    (
      await post("/api/auth/reset-password", {
        token: leftoverToken,
        newPassword: password,
      })
    ).statusCode,
    400,
  );
  for (const table of ["session", "account", "project", "resume_analysis"])
    assert.equal(
      (
        await database.pool.query(
          `SELECT count(*)::int AS count FROM "${table}" WHERE user_id=$1`,
          [userId],
        )
      ).rows[0]?.count,
      0,
    );
  console.log(
    "Account integration passed: actual local SMTP/verification/reset, verification boundary and replay, expiry/redirects, concurrent single-use reset, session revocation, rate limits, SMTP outage privacy and deleted-account recovery rejection.",
  );
} finally {
  await database.pool.query(
    `DROP TRIGGER IF EXISTS "${failureTrigger}" ON account`,
  );
  await database.pool.query(`DROP FUNCTION IF EXISTS "${failureTrigger}"()`);
  if (userId)
    await database.pool.query("DELETE FROM verification WHERE value=$1", [
      userId,
    ]);
  await database.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
  await app.close();
  await clearTestMail([email]);
  await database.close();
}
