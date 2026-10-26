import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page, type TestInfo } from "@playwright/test";

// Exercises the product compiler, download and real PDF extraction in dev/built apps.
export async function compileAndInspect(
  page: Page,
  info: TestInfo,
  name: string,
) {
  await page.getByRole("button", { name: "▷ Recompile", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Compilation status" }),
  ).toHaveText("Compilation succeeded", { timeout: 60_000 });
  await expect(page.locator(".pdf-message")).toContainText("ready", {
    timeout: 20_000,
  });
  expect(
    (await page.locator(".compile-diagnostics").allTextContents()).join(" "),
  ).not.toMatch(
    /undefined references|undefined citations|Reference .+ undefined|Citation .+ undefined/i,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await event;
  const bytes = await readFile((await download.path()) ?? "");
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await download.saveAs(info.outputPath(`${name}.pdf`));
  const projectUrl = page.url();
  await page
    .getByRole("button", { name: "Analyze resume PDF", exact: true })
    .click();
  await expect(page.locator(".hash-label")).toContainText(sha256, {
    timeout: 20_000,
  });
  await page
    .getByText("Inspect all extracted text and page locations", { exact: true })
    .click();
  const text = (await page.locator(".extracted-text").innerText()).replace(
    /\s+/g,
    " ",
  );
  await page.goto(projectUrl);
  await expect(
    page.getByRole("textbox", { name: "Source editor: main.tex", exact: true }),
  ).toBeVisible();
  return { text, sha256 };
}
