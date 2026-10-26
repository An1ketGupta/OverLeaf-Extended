import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// MIT. Upstream release asset digests, https://github.com/axllent/mailpit/releases/tag/v1.32.0
const version = "v1.32.0";
const archive =
  process.platform === "win32"
    ? "mailpit-windows-amd64.zip"
    : "mailpit-linux-amd64.tar.gz";
const digest =
  process.platform === "win32"
    ? "16915767a6c95dca569336e8f561f91cf355e9a33c57b91deedcc10a4bba7fd4"
    : "4b5993c978e8604c70d43927e2ad103b311bba3b1822fa0cf1d4ee4ec890a93c";
const directory = resolve(".cache/mailpit", version);
const executable = resolve(
  directory,
  process.platform === "win32" ? "mailpit.exe" : "mailpit",
);
if (process.arch !== "x64" || !["win32", "linux"].includes(process.platform))
  throw new Error(
    "Use the documented native Mailpit release or Docker on this platform.",
  );
if (!existsSync(executable)) {
  const response = await fetch(
    `https://github.com/axllent/mailpit/releases/download/${version}/${archive}`,
  );
  if (!response.ok) throw new Error("Mailpit release download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error("Mailpit archive integrity check failed");
  await mkdir(directory, { recursive: true });
  const destination = resolve(directory, archive);
  await writeFile(destination, bytes);
  execFileSync("tar", ["-xf", destination, "-C", directory]);
}
if (process.argv[2] === "prepare")
  console.log(`Mailpit ${version} prepared and hash-verified.`);
else {
  // Ignore ambient Mailpit settings so no forwarding, relay, credentials or external binds are inherited.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("MP_")),
  );
  const child = spawn(
    executable,
    [
      "--smtp",
      "127.0.0.1:1025",
      "--listen",
      "127.0.0.1:8025",
      "--disable-version-check",
      "--quiet",
    ],
    { env, stdio: "inherit", windowsHide: true },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => child.kill());
  child.on("exit", (code) => process.exit(code ?? 1));
  console.log(
    "Local account inbox: http://127.0.0.1:8025 (SMTP on loopback port 1025; no external delivery).",
  );
}
