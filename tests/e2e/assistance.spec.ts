import { createHash, randomUUID } from "node:crypto";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { fixturePdf } from "../fixtures/resume.js";
import { verifyBrowserAccount } from "./account-helper.js";

const origin = "http://127.0.0.1:5273";
const emails: string[] = [];
test.afterAll(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  const db = createDatabase(requireTestDatabase());
  try {
    await db.pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [
      emails,
    ]);
  } finally {
    await db.close();
  }
});
test("actual PDF bytes, worker evidence, job matching, unknown extraction, malformed input and mobile layout", async ({
  page,
}, testInfo) => {
  const bytes = fixturePdf();
  await page.goto("/resume");
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "synthetic-resume.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await expect(
    page.getByRole("heading", { name: "Our compatibility estimate: 100/100" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(
      `Exact PDF SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`,
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Required terms or phrases", { exact: true })
    .fill("Java\nPostgreSQL");
  await page
    .getByLabel("Preferred terms or phrases", { exact: true })
    .fill("TypeScript");
  await page
    .getByRole("button", { name: "Update analysis and job coverage" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Required: 1/2 terms with evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preferred: 1/1 terms with evidence" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("resume-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("resume-mobile.png"),
    fullPage: true,
  });
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "empty.pdf",
    mimeType: "application/pdf",
    buffer: fixturePdf([[]]),
  });
  await expect(
    page.getByRole("heading", { name: "Compatibility: unknown" }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nmalformed"),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "PDF extraction failed" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("heading", { name: "Compatibility: unknown" }),
  ).toHaveCount(0);
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "encrypted.pdf",
    mimeType: "application/pdf",
    buffer: fixturePdf(undefined, true),
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Password-protected PDFs are unsupported." }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "pages.pdf",
    mimeType: "application/pdf",
    buffer: fixturePdf(Array.from({ length: 21 }, () => [])),
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "PDF analysis supports at most 20 pages" }),
  ).toBeVisible({ timeout: 20000 });
});
test("AI request, diff, atomic apply, refresh, safe restore, provider failure and saved PDF report", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    !process.env.TEST_DATABASE_URL,
    "Requires separate PostgreSQL database.",
  );
  const email = `assistance-ui-${randomUUID()}@example.test`;
  emails.push(email);
  const signup = await context.request.post("/api/auth/sign-up/email", {
    headers: { origin },
    data: {
      name: "Synthetic Writer",
      email,
      password: "synthetic-assistant-ui-password-42",
    },
  });
  expect(signup.status()).toBe(200);
  await verifyBrowserAccount(
    context.request,
    email,
    "synthetic-assistant-ui-password-42",
    origin,
  );
  const projectResponse = await context.request.post("/api/projects", {
    headers: { origin },
    data: { name: "Assisted source" },
  });
  const project = await projectResponse.json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Writing assistant" });
  await dialog.getByLabel("Task", { exact: true }).selectOption("rewrite");
  await dialog
    .getByLabel("Instruction", { exact: true })
    .fill("Add a synthetic comment");
  await dialog
    .getByLabel("Share this context with the configured provider", {
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Request assistance", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "ready · openai/gpt-oss-20b" }),
  ).toBeVisible();
  await expect(dialog.locator(".source-diff")).toContainText(
    "+ % Reviewed synthetic change",
  );
  await page.screenshot({
    path: testInfo.outputPath("assistant-review.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Apply all proposed edits", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Source editor: main.tex", exact: true }),
  ).toContainText("% Reviewed synthetic change");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Check request", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Restore before these edits", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Source editor: main.tex", exact: true }),
  ).not.toContainText("% Reviewed synthetic change");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await dialog
    .getByLabel("Instruction", { exact: true })
    .fill("simulate unavailable");
  await dialog
    .getByLabel("Share this context with the configured provider", {
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Request assistance", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "failed · openai/gpt-oss-20b" }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Provider unavailable, incomplete, refused by validation, or timed out. No edits applied.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close assistant", exact: true })
    .click();
  await page.goto("/resume");
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: fixturePdf(),
  });
  await expect(
    page.getByRole("heading", { name: "Our compatibility estimate: 100/100" }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", { name: "Save private report", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Private report saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open report", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved report loaded" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete report", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open report", exact: true }),
  ).toHaveCount(0);
});
