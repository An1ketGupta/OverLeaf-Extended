import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { projectSchema } from "@overleaf-pro/contracts";
import { createDatabase, projectRepository } from "@overleaf-pro/db";
import { expect, type Page, test } from "@playwright/test";
import { clearTestMail, inboxLink } from "../../scripts/test-account.js";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { fixturePng } from "../fixtures/image.js";
import { compileAndInspect } from "./pdf-helper.js";

const origin = "http://127.0.0.1:5273";
const password = "synthetic-part7-recovery-password-42";
const emails: string[] = [];
async function account(page: Page) {
  const email = `part7-browser-${randomUUID()}@example.test`;
  emails.push(email);
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Recovery journey");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("verification link");
  await page.goto(await inboxLink(email, "Verify your email"));
  await page.goto("/account");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  return email;
}
async function control(path: string) {
  const response = await fetch(`http://127.0.0.1:3102/${path}`, {
    method: "POST",
    headers: { "x-recovery-control": "synthetic-test-only" },
    signal: AbortSignal.timeout(20_000),
  });
  expect(response.status).toBe(200);
}
test.afterEach(async () => {
  await control("database/restore");
  await control("start");
  const db = createDatabase(requireTestDatabase());
  try {
    for (const email of emails.splice(0)) {
      await db.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
      await clearTestMail([email]);
    }
  } finally {
    await db.close();
  }
});

test("provider completion after deletion and pending requests across an actual API restart do not revive work", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await account(page);
  const created = await context.request.post("/api/projects", {
    headers: { origin },
    data: { name: "Delayed provider" },
  });
  const project = await created.json();
  const input = {
    requestId: randomUUID(),
    projectId: project.id,
    baseRevision: project.revision,
    mode: "explain",
    instruction: "Synthetic held reply",
    fileIds: [project.files[0].id],
    diagnostics: "",
    shareWithProvider: true,
  };
  await control("provider/hold");
  const pending = context.request.post("/api/ai-proposals", {
    headers: { origin },
    data: input,
  });
  await control("provider/wait");
  expect(
    (
      await (
        await context.request.get(`/api/ai-proposals/${input.requestId}`)
      ).json()
    ).status,
  ).toBe("pending");
  await control("stop");
  await pending.catch(() => undefined);
  await control("start");
  expect(
    (
      await (
        await context.request.get(`/api/ai-proposals/${input.requestId}`)
      ).json()
    ).status,
  ).toBe("pending");
  const db = createDatabase(requireTestDatabase());
  try {
    await db.pool.query(
      "UPDATE ai_proposal SET data=data || $2::jsonb WHERE id=$1",
      [
        input.requestId,
        JSON.stringify({
          createdAt: new Date(Date.now() - 60000).toISOString(),
        }),
      ],
    );
  } finally {
    await db.close();
  }
  expect(
    (
      await (
        await context.request.get(`/api/ai-proposals/${input.requestId}`)
      ).json()
    ).status,
  ).toBe("expired");
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Writing assistant" });
  await dialog
    .getByLabel("Instruction", { exact: true })
    .fill("Synthetic held reply");
  await dialog
    .getByLabel("Share this context with the configured provider", {
      exact: true,
    })
    .check();
  await control("provider/hold");
  await dialog
    .getByRole("button", { name: "Request assistance", exact: true })
    .click();
  await control("provider/wait");
  expect(
    (
      await context.request.delete(`/api/projects/${project.id}`, {
        headers: { origin },
        data: { baseRevision: 1 },
      })
    ).status(),
  ).toBe(204);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText(/This project was deleted in another tab/),
  ).toBeVisible();
  await control("provider/release");
  await expect(dialog.getByRole("status")).toContainText("Request not found");
  expect(
    (await context.request.get(`/api/projects/${project.id}`)).status(),
  ).toBe(404);
  expect(await (await context.request.get("/api/ai-proposals")).json()).toEqual(
    [],
  );
});

