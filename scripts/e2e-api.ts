import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../apps/api/src/app.js";
import { createAssistantProvider } from "../apps/api/src/assistant-provider.js";
import { readConfig } from "../apps/api/src/config.js";

// Test harness only: the production server has no fixture-provider switch.
if (process.env.NODE_ENV !== "test")
  throw new Error("E2E harness requires NODE_ENV=test");
let holdProvider = false;
const heldResponses = new Set<() => void>();
const arrivalWaiters = new Set<() => void>();
process.on("message", (message: { id: number; action: string }) => {
  const done = () => process.send?.({ id: message.id });
  if (message.action === "provider/hold") {
    holdProvider = true;
    done();
  }
  if (message.action === "provider/release") {
    holdProvider = false;
    for (const release of heldResponses) release();
    heldResponses.clear();
    done();
  }
  if (message.action === "provider/wait") {
    if (heldResponses.size) done();
    else arrivalWaiters.add(done);
  }
});
const upstream = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/openai/v1/chat/completions") {
    res.statusCode = 501;
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const wire = JSON.parse(Buffer.concat(chunks).toString());
  const input = JSON.parse(wire.messages[1].content) as {
    mode: string;
    instruction: string;
    diagnostics: string;
    files: { id: string; content: string }[];
  };
  if (holdProvider)
    await new Promise<void>((resolve) => {
      heldResponses.add(resolve);
      for (const ready of arrivalWaiters) ready();
      arrivalWaiters.clear();
    });
  if (input.instruction.includes("simulate unavailable")) {
    res.statusCode = 429;
    res.end("{}");
    return;
  }
  const edits = ["rewrite", "generate"].includes(input.mode)
    ? input.files.map((f) => ({
        fileId: f.id,
        content:
          input.instruction === "synthetic visible edit"
            ? f.content.replace(
                "\\end{document}",
                "\\par\\noindent Reviewed visible change.\\par\n\\end{document}",
              )
            : input.instruction === "synthetic broken edit"
              ? f.content.replace(
                  "\\end{document}",
                  "\\UnknownAssistantCommand\n\\end{document}",
                )
              : `${f.content}\n% Reviewed synthetic change\n`,
      }))
    : [];
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              answer:
                input.mode === "diagnostic" &&
                input.diagnostics.includes("Undefined control sequence")
                  ? "Synthetic diagnostic: undefined command. Review the source or restore its backup."
                  : "Synthetic provider: review every change before applying.",
              refused: false,
              edits,
            }),
          },
        },
      ],
      usage: { prompt_tokens: 25, completion_tokens: 20 },
    }),
  );
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const config = readConfig();
const app = buildApp(config, {
  assistantProvider: createAssistantProvider({
    key: "synthetic-only",
    model: "synthetic-e2e",
    endpoint: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/openai/v1/chat/completions`,
  }),
});
app.addHook("onClose", async () => {
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});
await app.listen({ port: config.PORT, host: "127.0.0.1" });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
