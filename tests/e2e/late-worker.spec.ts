import { randomUUID } from "node:crypto";
import { createDatabase } from "@overleaf-pro/db";
import { expect, test } from "@playwright/test";
import { requireTestDatabase } from "../../scripts/test-database.js";
import { verifyBrowserAccount } from "./account-helper.js";
import { compileAndInspect } from "./pdf-helper.js";

type Probe = {
  hold: boolean;
  held: number;
  terminated: number;
  release: () => void;
};
test("real compiler results delivered after cancel or newer edits cannot replace output; subsequent compilation works", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const email = `part7-worker-${randomUUID()}@example.test`;
  const origin = "http://127.0.0.1:5273";
  await page.addInitScript(() => {
    const pending: (() => void)[] = [];
    const probe: Probe = {
      hold: true,
      held: 0,
      terminated: 0,
      release: () => {
        probe.hold = false;
        for (const receive of pending.splice(0)) receive();
      },
    };
    (window as unknown as { workerProbe: Probe }).workerProbe = probe;
    const NativeWorker = Worker;
    globalThis.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (String(args[0]).endsWith("/compiler/worker.js")) {
          const terminate = worker.terminate.bind(worker);
          worker.terminate = () => {
            probe.terminated++;
            terminate();
          };
          Object.defineProperty(worker, "onmessage", {
            set(receive: (event: MessageEvent) => void) {
              worker.addEventListener("message", (event) => {
                if (probe.hold && event.data?.type === "succeeded") {
                  probe.held++;
                  pending.push(() => receive(event));
                } else receive(event);
              });
            },
          });
        }
        return worker;
      },
    });
  });
  const db = createDatabase(requireTestDatabase());
  try {
    expect(
      (
        await context.request.post("/api/auth/sign-up/email", {
          headers: { origin },
          data: {
            name: "Worker cleanup",
            email,
            password: "synthetic-worker-password-42",
          },
        })
      ).status(),
    ).toBe(200);
    await verifyBrowserAccount(
      context.request,
      email,
      "synthetic-worker-password-42",
      origin,
    );
    const project = await (
      await context.request.post("/api/projects", {
        headers: { origin },
        data: { name: "Worker cleanup", templateId: "resume-classic" },
      })
    ).json();
    await page.goto(`/projects/${project.id}`);
    const compile = page.getByRole("button", {
      name: "▷ Recompile",
      exact: true,
    });
    for (const action of ["cancel", "edit"]) {
      await page.evaluate(() => {
        const p = (window as unknown as { workerProbe: Probe }).workerProbe;
        p.hold = true;
        p.held = 0;
      });
      await compile.click();
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as unknown as { workerProbe: Probe }).workerProbe.held,
            ),
          { timeout: 60_000 },
        )
        .toBe(1);
      if (action === "cancel")
        await page
          .getByRole("button", { name: "Cancel compile", exact: true })
          .click();
      else {
        const editor = page.getByRole("textbox", {
          name: "Source editor: main.tex",
          exact: true,
        });
        await editor.press("Control+End");
        await editor.press("End");
        await editor.press("Enter");
        await editor.pressSequentially("% Newer revision");
      }
      await page.evaluate(() =>
        (window as unknown as { workerProbe: Probe }).workerProbe.release(),
      );
      await expect(
        page.getByRole("status", { name: "Compilation status" }),
      ).toHaveText("Compilation cancelled");
      await expect(
        page.getByRole("button", { name: "Download PDF", exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { workerProbe: Probe }).workerProbe
              .terminated,
        ),
      ).toBeGreaterThan(0);
    }
    expect(
      (await compileAndInspect(page, info, "after-late-worker")).text,
    ).toContain("Alex Example");
  } finally {
    await db.pool.query('DELETE FROM "user" WHERE email=$1', [email]);
    await db.close();
  }
});
