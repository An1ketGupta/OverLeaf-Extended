import { randomUUID } from "node:crypto";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { inboxLink } from "../../scripts/test-account.js";
import { requireTestDatabase } from "../../scripts/test-database.js";

test("frontend reads the API through its proxy and auth has no phantom session", async ({
  page,
  request,
}, testInfo) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  expect(health.headers()["cache-control"]).toBe("private, no-store");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A foundation for/ }),
  ).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Evaluation pending")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("foundation-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: /Open authentication check/ }).click();
  await expect(page.getByRole("status")).toHaveText(
    /No active session|Authentication needs a running API/,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Workspace readiness", exact: false })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: /Workspace readiness/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("foundation-mobile.png"),
    fullPage: true,
  });
});

test("real account cookies survive refresh and are invalidated on signout through the frontend proxy", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.TEST_DATABASE_URL,
    "Set a separate TEST_DATABASE_URL to run real browser authentication.",
  );
  const database = createDatabase(requireTestDatabase());
  const email = `browser-${randomUUID()}@example.test`;
  try {
    await page.goto("/auth-check");
    await expect(page.getByRole("status")).toHaveText("No active session.");
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Synthetic Browser Test");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-browser-password-42");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("verification link");
    await page.goto(await inboxLink(email, "Verify your email"));
    await page.goto("/account");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-browser-password-42");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("status")).toHaveText("Session restored.");
    const cookies = await page.context().cookies();
    expect(
      cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
    ).toBeTruthy();
    expect((await request.get("/api/session")).status()).toBe(401);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Signed out.");
    await page.reload();
    await expect(page.getByRole("status")).toHaveText("No active session.");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-browser-password-42");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  } finally {
    await database.pool.query('DELETE FROM "user" WHERE email = $1', [email]);
    await database.close();
  }
});
