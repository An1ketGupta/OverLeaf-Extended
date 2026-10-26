import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { verifyBrowserAccount } from "./account-helper.js";
import { compileAndInspect } from "./pdf-helper.js";

const email = `assistant-compiler-${randomUUID()}@example.test`;
test.afterAll(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  const db = createDatabase(requireTestDatabase());
  try {
    await db.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
  } finally {
    await db.close();
  }
});

test("assistant review/reject/apply compiles visible PDF changes, explains real failure, restores and protects later edits", async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  test.skip(
    !process.env.TEST_DATABASE_URL ||
      !existsSync("apps/web/public/compiler/manifest.json"),
    "Requires real PostgreSQL and prepared compiler assets",
  );
  const origin = "http://127.0.0.1:5273";
  const password = "synthetic-assistant-compiler-42";
  expect(
    (
      await context.request.post("/api/auth/sign-up/email", {
        headers: { origin },
        data: { name: "Assistant compiler", email, password },
      })
    ).status(),
  ).toBe(200);
  await verifyBrowserAccount(context.request, email, password, origin);
  const response = await context.request.post("/api/projects", {
    headers: { origin },
    data: { name: "Assistant compilation", templateId: "resume-classic" },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto(`/projects/${project.id}`);
  expect(
    (await compileAndInspect(page, info, "assistant-baseline")).text,
  ).toContain("Alex Example");
  const editor = page.getByRole("textbox", {
    name: "Source editor: main.tex",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Writing assistant" });
  const open = () =>
    page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const request = async (instruction: string, mode = "rewrite") => {
    await dialog.getByLabel("Task", { exact: true }).selectOption(mode);
    await dialog.getByLabel("Instruction", { exact: true }).fill(instruction);
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
  };
  await open();
  await request("synthetic visible edit");
  await expect(dialog.locator(".source-diff")).toContainText(
    "Reviewed visible change.",
  );
  await dialog
    .getByRole("button", { name: "Reject proposal", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "rejected · openai/gpt-oss-20b" }),
  ).toBeVisible();
  expect(
    (await (await context.request.get(`/api/projects/${project.id}`)).json())
      .revision,
  ).toBe(1);
  await request("synthetic visible edit");
  await dialog
    .getByRole("button", { name: "Apply all proposed edits", exact: true })
    .click();
  await expect(editor).toContainText("Reviewed visible change.");
  expect(
    (await compileAndInspect(page, info, "assistant-visible-edit")).text,
  ).toContain("Reviewed visible change.");
  // Return from extraction reloads the workspace. Compile again to retain output during failure.
  await page.getByRole("button", { name: "▷ Recompile", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Compilation status" }),
  ).toHaveText("Compilation succeeded", { timeout: 60_000 });
  await open();
  await request("synthetic broken edit");
  await dialog
    .getByRole("button", { name: "Apply all proposed edits", exact: true })
    .click();
  await expect(editor).toContainText("\\UnknownAssistantCommand");
  await page.getByRole("button", { name: "▷ Recompile", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Compilation status" }),
  ).toHaveText("Compilation failed", { timeout: 30_000 });
  await expect(page.locator(".compile-diagnostics")).toContainText(
    "Undefined control sequence",
  );
  await expect(page.locator(".pdf-file-label")).toContainText("Older output");
  await expect(
    page.getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("assistant-real-failure.png"),
    fullPage: true,
  });
  await open();
  await dialog.getByLabel("Task", { exact: true }).selectOption("diagnostic");
  await expect(
    dialog.getByLabel("Diagnostic text (optional, up to 4000 characters)", {
      exact: true,
    }),
  ).toHaveValue(/Undefined control sequence/);
  await request("Explain the undefined command", "diagnostic");
  await expect(
    dialog.getByText(
      "Synthetic diagnostic: undefined command. Review the source or restore its backup.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Apply all proposed edits",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Close assistant", exact: true })
    .click();
  // Quick restore is safe while the applied revision is still current.
  await open();
  const brokenRow = dialog.locator("li").filter({ hasText: "applied" }).first();
  await brokenRow
    .getByRole("button", { name: "Check request", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Restore before these edits", exact: true })
    .click();
  await expect(editor).not.toContainText("UnknownAssistantCommand");
  expect(
    (await compileAndInspect(page, info, "assistant-recovered")).text,
  ).toContain("Reviewed visible change.");
  const current = await (
    await context.request.get(`/api/projects/${project.id}`)
  ).json();
  await editor.fill(
    `${current.files.find((file: { path: string }) => file.path === "main.tex").content}\n% Later manual work\n`,
  );
  await page.getByRole("button", { name: "Save Ctrl S", exact: true }).click();
  await open();
  await dialog
    .locator("li")
    .filter({ hasText: "applied" })
    .first()
    .getByRole("button", { name: "Check request", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Restore before these edits", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Later work exists");
  await dialog
    .getByRole("button", { name: "Close assistant", exact: true })
    .click();
  await expect(editor).toContainText("Later manual work");
});
