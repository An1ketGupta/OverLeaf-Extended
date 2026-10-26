import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDatabase } from "@overleaf-pro/db";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { clearTestMail, inboxLink } from "../../scripts/test-account.js";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { verifyBrowserAccount } from "./account-helper.js";

const origin = "http://127.0.0.1:5273";
const accounts: string[] = [];
test.beforeEach(() =>
  test.skip(
    !process.env.TEST_DATABASE_URL,
    "Requires real separate PostgreSQL",
  ),
);
test.afterEach(async () => {
  const db = createDatabase(requireTestDatabase());
  try {
    await db.pool.query(
      'DELETE FROM verification WHERE value IN (SELECT id FROM "user" WHERE email=ANY($1::text[]))',
      [accounts],
    );
    await db.pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [
      accounts,
    ]);
    await clearTestMail(accounts);
  } finally {
    await db.close();
    accounts.length = 0;
  }
});
async function account(context: BrowserContext) {
  const email = `lifecycle-browser-${randomUUID()}@example.test`;
  accounts.push(email);
  const password = "synthetic-browser-lifecycle-42";
  expect(
    (
      await context.request.post("/api/auth/sign-up/email", {
        headers: { origin },
        data: { name: "Lifecycle Writer", email, password },
      })
    ).status(),
  ).toBe(200);
  await verifyBrowserAccount(context.request, email, password, origin);
  return { email, password };
}
async function workspace(
  page: Page,
  context: BrowserContext,
  name = "Managed project",
) {
  const response = await context.request.post("/api/projects", {
    headers: { origin },
    data: { name },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByRole("textbox", { name: "Source editor: main.tex", exact: true }),
  ).toBeVisible();
  return project;
}
const editor = (page: Page, path = "main.tex") =>
  page.getByRole("textbox", { name: `Source editor: ${path}`, exact: true });

test("rename and delete preserve saved history and require an explicit unsaved discard", async ({
  page,
  context,
}, testInfo) => {
  await account(context);
  const project = await workspace(page, context);
  await page
    .getByRole("button", { name: "Rename project", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Rename project",
    exact: true,
  });
  await dialog
    .getByLabel("Project name", { exact: true })
    .fill("Renamed writing desk");
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Renamed writing desk", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open sections/notes.tex", exact: true })
    .click();
  await editor(page, "sections/notes.tex").fill(
    "A saved note preserved through rename and deletion.",
  );
  await page
    .getByRole("button", { name: "Rename sections/notes.tex", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Rename file", exact: true });
  await dialog
    .getByLabel("New path", { exact: true })
    .fill("sections/renamed.tex");
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(editor(page, "sections/renamed.tex")).toContainText(
    "A saved note",
  );
  const file = (
    await (await context.request.get(`/api/projects/${project.id}`)).json()
  ).files.find(
    (item: { path: string }) => item.path === "sections/renamed.tex",
  );
  await page.route(`**/api/projects/${project.id}/files/${file.id}`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await editor(page, "sections/renamed.tex").fill(
    "Explicitly discarded offline note",
  );
  await page
    .getByRole("button", { name: "Delete sections/renamed.tex", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Delete file", exact: true });
  await dialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Save or resolve every draft",
  );
  await dialog.getByLabel(/Discard this file's unsaved draft/).check();
  await page.screenshot({
    path: testInfo.outputPath("delete-file-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("delete-file-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const snapshots = await (
    await context.request.get(`/api/projects/${project.id}/snapshots`)
  ).json();
  expect(snapshots.length).toBe(1);
  const frozen = await (
    await context.request.get(
      `/api/projects/${project.id}/snapshots/${snapshots[0].id}`,
    )
  ).json();
  expect(
    frozen.files.find((item: { id: string }) => item.id === file.id).content,
  ).toContain("A saved note");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole("button", { name: "Delete main.tex", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Delete file", exact: true });
  await dialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "another main .tex file",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Recoverable history" });
  await history
    .getByRole("button", {
      name: `Compare r${snapshots[0].revision}`,
      exact: true,
    })
    .click();
  await history
    .getByRole("button", {
      name: `Restore snapshot r${snapshots[0].revision}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Open sections/renamed.tex", exact: true })
    .click();
  await expect(editor(page, "sections/renamed.tex")).toContainText(
    "A saved note",
  );
});

test("remote project deletion keeps another tab's draft downloadable through refresh", async ({
  page,
  context,
}) => {
  await account(context);
  const project = await workspace(page, context, "Delete across tabs");
  const other = await context.newPage();
  await other.goto(`/projects/${project.id}`);
  await expect(editor(other)).toBeVisible();
  await other.route(`**/api/projects/${project.id}/files/**`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await editor(other).fill("Private unsaved work from the other tab");
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Delete project",
    exact: true,
  });
  await dialog
    .getByLabel("Type the project name to confirm")
    .fill("Delete across tabs");
  await dialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/projects`);
  await expect(
    other.getByText(/This project was deleted in another tab/),
  ).toBeVisible();
  await expect(editor(other)).toContainText("Private unsaved work");
  expect(
    (await context.request.get(`/api/projects/${project.id}`)).status(),
  ).toBe(404);
  other.on("dialog", (dialog) => dialog.accept());
  await other.reload();
  const recovery = other.getByRole("region", {
    name: "Unavailable file drafts",
  });
  await expect(recovery).toBeVisible();
  const downloadEvent = other.waitForEvent("download");
  await recovery
    .getByRole("button", { name: "Download recovered draft", exact: true })
    .click();
  const download = await downloadEvent;
  expect(await readFile((await download.path()) ?? "", "utf8")).toBe(
    "Private unsaved work from the other tab",
  );
  await other.close();
});

test("browser Back and app navigation stop on failed saves and retain drafts", async ({
  page,
  context,
}) => {
  await account(context);
  const project = await workspace(page, context);
  await page.goto("/projects");
  await page.getByRole("link", { name: /Managed project/ }).click();
  await expect(editor(page)).toBeVisible();
  await page.route(`**/api/projects/${project.id}/files/**`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await editor(page).fill("Navigation must keep this draft");
  await page.evaluate(() => history.back());
  const guard = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  await expect(guard).toBeVisible();
  await guard
    .getByRole("button", { name: "Save and leave", exact: true })
    .click();
  await expect(guard.getByRole("alert")).toContainText("Saving failed");
  await guard.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(editor(page)).toContainText("Navigation must keep this draft");
  await page.unroute(`**/api/projects/${project.id}/files/**`);
  await page
    .getByRole("link", { name: "OverLeaf-Pro home", exact: true })
    .click();
  await expect(guard).toBeVisible();
  await guard
    .getByRole("button", { name: "Save and leave", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/`);
  const saved = await (
    await context.request.get(`/api/projects/${project.id}`)
  ).json();
  expect(
    saved.files.find((item: { path: string }) => item.path === "main.tex")
      .content,
  ).toBe("Navigation must keep this draft");
});

test("actual verification and password reset links revoke other browser sessions and preserve recovery", async ({
  page,
  context,
}, testInfo) => {
  const email = `email-browser-${randomUUID()}@example.test`;
  accounts.push(email);
  const password = "synthetic-email-password-42";
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Email Writer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("verification link");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Verify your email first",
  );
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "If verification is needed",
  );
  await page.goto(await inboxLink(email, "Verify your email"));
  expect((await context.request.get("/api/session")).status()).toBe(401);
  await page.goto("/account");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const project = await workspace(page, context, "Password recovery draft");
  await page.route(`**/api/projects/${project.id}/files/**`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await editor(page).fill("Keep this draft through a password reset");
  const recovery = await context.newPage();
  await recovery.goto("/forgot-password");
  await recovery.getByLabel("Email", { exact: true }).fill(email);
  await recovery
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(recovery.getByRole("status")).toContainText(
    "If this address has an account",
  );
  const resetLink = await inboxLink(email, "Reset your password");
  await recovery.goto(resetLink);
  await recovery
    .getByLabel("New password", { exact: true })
    .fill("synthetic-new-email-password-42");
  await recovery
    .getByLabel("Confirm password", { exact: true })
    .fill("synthetic-new-email-password-42");
  await recovery
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(recovery.getByRole("status")).toContainText(
    "All previous sessions were revoked",
  );
  expect(new URL(recovery.url()).searchParams.has("token")).toBe(false);
  await page.bringToFront();
  await expect(
    page.getByRole("heading", { name: "Sign in to continue.", exact: true }),
  ).toBeVisible();
  await expect(editor(page)).not.toBeVisible();
  expect((await context.request.get("/api/session")).status()).toBe(401);
  await recovery.goto("/account");
  await recovery.getByLabel("Email", { exact: true }).fill(email);
  await recovery.getByLabel("Password", { exact: true }).fill(password);
  await recovery.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(recovery.getByRole("status")).toContainText("incorrect");
  await recovery
    .getByLabel("Password", { exact: true })
    .fill("synthetic-new-email-password-42");
  await recovery.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(recovery.getByText(email, { exact: true })).toBeVisible();
  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByText("An unsaved draft is waiting.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(editor(page)).toContainText(
    "Keep this draft through a password reset",
  );
  await recovery.setViewportSize({ width: 390, height: 844 });
  await recovery.screenshot({
    path: testInfo.outputPath("account-mobile.png"),
    fullPage: true,
  });
  expect(
    await recovery.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await recovery.close();
});

test("dashboard rename and permanent delete require the confirmed current revision", async ({
  page,
  context,
}, testInfo) => {
  await account(context);
  const project = await workspace(page, context, "Dashboard draft");
  await page.goto("/projects");
  await page
    .getByRole("button", {
      name: "Rename project Dashboard draft",
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Rename project",
    exact: true,
  });
  await dialog
    .getByLabel("Project name", { exact: true })
    .fill("Dashboard renamed");
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard renamed", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Delete project Dashboard renamed",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog", { name: "Delete project", exact: true });
  await dialog
    .getByLabel("Type the project name to confirm")
    .fill("Dashboard renamed");
  const saved = await (
    await context.request.get(`/api/projects/${project.id}`)
  ).json();
  await context.request.put(
    `/api/projects/${project.id}/files/${saved.files[0].id}`,
    {
      headers: { origin },
      data: {
        baseVersion: saved.files[0].version,
        content: "Other tab edit after confirmation opened",
      },
    },
  );
  await dialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Project changed");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Delete project Dashboard renamed",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog", { name: "Delete project", exact: true });
  await dialog
    .getByLabel("Type the project name to confirm")
    .fill("Dashboard renamed");
  await page.screenshot({ path: testInfo.outputPath("delete-project.png") });
  await dialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your desk is clear.", exact: true }),
  ).toBeVisible();
  expect(
    (await context.request.get(`/api/projects/${project.id}`)).status(),
  ).toBe(404);
  const recovered = await workspace(page, context, "Dashboard recovery draft");
  await page.route(`**/api/projects/${recovered.id}/files/**`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await editor(page).fill(
    "Recovery text must not be silently deleted from the dashboard",
  );
  await expect(
    page.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible();
  page.on("dialog", (native) => native.accept());
  await page.goto("/projects");
  await page
    .getByRole("button", {
      name: "Delete project Dashboard recovery draft",
      exact: true,
    })
    .click();
  const recoveryDialog = page.getByRole("dialog", {
    name: "Delete project",
    exact: true,
  });
  await recoveryDialog
    .getByLabel("Type the project name to confirm")
    .fill("Dashboard recovery draft");
  await recoveryDialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(recoveryDialog.getByRole("alert")).toContainText(
    "recover and save its drafts",
  );
  const downloaded = page.waitForEvent("download");
  await recoveryDialog
    .getByRole("button", { name: "Download drafts", exact: true })
    .click();
  expect(
    await readFile((await (await downloaded).path()) ?? "", "utf8"),
  ).toContain("must not be silently deleted");
  await recoveryDialog
    .getByLabel(/Discard this project's unsaved draft/)
    .check();
  await recoveryDialog
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(recoveryDialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((key) =>
        key.startsWith("overleaf-pro:draft:"),
      ),
    ),
  ).toBe(false);
});
