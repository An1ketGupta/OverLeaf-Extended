import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { clearTestMail, inboxLink } from "../../scripts/test-account.js";
export async function verifyBrowserAccount(
  request: APIRequestContext,
  email: string,
  password: string,
  origin: string,
) {
  const link = await inboxLink(email, "Verify your email");
  expect((await request.get(link)).ok()).toBeTruthy();
  const signedIn = await request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: { email, password },
  });
  expect(signedIn.status()).toBe(200);
  await clearTestMail([email]);
}
