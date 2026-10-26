import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { type AddressInfo, connect, createServer, type Socket } from "node:net";
import { requireTestDatabase } from "./test-database.js";

// Only Playwright's synthetic service. No failure controls enter the application.
if (
  process.env.NODE_ENV !== "test" ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
)
  throw new Error(
    "Recovery harness requires the explicitly separated test database",
  );
const actualUrl = requireTestDatabase({
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
});
const target = new URL(actualUrl);
const sockets = new Set<Socket>();
let blocked = false,
  child: ChildProcess | undefined;
const relay = createServer((incoming) => {
  if (blocked) {
    incoming.destroy();
    return;
  }
  const outgoing = connect(Number(target.port || 5432), target.hostname);
  for (const socket of [incoming, outgoing]) {
    sockets.add(socket);
    socket.on("error", () => {
      incoming.destroy();
      outgoing.destroy();
    });
    socket.on("close", () => {
      sockets.delete(socket);
      incoming.destroy();
      outgoing.destroy();
    });
  }
  incoming.pipe(outgoing).pipe(incoming);
});
relay.listen(0, "127.0.0.1");
await once(relay, "listening");
const proxied = new URL(actualUrl);
proxied.hostname = "127.0.0.1";
proxied.port = String((relay.address() as AddressInfo).port);
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, "exit");
  child.kill("SIGKILL");
  await done;
  child = undefined;
}
async function start() {
  if (child && child.exitCode === null && child.signalCode === null) return;
  child = spawn(process.execPath, ["--import", "tsx", "scripts/e2e-api.ts"], {
    env: { ...process.env, DATABASE_URL: proxied.toString() },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    windowsHide: true,
  });
  child.on("error", () => {});
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Test API failed to start");
    if (
      await fetch(`http://127.0.0.1:${process.env.PORT}/api/health`, {
        signal: AbortSignal.timeout(500),
      })
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test API startup timed out");
}
let actionRunning = false;
let nextMessage = 0;
async function providerControl(action: string) {
  const process = child;
  if (!process?.connected) throw new Error("Test API is unavailable");
  const id = ++nextMessage;
  await new Promise<void>((resolve, reject) => {
    const receive = (message: { id: number }) => {
      if (message.id === id) {
        clearTimeout(timer);
        process.off("message", receive);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      process.off("message", receive);
      reject(new Error("Provider control timed out"));
    }, 5000);
    process.on("message", receive);
    process.send({ id, action });
  });
}
const controls = httpServer(async (req, res) => {
  if (
    req.method !== "POST" ||
    req.headers.origin ||
    req.headers["x-recovery-control"] !== "synthetic-test-only"
  ) {
    res.writeHead(403).end();
    return;
  }
  if (actionRunning) {
    res.writeHead(409).end();
    return;
  }
  actionRunning = true;
  try {
    switch (req.url) {
      case "/provider/hold":
      case "/provider/wait":
      case "/provider/release":
        await providerControl(req.url.slice(1));
        break;
      case "/stop":
        await stop();
        break;
      case "/start":
        await start();
        break;
      case "/database/drop":
        blocked = true;
        for (const socket of sockets) socket.destroy();
        break;
      case "/database/restore":
        blocked = false;
        break;
      default:
        res.writeHead(404).end();
        return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ running: !!child, blocked }));
  } catch {
    res.writeHead(500).end();
  } finally {
    actionRunning = false;
  }
});
controls.listen(3102, "127.0.0.1");
await once(controls, "listening");
await start();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void (async () => {
      await stop();
      for (const socket of sockets) socket.destroy();
      controls.closeAllConnections();
      controls.close();
      relay.close();
    })().catch(() => {
      process.exitCode = 1;
    });
  });
