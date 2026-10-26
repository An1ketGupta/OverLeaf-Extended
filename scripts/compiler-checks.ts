import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  compilerManifestSchema,
  templateCatalog,
} from "@overleaf-pro/contracts";
import candidate from "./compiler/candidate.json" with { type: "json" };

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function verifyCompilerAssets() {
  const root = "apps/web/public/compiler";
  const manifest = compilerManifestSchema.parse(
    JSON.parse(await readFile(`${root}/manifest.json`, "utf8")),
  );
  for (const [group, expected] of [
    ["engine", manifest.engineSha256],
    ["runtime", manifest.runtimeSha256],
  ] as const) {
    const chunks: Buffer[] = [];
    for (const shard of manifest.shards[group]) {
      const bytes = await readFile(`${root}/${shard.path}`);
      assert.equal(bytes.length, shard.bytes, `Shard size: ${shard.path}`);
      assert.equal(hash(bytes), shard.sha256, `Shard hash: ${shard.path}`);
      chunks.push(bytes);
    }
    const combined = Buffer.concat(chunks);
    const bytes =
      group === "runtime"
        ? gunzipSync(combined, { maxOutputLength: manifest.runtimeBytes })
        : combined;
    if (group === "runtime") assert.equal(bytes.length, manifest.runtimeBytes);
    assert.equal(hash(bytes), expected, `${group} integrity`);
  }
  assert.equal(
    manifest.engineSha256,
    candidate.assets.find((asset) => asset.file === "busytex.wasm")?.sha256,
  );
  assert.equal(
    manifest.engineCodeSha256,
    candidate.assets.find((asset) => asset.file === "busytex.js")?.sha256,
  );
  for (const [file, expected] of [
    ["engine.js", manifest.engineCodeSha256],
    ["runtime.json", manifest.indexSha256],
  ]) {
    assert.equal(hash(await readFile(`${root}/${file}`)), expected, file);
  }
  assert.equal(
    hash(await readFile(`${root}/worker.js`)),
    hash(await readFile("scripts/compiler/worker.js")),
    "Prepared worker matches checked-in source",
  );
  const pins: Record<string, string> = JSON.parse(
    await readFile("templates/sha256.json", "utf8"),
  );
  const paths = [
    "LICENSE",
    ...templateCatalog.flatMap((entry) =>
      entry.files.map((file) => `${entry.id}/${file}`),
    ),
  ];
  assert.deepEqual(Object.keys(pins).sort(), [...paths].sort());
  for (const path of paths) {
    assert.equal(
      hash(await readFile(`templates/${path}`)),
      pins[path],
      `Template provenance: ${path}`,
    );
  }
  console.log(
    `Compiler integrity passed; ${templateCatalog.length} pinned templates.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await verifyCompilerAssets();
