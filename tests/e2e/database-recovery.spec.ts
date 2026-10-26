import { randomUUID } from "node:crypto";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { verifyBrowserAccount } from "./account-helper.js";

async function control(action: string) {
  expect(
    (
      await fetch(`http://127.0.0.1:3102/${action}`, {
        method: "POST",
        headers: { "x-recovery-control": "synthetic-test-only" },
        signal: AbortSignal.timeout(20_000),
      })
    ).status,
  ).toBe(200);
}
test("disconnect during a real blocked transaction rolls back; API load failure retries without losing saved source", async ({
  page,
  context,
}, info) => {
  test.setTimeout(90_000);
  const email = `part7-transaction-${randomUUID()}@example.test`,
    password = "synthetic-transaction-password-42",
    origin = "http://127.0.0.1:5273";
  const db = createDatabase(requireTestDatabase());
  const lock = await db.pool.connect();
  try {
    expect(
      (
        await context.request.post("/api/auth/sign-up/email", {
          headers: { origin },
          data: { name: "Transaction recovery", email, password },
        })
      ).status(),
    ).toBe(200);
    await verifyBrowserAccount(context.request, email, password, origin);
    const project = await (
      await context.request.post("/api/projects", {
        headers: { origin },
        data: { name: "In-flight transaction" },
      })
    ).json();
    const file = project.files.find(
      (f: { path: string }) => f.path === "main.tex",
    );
    await page.goto(`/projects/${project.id}`);
    const editor = page.getByRole("textbox", {
      name: "Source editor: main.tex",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [
      project.id,
    ]);
    await editor.fill("Keep the interrupted transaction draft");
    await page
      .getByRole("button", { name: "Save Ctrl S", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          Number(
            (
              await db.pool.query(
                "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()",
              )
            ).rows[0]?.waiting,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    await control("database/drop");
    await expect(
      page.getByText("Save failed · draft kept", { exact: true }),
    ).toBeVisible();
    expect((await context.request.get("/api/health")).status()).toBe(200);
    expect((await context.request.get("/api/ready")).status()).toBe(503);
    await lock.query("ROLLBACK");
    await control("database/restore");
    const before = await (
      await context.request.get(`/api/projects/${project.id}`)
    ).json();
    expect(
      before.files.find((f: { id: string }) => f.id === file.id).content,
    ).toBe(file.content);
    expect(
      before.files.find((f: { id: string }) => f.id === file.id).version,
    ).toBe(file.version);
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(
      page.getByText("All changes saved", { exact: true }),
    ).toBeVisible();
    await control("stop");
    await page.reload();
    await expect(
      page.getByText(
        "Authentication needs a running API and configured database.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("api-load-retry.png"),
      fullPage: true,
    });
    await control("start");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(editor).toHaveText("Keep the interrupted transaction draft");
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
    await control("database/restore");
    await control("start");
    await db.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
    await db.close();
  }
});
