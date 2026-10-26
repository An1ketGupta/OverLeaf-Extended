import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { verifyBrowserAccount } from "./account-helper.js";

test("measure cold and five warm product compiles, API and synthetic provider latency", async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const origin = "http://127.0.0.1:5273",
    email = `part7-performance-${randomUUID()}@example.test`,
    password = "synthetic-performance-password-42";
  const db = createDatabase(requireTestDatabase());
  const results = [];
  try {
    expect(
      (
        await context.request.post("/api/auth/sign-up/email", {
          headers: { origin },
          data: { name: "Synthetic timing", email, password },
        })
      ).status(),
    ).toBe(200);
    await verifyBrowserAccount(context.request, email, password, origin);
    const apiTimes = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      expect((await context.request.get("/api/session")).status()).toBe(200);
      apiTimes.push(performance.now() - start);
    }
    for (const templateId of ["resume-classic", "resume-compact", "report"]) {
      const project = await (
        await context.request.post("/api/projects", {
          headers: { origin },
          data: { name: `Timing ${templateId}`, templateId },
        })
      ).json();
      await page.goto(`/projects/${project.id}`);
      await expect(
        page.getByRole("textbox", {
          name: "Source editor: main.tex",
          exact: true,
        }),
      ).toBeVisible();
      const times = [];
      for (let iteration = 0; iteration < 6; iteration++) {
        const start = performance.now();
        await page
          .getByRole("button", { name: "▷ Recompile", exact: true })
          .click();
        await expect(
          page.getByRole("status", { name: "Compilation status" }),
        ).toHaveText("Compilation succeeded", { timeout: 60_000 });
        await expect(page.locator(".pdf-message")).toContainText("ready", {
          timeout: 20_000,
        });
        times.push(Math.round(performance.now() - start));
        if (iteration === 0) {
          const downloading = page.waitForEvent("download");
          await page
            .getByRole("button", { name: "Download PDF", exact: true })
            .click();
          const download = await downloading;
          const bytes = await readFile((await download.path()) ?? "");
          expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
          await download.saveAs(info.outputPath(`timing-${templateId}.pdf`));
          await page.screenshot({
            path: info.outputPath(`timing-${templateId}.png`),
            fullPage: true,
          });
        }
      }
      const providerStart = performance.now();
      const proposal = await context.request.post("/api/ai-proposals", {
        headers: { origin },
        data: {
          requestId: randomUUID(),
          projectId: project.id,
          baseRevision: 1,
          mode: "explain",
          instruction: "Synthetic timing only",
          fileIds: [
            project.files.find(
              (file: { path: string }) => file.path === "main.tex",
            ).id,
          ],
          diagnostics: "",
          shareWithProvider: true,
        },
      });
      expect(proposal.status()).toBe(201);
      expect((await proposal.json()).status).toBe("ready");
      const warm = times.slice(1).sort((a, b) => a - b);
      results.push({
        templateId,
        coldMs: times[0],
        warmMs: times.slice(1),
        warmMedianMs: warm[2],
        warmRangeMs: [warm[0], warm.at(-1)],
        syntheticProviderMs: Math.round(performance.now() - providerStart),
      });
    }
    await mkdir(".cache/part-7", { recursive: true });
    const evidence = {
      observedAt: new Date().toISOString(),
      node: process.version,
      browser: browser.version(),
      cpu: cpus()[0]?.model,
      platform: `${platform()} ${release()}`,
      scope:
        "local cold asset loading and five warm compiles through the real product to rendered PDF; synthetic upstream only",
      sessionApiMs: apiTimes.map(Math.round),
      results,
    };
    await writeFile(
      ".cache/part-7/product-performance.json",
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence));
  } finally {
    await db.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
    await db.close();
  }
});