test("keyboard modal focus and narrow layouts stay usable; an old project read cannot invalidate a later save", async ({
  page,
  context,
}, info) => {
  test.setTimeout(90_000);
  await account(page);
  const created = await context.request.post("/api/projects", {
    headers: { origin },
    data: { name: "Keyboard and stale reads" },
  });
  const project = await created.json();
  await page.goto(`/projects/${project.id}`);
  const editor = page.getByRole("textbox", {
    name: "Source editor: main.tex",
    exact: true,
  });
  await expect(editor).toBeVisible();
  let release: () => void = () => {},
    arrived: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delivered: () => void = () => {};
  const delivery = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let held = false;
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() !== "GET" || held) return route.continue();
    held = true;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
    delivered();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waiting;
  await editor.fill("Later saved source wins over a delayed project read");
  await editor.press("Control+s");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  release();
  await delivery;
  // A subsequent read provides a deterministic barrier after delivery of the old one.
  await page.unroute(`**/api/projects/${project.id}`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText(/This project changed in another tab/),
  ).toHaveCount(0);
  const history = page.getByRole("button", { name: "History", exact: true });
  await history.focus();
  await page.keyboard.press("Enter");
  const modal = page.getByRole("dialog", { name: "Recoverable history" });
  await expect(modal).toBeVisible();
  await modal.getByLabel("Snapshot name").focus();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    expect(
      await modal.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(history).toBeFocused();
  const assistant = page.getByRole("button", {
    name: "AI assistant",
    exact: true,
  });
  await assistant.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog", { name: "Writing assistant" })
    .getByLabel("Instruction", { exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(assistant).toBeFocused();
  await editor.focus();
  await editor.press("Control+f");
  await expect(page.getByPlaceholder("Find", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.press("Escape");
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
  for (const width of [320, 390, 640]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByLabel("Find a file", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(editor).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`keyboard-workspace-${width}.png`),
      fullPage: true,
    });
  }
});

test("complete UI signup to template, saved edit, real PDFs, reviewed AI, exact-byte private analysis and restore", async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  await account(page);
  await page.goto("/projects");
  await page
    .getByLabel("New project", { exact: true })
    .fill("Complete recovery journey");
  await page.getByLabel("Starting template").selectOption("resume-classic");
  await page
    .getByRole("button", { name: "+ Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[\da-f-]+$/);
  const projectUrl = page.url(),
    id = projectUrl.split("/").pop();
  const current = await (
    await context.request.get(`/api/projects/${id}`)
  ).json();
  const editor = page.getByRole("textbox", {
    name: "Source editor: main.tex",
    exact: true,
  });
  const original = current.files
    .find((file: { path: string }) => file.path === "main.tex")
    .content.replace(
      "\\end{document}",
      "\\par Saved journey marker.\\par\n\\end{document}",
    );
  await editor.fill(original);
  await page.getByRole("button", { name: "Save Ctrl S", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await editor.press("Control+End");
  await expect(editor).toContainText("Saved journey marker.");
  const history = page.getByRole("dialog", { name: "Recoverable history" });
  const historyButton = page.getByRole("button", {
    name: "History",
    exact: true,
  });
  await historyButton.focus();
  await page.keyboard.press("Enter");
  await history.getByLabel("Snapshot name").fill("Before reviewed edits");
  await history.getByRole("button", { name: "Save named snapshot" }).click();
  await expect(history.getByRole("status")).toHaveText("Named snapshot saved.");
  await page.keyboard.press("Escape");
  await expect(historyButton).toBeFocused();
  expect(
    (await compileAndInspect(page, info, "journey-baseline")).text,
  ).toContain("Saved journey marker.");
  const assistantButton = page.getByRole("button", {
    name: "AI assistant",
    exact: true,
  });
  await assistantButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Writing assistant" });
  await dialog.getByLabel("Task", { exact: true }).selectOption("rewrite");
  await dialog
    .getByLabel("Instruction", { exact: true })
    .fill("synthetic visible edit");
  await dialog
    .getByLabel("Share this context with the configured provider", {
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Request assistance", exact: true })
    .click();
  await expect(dialog.locator(".source-diff")).toContainText(
    "Reviewed visible change.",
  );
  await dialog
    .getByRole("button", { name: "Apply all proposed edits", exact: true })
    .click();
  await expect(editor).toContainText("Reviewed visible change.");
  await page.getByRole("button", { name: "▷ Recompile", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Compilation status" }),
  ).toHaveText("Compilation succeeded", { timeout: 60_000 });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloaded;
  const bytes = await readFile((await download.path()) ?? "");
  const hash = createHash("sha256").update(bytes).digest("hex");
  await download.saveAs(info.outputPath("journey-reviewed.pdf"));
  await page
    .getByRole("button", { name: "Analyze resume PDF", exact: true })
    .click();
  await expect(page.locator(".hash-label")).toContainText(hash, {
    timeout: 20_000,
  });
  await page
    .getByText("Inspect all extracted text and page locations", { exact: true })
    .click();
  await expect(page.locator(".extracted-text")).toContainText(
    "Reviewed visible change.",
  );
  await page.getByLabel("Required terms or phrases").fill("TypeScript");
  await page
    .getByRole("button", { name: "Update analysis and job coverage" })
    .click();
  await page
    .getByRole("button", { name: "Save private report", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resume report" }).getByRole("status"),
  ).toContainText("Private report saved:");
  await page.getByRole("button", { name: "Open report", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Resume report" }).getByRole("status"),
  ).toContainText("Saved report loaded for this exact PDF hash");
  for (const width of [320, 390, 640]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`analysis-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(projectUrl);
  await historyButton.click();
  await history
    .getByRole("button", { name: "Compare r2", exact: true })
    .click();
  await history
    .getByRole("button", { name: "Restore snapshot r2", exact: true })
    .click();
  await expect(editor).not.toContainText("Reviewed visible change.");
  const restored = (await compileAndInspect(page, info, "journey-restored"))
    .text;
  expect(restored).toContain("Saved journey marker.");
  expect(restored).not.toContain("Reviewed visible change.");
  const snapshots = await (
    await context.request.get(`/api/projects/${id}/snapshots`)
  ).json();
  expect(
    snapshots.some((snapshot: { revision: number }) => snapshot.revision === 3),
  ).toBe(true);
});

test("full-history source backup recovers exact nested Unicode source and image bytes into a new compilable project", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  await account(page);
  const png = fixturePng();
  const content =
    "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nRecovered Unicode: Zoë.\\input{nested/notes.tex}\\includegraphics{images/chart.png}\n\\end{document}";
  const payload = {
    name: "Backup original",
    mainFile: "main.tex",
    files: [
      { path: "main.tex", content },
      { path: "nested/notes.tex", content: "Backup recovery verified." },
    ],
    assets: [{ path: "images/chart.png", dataBase64: png.toString("base64") }],
  };
  const response = await context.request.post("/api/projects/import", {
    headers: { origin },
    data: payload,
  });
  expect(response.status()).toBe(201);
  let project = projectSchema.parse(await response.json());
  const db = createDatabase(requireTestDatabase());
  try {
    const user = (await (await context.request.get("/api/session")).json()).user
      .id;
    const repo = projectRepository(db.pool);
    for (let revision = 0; revision < 20; revision++) {
      await repo.createSnapshot(user, project.id, project.revision);
      const file = project.files.find((f) => f.path === "nested/notes.tex");
      expect(file).toBeTruthy();
      await repo.save(
        user,
        project.id,
        file?.id ?? "",
        file?.version ?? 0,
        `Backup recovery verified. % revision ${revision}`,
      );
      project = projectSchema.parse(await repo.get(user, project.id));
    }
  } finally {
    await db.close();
  }
  await page.goto(`/projects/${project.id}`);
  const exporting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export project (.zip)", exact: true })
    .click();
  const archive = await exporting;
  const archivePath = info.outputPath("full-history-backup.zip");
  await archive.saveAs(archivePath);
  expect(
    (
      await (
        await context.request.get(`/api/projects/${project.id}/snapshots`)
      ).json()
    ).length,
  ).toBe(20);
  expect(
    (
      await context.request.delete(`/api/projects/${project.id}`, {
        headers: { origin },
        data: { baseRevision: project.revision },
      })
    ).status(),
  ).toBe(204);
  await page.goto("/projects");
  await page.getByLabel("Project backup ZIP").setInputFiles(archivePath);
  await page.getByLabel("Recovered project name").fill("Recovered from export");
  await page
    .getByRole("button", { name: "Import project backup", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[\da-f-]+$/);
  const restored = await (
    await context.request.get(`/api/projects/${page.url().split("/").pop()}`)
  ).json();
  expect(restored.id).not.toBe(project.id);
  expect(restored.mainFile).toBe(project.mainFile);
  expect(
    restored.files.map((f: { path: string; content: string }) => [
      f.path,
      f.content,
    ]),
  ).toEqual(project.files.map((f) => [f.path, f.content]));
  expect(restored.assets[0].dataBase64).toBe(project.assets?.[0]?.dataBase64);
  expect(
    (await compileAndInspect(page, info, "backup-restored")).text,
  ).toContain("Backup recovery verified.");
});

test("actual API restart and database disconnect preserve drafts; lost acknowledgements and expired sessions recover explicitly", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  page.on("dialog", (dialog) => void dialog.accept());
  const email = await account(page);
  const created = await context.request.post("/api/projects", {
    headers: { origin },
    data: { name: "Outage recovery" },
  });
  const project = await created.json();
  const projectUrl = `/projects/${project.id}`;
  await page.goto(projectUrl);
  const editor = page.getByRole("textbox", {
    name: "Source editor: main.tex",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save Ctrl S", exact: true });
  await expect(editor).toBeVisible();
  await control("stop");
  await editor.fill("Draft survives actual API restart");
  await save.click();
  await expect(
    page.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.screenshot({
    path: info.outputPath("api-offline-draft.png"),
    fullPage: true,
  });
  await control("start");
  await save.click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toHaveText("Draft survives actual API restart");
  await control("database/drop");
  await editor.fill("Draft survives real database transport interruption");
  await save.click();
  await expect(
    page.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  expect((await context.request.get("/api/health")).status()).toBe(200);
  expect((await context.request.get("/api/ready")).status()).toBe(503);
  await control("database/restore");
  await save.click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  expect((await context.request.get("/api/ready")).status()).toBe(200);
  // Server commits but the browser loses the acknowledgement. Retrying must conflict.
  await page.route(`**/api/projects/${project.id}/files/*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fetch();
    await route.abort("failed");
  });
  await editor.fill("Committed but acknowledgement lost");
  await save.click();
  await expect(
    page.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible();
  await page.unroute(`**/api/projects/${project.id}/files/*`);
  await save.click();
  await expect(
    page.getByText("Version conflict · draft kept", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Compare saved version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Save my draft over v/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Save my draft over v/ }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.route(`**/api/projects/${project.id}/files/*`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await editor.fill("Recover after persisted session expiry");
  await save.click();
  await expect(
    page.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible();
  const db = createDatabase(requireTestDatabase());
  try {
    await db.pool.query(
      "UPDATE session SET expires_at=now()-interval '1 minute' WHERE user_id IN (SELECT id FROM \"user\" WHERE email=$1)",
      [email],
    );
  } finally {
    await db.close();
  }
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to continue." }),
  ).toBeVisible();
  await page.unroute(`**/api/projects/${project.id}/files/*`);
  const signin = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: { email, password },
  });
  expect(signin.status()).toBe(200);
  await page.reload();
  await page
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await save.click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toHaveText("Recover after persisted session expiry");
});
