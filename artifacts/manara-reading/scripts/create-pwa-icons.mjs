import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};
function chunk(name, bytes) {
  const kind = Buffer.from(name);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([kind, bytes])));
  return Buffer.concat([size, kind, bytes, crc]);
}
const polygon = [[150,360],[150,145],[180,145],[256,260],[332,145],[362,145],[362,360],[328,360],[328,212],[256,319],[184,212],[184,360]];
function inside(x, y) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}
for (const [file, size] of [["pwa-512.png",512],["pwa-192.png",192],["apple-touch-icon.png",180]]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x + .5) * 512 / size, sy = (y + .5) * 512 / size;
      const distance = Math.hypot(sx - 256, sy - 256);
      const ink = inside(sx, sy) || Math.abs(distance - 202) < 2;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw.set(ink ? [150,60,73,255] : [244,240,231,255], offset);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
  await writeFile(path.join(root,"public",file),Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0)),
  ]));
}
