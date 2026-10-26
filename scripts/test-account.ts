import assert from "node:assert/strict";
import type { buildApp } from "../apps/api/src/app.js";

const inbox = "http://127.0.0.1:8025";
export async function inboxLink(email: string, subject: string) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email} subject:"${subject}"`)}`,
    );
    if (!response.ok)
      throw new Error("Start the local test inbox with pnpm mail:start");
    const data = (await response.json()) as { messages: { ID: string }[] };
    if (data.messages[0]) {
      const message = (await (
        await fetch(`${inbox}/api/v1/message/${data.messages[0].ID}`)
      ).json()) as { Text: string };
      const link = message.Text.match(/http[^\s]+/u)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Expected account email was not received by the local inbox");
}
export async function verifiedSignup(
  app: ReturnType<typeof buildApp>,
  origin: string,
  payload: { name: string; email: string; password: string },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin },
    payload,
  });
  assert.equal(response.statusCode, 200, "Synthetic signup must succeed");
  const link = new URL(await inboxLink(payload.email, "Verify your email"));
  const verified = await app.inject({ url: link.pathname + link.search });
  assert.ok(
    [200, 302].includes(verified.statusCode),
    "Verification must succeed",
  );
  const signedIn = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin },
    payload: { email: payload.email, password: payload.password },
  });
  assert.equal(signedIn.statusCode, 200, "Verified sign-in must succeed");
  await clearTestMail([payload.email]);
  return signedIn;
}
export async function clearTestMail(emails: string[]) {
  for (const email of emails) {
    const data = (await (
      await fetch(
        `${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      )
    ).json()) as { messages: { ID: string }[] };
    for (const message of data.messages)
      await fetch(`${inbox}/api/v1/messages`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ IDs: [message.ID] }),
      });
  }
}
