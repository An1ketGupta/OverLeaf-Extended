import {
  backupManifestSchema,
  importProjectSchema,
  limits,
  projectPathSchema,
} from "@overleaf-pro/contracts";

const invalid = () =>
  new Error(
    "Invalid or unsupported backup. Use an unchanged project ZIP exported by this app.",
  );
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = (crcTable[(value ^ byte) & 255] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// ZIP32 stored entries only. Validate bounds and both directory views before using
// bytes. No decompression, filesystem extraction, URLs or manifest code execution.
export function storedBackupEntries(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > limits.backupArchiveBytes)
    throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const end = bytes.length - 22;
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20))
    throw invalid();
  const count = u16(end + 10),
    central = u32(end + 16);
  if (
    count < 2 ||
    count > limits.projectFiles + 1 ||
    u16(end + 8) !== count ||
    central + u32(end + 12) !== end
  )
    throw invalid();
  const entries = new Map<string, Uint8Array>();
  let cursor = central,
    nextLocal = 0,
    total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw invalid();
    const flags = u16(cursor + 8),
      method = u16(cursor + 10),
      crc = u32(cursor + 16);
    const packed = u32(cursor + 20),
      size = u32(cursor + 24),
      nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30),
      commentLength = u16(cursor + 32),
      offset = u32(cursor + 42);
    const attributes = u32(cursor + 38),
      mode = (attributes >>> 16) & 0xf000;
    if (
      method !== 0 ||
      (flags & ~0x800) !== 0 ||
      packed !== size ||
      u16(cursor + 34) ||
      attributes & 0x10 ||
      (mode !== 0 && mode !== 0x8000) ||
      nameLength === 0 ||
      nameLength > 1024 ||
      cursor + 46 + nameLength + extraLength + commentLength > end ||
      offset !== nextLocal ||
      offset + 30 > central ||
      u32(offset) !== 0x04034b50
    )
      throw invalid();
    const name = decoder.decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (
      entries.has(name) ||
      (name !== "snapshot.json" &&
        (!name.startsWith("source/") ||
          !projectPathSchema.safeParse(name.slice(7)).success))
    )
      throw invalid();
    if (size > (name === "snapshot.json" ? 128 * 1024 : limits.assetBytes))
      throw invalid();
    const localNameLength = u16(offset + 26),
      localExtraLength = u16(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength;
    if (
      u16(offset + 6) !== flags ||
      u16(offset + 8) !== method ||
      u32(offset + 14) !== crc ||
      u32(offset + 18) !== size ||
      u32(offset + 22) !== size ||
      localNameLength !== nameLength ||
      dataStart + size > central ||
      decoder.decode(
        bytes.subarray(offset + 30, offset + 30 + localNameLength),
      ) !== name
    )
      throw invalid();
    const data = bytes.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) throw invalid();
    total += size;
    if (total > limits.projectBytes + 128 * 1024) throw invalid();
    entries.set(name, data);
    nextLocal = dataStart + size;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end || nextLocal !== central) throw invalid();
  return entries;
}
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export async function readSourceBackup(bytes: Uint8Array, name: string) {
  try {
    const entries = storedBackupEntries(bytes);
    const manifestBytes = entries.get("snapshot.json");
    if (!manifestBytes) throw invalid();
    const manifest = backupManifestSchema.parse(
      JSON.parse(decoder.decode(manifestBytes)),
    );
    const declared = [...manifest.files, ...manifest.assets];
    if (
      new Set(declared.map((file) => file.path)).size !== declared.length ||
      entries.size !== declared.length + 1 ||
      !manifest.mainFile.startsWith("source/")
    )
      throw invalid();
    const content = new Map<string, Uint8Array>();
    for (const file of declared) {
      const data = entries.get(file.path);
      if (
        !file.path.startsWith("source/") ||
        !data ||
        (await sha256(data)) !== file.sha256 ||
        ("bytes" in file && file.bytes !== data.length)
      )
        throw invalid();
      content.set(file.path, data);
    }
    return importProjectSchema.parse({
      name,
      mainFile: manifest.mainFile.slice(7),
      files: manifest.files.map((file) => ({
        path: file.path.slice(7),
        content: decoder.decode(content.get(file.path)),
      })),
      assets: manifest.assets.map((asset) => ({
        path: asset.path.slice(7),
        dataBase64: base64(content.get(asset.path) as Uint8Array),
      })),
    });
  } catch {
    throw invalid();
  }
}
