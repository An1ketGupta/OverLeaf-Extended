import { randomUUID } from "node:crypto";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { fixturePdf } from "../fixtures/resume.js";
import { verifyBrowserAccount } from "./account-helper.js";

test("report quota preserves local PDF analysis and deleting an old report makes saving useful again", async ({
  page,
  context,
}, info) => {
  const email = `part7-reports-${randomUUID()}@example.test`,
    password = "synthetic-report-quota-password-42",
    origin = "http://127.0.0.1:5273";
  const db = createDatabase(requireTestDatabase());
  try {
    expect(
      (
        await context.request.post("/api/auth/sign-up/email", {
          headers: { origin },
          data: { name: "Report quota", email, password },
        })
      ).status(),
    ).toBe(200);
    await verifyBrowserAccount(context.request, email, password, origin);
    await page.goto("/resume");
    await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
      name: "synthetic-resume.pdf",
      mimeType: "application/pdf",
      buffer: fixturePdf(),
    });
    const report = page.getByRole("region", { name: "Resume report" });
    await expect(
      report.getByRole("heading", {
        name: "Our compatibility estimate: 100/100",
        exact: true,
      }),
    ).toBeVisible();
    await report
      .getByRole("button", { name: "Save private report", exact: true })
      .click();
    await expect(report.getByRole("status")).toContainText(
      "Private report saved:",
    );
    const list = await (
      await context.request.get("/api/resume-analyses")
    ).json();
    const saved = await (
      await context.request.get(`/api/resume-analyses/${list[0].id}`)
    ).json();
    for (let i = 1; i < 20; i++)
      expect(
        (
          await context.request.post("/api/resume-analyses", {
            headers: { origin },
            data: saved.input,
          })
        ).status(),
      ).toBe(201);
    await report
      .getByRole("button", { name: "Load my saved reports", exact: true })
      .click();
    await expect(
      report.getByRole("button", { name: "Delete report", exact: true }),
    ).toHaveCount(20);
    await report
      .getByRole("button", { name: "Save private report", exact: true })
      .click();
    await expect(report.getByRole("status")).toHaveText(
      "Saved report limit reached. Delete older reports first.",
    );
    await expect(report.locator(".hash-label")).toContainText(
      saved.input.extraction.pdfSha256,
    );
    await page.setViewportSize({ width: 320, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("report-quota-320.png"),
      fullPage: true,
    });
    await report
      .getByRole("button", { name: "Delete report", exact: true })
      .first()
      .click();
    await expect(
      report.getByRole("button", { name: "Delete report", exact: true }),
    ).toHaveCount(19);
    await report
      .getByRole("button", { name: "Save private report", exact: true })
      .click();
    await expect(report.getByRole("status")).toContainText(
      "Private report saved:",
    );
    await expect(
      report.getByRole("button", { name: "Delete report", exact: true }),
    ).toHaveCount(20);
  } finally {
    await db.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
    await db.close();
  }
});
