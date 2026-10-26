import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { templateCatalog } from "@overleaf-pro/contracts";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { verifyBrowserAccount } from "./account-helper.js";
import { compileAndInspect } from "./pdf-helper.js";

const expected: Record<(typeof templateCatalog)[number]["id"], string[]> = {
  "resume-classic": [
    "Alex Example",
    "alex@example.test",
    "Experience",
    "Education",
    "TypeScript",
  ],
  "resume-compact": [
    "Morgan Sample",
    "morgan@example.test",
    "Experience",
    "Education",
    "Sample Catalog",
  ],
  report: [
    "A Synthetic Document Workflow Study",
    "Contents",
    "Introduction",
    "Findings",
    "Section 1.1",
    "Synthetic workflow protocol",
  ],
};
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

for (const template of templateCatalog) {
  test(`catalog ${template.id}: real PDF text, independent copies, edited and restored compilation`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    // A focused catalog invocation must fail when prerequisites are missing.
    expect(Boolean(process.env.TEST_DATABASE_URL)).toBe(true);
    expect(existsSync("apps/web/public/compiler/manifest.json")).toBe(true);
    const origin = "http://127.0.0.1:5273";
    const email = `catalog-${randomUUID()}@example.test`;
    emails.push(email);
    const password = "synthetic-template-password-42";
    expect(
      (
        await context.request.post("/api/auth/sign-up/email", {
          headers: { origin },
          data: { name: "Template check", email, password },
        })
      ).status(),
    ).toBe(200);
    await verifyBrowserAccount(context.request, email, password, origin);
    const create = async () => {
      const response = await context.request.post("/api/projects", {
        headers: { origin },
        data: { name: `Catalog ${template.id}`, templateId: template.id },
      });
      expect(response.status()).toBe(201);
      return response.json();
    };
    const project = await create();
    const independent = await create();
    await page.goto(`/projects/${project.id}`);
    const baseline = await compileAndInspect(
      page,
      info,
      `${template.id}-baseline`,
    );
    for (const text of expected[template.id])
      expect(baseline.text).toContain(text);
    expect(baseline.text).not.toContain("??");
    await page.getByRole("button", { name: "History", exact: true }).click();
    const history = page.getByRole("dialog", { name: "Recoverable history" });
    await history.getByLabel("Snapshot name").fill("Verified template");
    await history.getByRole("button", { name: "Save named snapshot" }).click();
    await expect(history.getByText("Named snapshot saved.")).toBeVisible();
    await history.getByRole("button", { name: "Close history" }).click();
    const original = project.files.find(
      (file: { path: string }) => file.path === "main.tex",
    ).content as string;
    const marker = "Template edit verified.";
    await page
      .getByRole("textbox", { name: "Source editor: main.tex", exact: true })
      .fill(
        original.replace(
          "\\end{document}",
          `\\par\\noindent ${marker}\\par\n\\end{document}`,
        ),
      );
    expect(
      (await compileAndInspect(page, info, `${template.id}-edited`)).text,
    ).toContain(marker);
    const untouched = await (
      await context.request.get(`/api/projects/${independent.id}`)
    ).json();
    expect(
      untouched.files
        .map((file: { content: string }) => file.content)
        .join(" "),
    ).not.toContain(marker);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await history
      .getByRole("button", { name: "Compare r1", exact: true })
      .click();
    await history.getByLabel("Compare file").selectOption("main.tex");
    await expect(
      history.getByRole("region", { name: "Source diff", exact: true }),
    ).toContainText(marker);
    await history
      .getByRole("button", { name: "Restore snapshot r1", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", {
        name: "Source editor: main.tex",
        exact: true,
      }),
    ).not.toContainText(marker);
    const restored = await compileAndInspect(
      page,
      info,
      `${template.id}-restored`,
    );
    for (const text of expected[template.id])
      expect(restored.text).toContain(text);
    expect(restored.text).not.toContain(marker);
    console.log(
      `Catalog ${template.id}: baseline/edit/restore PDF text passed.`,
    );
  });
}
