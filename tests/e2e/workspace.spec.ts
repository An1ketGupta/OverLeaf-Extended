import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDatabase } from "@overleaf-pro/db";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { verifyBrowserAccount } from "./account-helper.js";

const origin = "http://127.0.0.1:5273";
const accounts: string[] = [];
let authCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
test.beforeAll(async ({ browser }) => {
  test.skip(
    !process.env.TEST_DATABASE_URL,
    "Workspace checks require a separate PostgreSQL test database.",
  );
  const email = `editor-${randomUUID()}@example.test`;
  accounts.push(email);
  const authContext = await browser.newContext({ baseURL: origin });
  const signup = await authContext.request.post("/api/auth/sign-up/email", {
    headers: { origin },
    data: {
      name: "Synthetic Writer",
      email,
      password: "synthetic-editor-password-42",
    },
  });
  expect(signup.status()).toBe(200);
  await verifyBrowserAccount(
    authContext.request,
    email,
    "synthetic-editor-password-42",
    origin,
  );
  authCookies = await authContext.cookies();
  await authContext.close();
});
test.beforeEach(async ({ context }) => {
  test.skip(
    !process.env.TEST_DATABASE_URL,
    "Workspace checks require PostgreSQL.",
  );
  await context.addCookies(authCookies);
  if ((await context.request.get("/api/session")).status() === 401) {
    const signin = await context.request.post("/api/auth/sign-in/email", {
      headers: { origin },
      data: { email: accounts[0], password: "synthetic-editor-password-42" },
    });
    expect(signin.status()).toBe(200);
    authCookies = await context.cookies();
  }
});
test.afterAll(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  const database = createDatabase(requireTestDatabase());
  try {
    await database.pool.query(
      'DELETE FROM "user" WHERE email = ANY($1::text[])',
      [accounts],
    );
  } finally {
    await database.close();
  }
  accounts.length = 0;
});
async function openProject(page: Page) {
  await page.goto("/projects");
  await page
    .getByLabel("New project", { exact: true })
    .fill("A thoughtful draft");
  await page.getByRole("button", { name: "+ Create project" }).click();
  await expect(
    page.getByRole("textbox", { name: "Source editor: main.tex", exact: true }),
  ).toBeVisible();
  return page.getByRole("textbox", {
    name: "Source editor: main.tex",
    exact: true,
  });
}
test("real autosave, file switching, search, completion, shortcuts, resizing and mobile panels", async ({
  page,
}, testInfo) => {
  const editor = await openProject(page);
  await editor.fill("\\section{Saved from the browser}\nFirst draft.");
  await page
    .getByRole("button", {
      name: "Open sections/notes.tex",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Source editor: sections/notes.tex",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "main.tex", exact: true }).click();
  await expect(editor).toContainText("Saved from the browser");
  await page.reload();
  await expect(editor).toContainText("Saved from the browser");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await editor.fill("\\sec");
  await editor.press("Control+Space");
  await expect(
    page.getByRole("option", { name: "\\section", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: "\\section", exact: true }).click();
  await expect(editor).toContainText("\\section{title}");
  await editor.press("Escape");
  await editor.press("Control+s");
  await expect(
    page
      .getByRole("status", { name: "" })
      .filter({ hasText: "All changes saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Find Ctrl F" }).click();
  await expect(page.getByPlaceholder("Find", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Find", { exact: true }).press("Escape");
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page.getByLabel("New file path").fill("sections/method.tex");
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Source editor: sections/method.tex",
      exact: true,
    }),
  ).toBeVisible();
  const divider = page.getByRole("separator", { name: "Resize file panel" });
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "236");
  const pdfDivider = page.getByRole("separator", { name: "Resize PDF panel" });
  const box = await pdfDivider.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + 3, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x - 40, box.y + 50);
    await page.mouse.up();
  }
  await expect(pdfDivider).toHaveAttribute("aria-valuenow", "503");
  await expect(page.getByRole("button", { name: "▷ Recompile" })).toBeEnabled();
  await page.getByRole("tab", { name: "main.tex", exact: true }).click();
  await editor.fill(
    "\\documentclass[11pt]{article}\n\\usepackage[margin=1in]{geometry}\n\n\\title{A thoughtful draft}\n\\author{}\n\\date{}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nEvery great document starts with a first draft.\n\n\\input{sections/method.tex}\n\n\\end{document}",
  );
  await editor.press("Control+s");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "PDF preview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your words, beautifully set." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByLabel("Find a file", { exact: true }).fill("method");
  await expect(
    page.getByRole("button", { name: "Open sections/method.tex", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open sections/method.tex", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Source editor: sections/method.tex",
      exact: true,
    }),
  ).toBeVisible();
});
test("project export saves all source into a ZIP and rejects unseen remote changes", async ({
  page,
  context,
}, testInfo) => {
  const editor = await openProject(page);
  const content = "\\section{Exact export}\nUnicode: Zoë, 李.\n";
  await editor.fill(content);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export project (.zip)", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^project-.*-r2\.zip$/);
  const zipPath = testInfo.outputPath("project-export.zip");
  await download.saveAs(zipPath);
  const zip = await readFile(zipPath);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  for (const text of [
    content,
    "source/main.tex",
    "source/sections/notes.tex",
    "snapshot.json",
    "overleaf-pro-source-v2",
  ])
    expect(zip.includes(Buffer.from(text))).toBe(true);
  await expect(page.getByText(/Exported saved revision 2\./)).toBeVisible();
  // An edit by another tab must be reviewed, even when this tab has no dirty file.
  const projectId = page.url().split("/").pop();
  const current = await context.request.get(`/api/projects/${projectId}`);
  expect(current.status()).toBe(200);
  const project = await current.json();
  const updated = await context.request.put(
    `/api/projects/${projectId}/files/${project.files[0].id}`,
    {
      headers: { origin },
      data: {
        baseVersion: project.files[0].version,
        content: "Changed by another tab",
      },
    },
  );
  expect(updated.status()).toBe(200);
  await page
    .getByRole("button", { name: "Export project (.zip)", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Saved files changed while this project was open. Reload and review them before exporting.",
  );
  expect(await editor.textContent()).toContain("Exact export");
});

test("failed saves preserve a tab draft through refresh and reconnect", async ({
  page,
  context,
}) => {
  const editor = await openProject(page);
  await context.setOffline(true);
  await editor.fill("Offline work survives reconnect.");
  await editor.press("Control+s");
  await expect(
    page.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/projects/*/files/*", (route) =>
    route.abort("failed"),
  );
  await editor.fill("Recover this private tab draft.");
  await editor.press("Control+s");
  await expect(
    page.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText("An unsaved draft is waiting.")).toBeVisible();
  await expect(editor).toBeHidden();
  await page
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(editor).toContainText("Recover this private tab draft.");
  await page.unroute("**/api/projects/*/files/*");
  await editor.press("Control+s");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toContainText("Recover this private tab draft.");
});
test("two tabs conflict without losing either version, and logout clears other tabs", async ({
  page,
  context,
}) => {
  const editor = await openProject(page);
  const other = await context.newPage();
  await other.goto(page.url());
  const otherEditor = other.getByRole("textbox", {
    name: "Source editor: main.tex",
    exact: true,
  });
  await expect(otherEditor).toBeVisible();
  await editor.fill("Saved in the first tab.");
  await editor.press("Control+s");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await otherEditor.fill("Kept in the second tab.");
  await otherEditor.press("Control+s");
  await expect(
    other.getByText("Version conflict · draft kept", { exact: true }),
  ).toBeVisible();
  await other
    .getByRole("button", { name: "Compare saved version", exact: true })
    .click();
  await expect(
    other.getByRole("textbox", { name: "Saved version · v2" }),
  ).toHaveValue("Saved in the first tab.");
  await expect(
    other.getByRole("textbox", { name: "Your draft", exact: true }),
  ).toHaveValue("Kept in the second tab.");
  await other
    .getByRole("button", { name: "Save my draft over v2", exact: true })
    .click();
  await expect(
    other.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toContainText("Kept in the second tab.");
  await other.route("**/api/projects/*/files/*", (route) =>
    route.abort("failed"),
  );
  await otherEditor.fill("A draft that must be removed on logout.");
  await otherEditor.press("Control+s");
  await expect(
    other.getByText("Save failed · draft kept", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    other.getByRole("heading", { name: "Signed out.", exact: true }),
  ).toBeVisible();
  expect(
    await other.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("overleaf-pro:draft:"),
        ).length,
    ),
  ).toBe(0);
  expect(await other.getByRole("textbox").count()).toBe(0);
  await other.close();
});

function syntheticPdf() {
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  const text = "BT /F1 20 Tf 40 120 Td (Local preview test) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  objects.forEach((object, index) => {
    offsets.push(chunks.join("").length);
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xref = chunks.join("").length;
  chunks.push(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  );
  return Buffer.from(chunks.join(""));
}
test("PDF.js previews actual local bytes and rejects malformed input", async ({
  page,
}) => {
  await openProject(page);
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "local-test.pdf",
    mimeType: "application/pdf",
    buffer: syntheticPdf(),
  });
  await expect(
    page.getByRole("img", { name: "PDF page 1 of 1" }),
  ).toBeVisible();
  await expect(page.getByText("Page 1 ready.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("This PDF is not compiled from this project.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
    name: "invalid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  });
  await expect(
    page.getByText("This file does not contain a PDF header.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "PDF page 1 of 1" })).toHaveCount(
    0,
  );
});

test("template copies, named history, source diff and recoverable full-tree restore", async ({
  page,
}, testInfo) => {
  await page.goto("/projects");
  await page
    .getByLabel("New project", { exact: true })
    .fill("A report from a template");
  await page.getByLabel("Starting template").selectOption("report");
  await page.getByRole("button", { name: "+ Create project" }).click();
  const editor = page.getByRole("textbox", {
    name: "Source editor: main.tex",
    exact: true,
  });
  await expect(editor).toContainText("A Synthetic Document Workflow Study");
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Recoverable history" });
  await history.getByLabel("Snapshot name").fill("Starting report");
  await history.getByRole("button", { name: "Save named snapshot" }).click();
  await expect(history.getByText("Named snapshot saved.")).toBeVisible();
  await history.getByRole("button", { name: "Close history" }).click();
  await editor.fill("Changed report from the browser");
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page.getByLabel("New file path").fill("later.tex");
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Source editor: later.tex",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await history
    .getByRole("button", { name: "Compare r1", exact: true })
    .click();
  await history.getByLabel("Compare file").selectOption("main.tex");
  await expect(
    history.getByRole("region", { name: "Source diff", exact: true }),
  ).toContainText("+ Changed report from the browser");
  await page.screenshot({ path: testInfo.outputPath("history-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("history-mobile.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await history
    .getByRole("button", { name: "Restore snapshot r1", exact: true })
    .click();
  await expect(editor).toContainText("A Synthetic Document Workflow Study");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    history.getByText("Starting report", { exact: true }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Compare r3", exact: true })
    .click();
  await history.getByLabel("Compare file").selectOption("later.tex");
  await expect(history.getByLabel("Compare file")).toContainText(
    "later.tex (removed since snapshot)",
  );
  await history
    .getByRole("button", { name: "Restore snapshot r3", exact: true })
    .click();
  await expect(editor).toContainText("Changed report from the browser");
});

test("history rejects a restore after an unseen remote edit", async ({
  page,
}) => {
  const editor = await openProject(page);
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog");
  await history.getByLabel("Snapshot name").fill("Before remote changes");
  await history.getByRole("button", { name: "Save named snapshot" }).click();
  await expect(history.getByText("Named snapshot saved.")).toBeVisible();
  await history
    .getByRole("button", { name: "Compare r1", exact: true })
    .click();
  const url = `/api${new URL(page.url()).pathname}`;
  const project = await (await page.request.get(url)).json();
  const file = project.files.find(
    (item: { path: string }) => item.path === "main.tex",
  );
  expect(
    (
      await page.request.put(`${url}/files/${file.id}`, {
        headers: { origin },
        data: {
          baseVersion: file.version,
          content: "Remote change must survive",
        },
      })
    ).status(),
  ).toBe(200);
  await history
    .getByRole("button", { name: "Restore snapshot r1", exact: true })
    .click();
  await expect(history.getByRole("status")).toContainText(
    "Project changed since comparison",
  );
  await page.reload();
  await expect(editor).toContainText("Remote change must survive");
});
