import { deflateSync } from "node:zlib";

// Original one-pixel RGB fixture with real chunk lengths, zlib bytes and CRCs.
export function fixturePng() {
  const chunk = (name: string, data: Buffer) => {
    const tag = Buffer.from(name);
    const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length);
    tag.copy(output, 4);
    data.copy(output, 8);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([tag, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
