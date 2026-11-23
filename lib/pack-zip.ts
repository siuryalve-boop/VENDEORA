import type { PackFile } from "./pack-catalog.ts";

const crcTable = Uint32Array.from({ length: 256 }, (_, entry) => {
  let crc = entry;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

export function createPackZip(files: PackFile[]) {
  const encoder = new TextEncoder();
  const entries = files.map(({ filename, content }) => {
    const name = encoder.encode(filename);
    const data = encoder.encode(
      filename.endsWith(".csv") ? "\uFEFF" + content : content,
    );
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
    return { name, data, crc: (crc ^ 0xffffffff) >>> 0, offset: 0 };
  });
  const dataSize = entries.reduce(
    (size, entry) => size + 30 + entry.name.length + entry.data.length,
    0,
  );
  const directorySize = entries.reduce(
    (size, entry) => size + 46 + entry.name.length,
    0,
  );
  const buffer = new ArrayBuffer(dataSize + directorySize + 22);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const u16 = (offset: number, value: number) =>
    view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) =>
    view.setUint32(offset, value, true);
  let cursor = 0;
  for (const entry of entries) {
    entry.offset = cursor;
    u32(cursor, 0x04034b50);
    u16(cursor + 4, 20);
    u16(cursor + 6, 0x0800);
    u16(cursor + 12, 0x0021);
    u32(cursor + 14, entry.crc);
    u32(cursor + 18, entry.data.length);
    u32(cursor + 22, entry.data.length);
    u16(cursor + 26, entry.name.length);
    bytes.set(entry.name, cursor + 30);
    bytes.set(entry.data, cursor + 30 + entry.name.length);
    cursor += 30 + entry.name.length + entry.data.length;
  }
  for (const entry of entries) {
    u32(cursor, 0x02014b50);
    u16(cursor + 4, 20);
    u16(cursor + 6, 20);
    u16(cursor + 8, 0x0800);
    u16(cursor + 14, 0x0021);
    u32(cursor + 16, entry.crc);
    u32(cursor + 20, entry.data.length);
    u32(cursor + 24, entry.data.length);
    u16(cursor + 28, entry.name.length);
    u32(cursor + 42, entry.offset);
    bytes.set(entry.name, cursor + 46);
    cursor += 46 + entry.name.length;
  }
  u32(cursor, 0x06054b50);
  u16(cursor + 8, entries.length);
  u16(cursor + 10, entries.length);
  u32(cursor + 12, directorySize);
  u32(cursor + 16, dataSize);
  return buffer;
}
