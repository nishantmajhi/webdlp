// zip.ts
//
// Minimal, dependency-free ZIP archive writer. The app is only granted
// `--allow-run=yt-dlp` (see deno.json / Dockerfile), so shelling out to a
// `zip` binary isn't an option, and pulling in a third-party archiving
// package would be the first external dependency in the project. Video
// files are already compressed, so there's nothing to gain from DEFLATE -
// this writes plain "store" (uncompressed) entries, which keeps the whole
// thing to a small, self-contained implementation of APPNOTE.TXT's local
// file header / central directory / EOCD records.
//
// Each entry is streamed straight from disk to the output file in fixed
// chunks (no full-file buffering), and the CRC-32 is computed on the fly
// as bytes pass through, so this scales fine to large video files.

import { join } from "node:path";

export interface ZipEntryInput {
  /** Absolute path of the source file on disk. */
  path: string;
  /** Name the file should have inside the archive. */
  name: string;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32Update(state: number, chunk: Uint8Array): number {
  let c = state;
  for (let i = 0; i < chunk.length; i++) {
    c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: day };
}

/** Little-endian byte-writing helper backed by a growable-on-write buffer. */
class ByteWriter {
  #chunks: Uint8Array[] = [];

  u16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n & 0xffff, true);
    this.#chunks.push(b);
  }
  u32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    this.#chunks.push(b);
  }
  bytes(b: Uint8Array) {
    this.#chunks.push(b);
  }
  toUint8Array(): Uint8Array {
    const total = this.#chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.#chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

async function writeAll(file: Deno.FsFile, data: Uint8Array): Promise<void> {
  let written = 0;
  while (written < data.length) {
    written += await file.write(data.subarray(written));
  }
}

/** De-duplicates in-archive file names so a zip never has two identical entries. */
function uniqueNames(entries: ZipEntryInput[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const count = seen.get(entry.name) ?? 0;
    seen.set(entry.name, count + 1);
    if (count === 0) return entry.name;
    const dot = entry.name.lastIndexOf(".");
    return dot > 0
      ? `${entry.name.slice(0, dot)} (${count})${entry.name.slice(dot)}`
      : `${entry.name} (${count})`;
  });
}

/**
 * Streams `entries` into a single ZIP archive at `outputPath`, using the
 * store (no compression) method. Writes to a `.part` file first and renames
 * it into place at the end, so a reader can never observe a half-written
 * archive at `outputPath`.
 */
export async function createZip(
  entries: ZipEntryInput[],
  outputPath: string,
): Promise<void> {
  const partPath = `${outputPath}.part`;
  const out = await Deno.open(partPath, {
    write: true,
    create: true,
    truncate: true,
  });

  const names = uniqueNames(entries);
  const { time, date } = dosDateTime(new Date());

  type CentralRecord = {
    name: string;
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    localHeaderOffset: number;
  };
  const central: CentralRecord[] = [];
  let offset = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      const { path } = entries[i];
      const nameBytes = new TextEncoder().encode(names[i]);

      // General-purpose flag: bit 3 (data descriptor follows) + bit 11
      // (UTF-8 name) - lets us stream the file before knowing its final
      // CRC/size, and keeps non-ASCII titles intact.
      const flag = 0x0808;

      const localHeader = new ByteWriter();
      localHeader.u32(0x04034b50); // local file header signature
      localHeader.u16(20); // version needed to extract
      localHeader.u16(flag);
      localHeader.u16(0); // compression method: store
      localHeader.u16(time);
      localHeader.u16(date);
      localHeader.u32(0); // crc-32 (deferred to data descriptor)
      localHeader.u32(0); // compressed size (deferred)
      localHeader.u32(0); // uncompressed size (deferred)
      localHeader.u16(nameBytes.length);
      localHeader.u16(0); // extra field length
      localHeader.bytes(nameBytes);

      const localHeaderBytes = localHeader.toUint8Array();
      const localHeaderOffset = offset;
      await writeAll(out, localHeaderBytes);
      offset += localHeaderBytes.length;

      const src = await Deno.open(path, { read: true });
      let crc = 0xffffffff;
      let size = 0;
      try {
        const buf = new Uint8Array(64 * 1024);
        while (true) {
          const n = await src.read(buf);
          if (n === null) break;
          const chunk = buf.subarray(0, n);
          crc = crc32Update(crc, chunk);
          size += chunk.length;
          await writeAll(out, chunk);
          offset += chunk.length;
        }
      } finally {
        src.close();
      }
      crc = (crc ^ 0xffffffff) >>> 0;

      const descriptor = new ByteWriter();
      descriptor.u32(0x08074b50); // data descriptor signature (optional but recommended)
      descriptor.u32(crc);
      descriptor.u32(size);
      descriptor.u32(size);
      const descriptorBytes = descriptor.toUint8Array();
      await writeAll(out, descriptorBytes);
      offset += descriptorBytes.length;

      central.push({ name: names[i], nameBytes, crc, size, localHeaderOffset });
    }

    const centralDirStart = offset;
    for (const entry of central) {
      const rec = new ByteWriter();
      rec.u32(0x02014b50); // central file header signature
      rec.u16(20); // version made by
      rec.u16(20); // version needed to extract
      rec.u16(0x0808); // general purpose flag (matches local header)
      rec.u16(0); // compression method: store
      rec.u16(time);
      rec.u16(date);
      rec.u32(entry.crc);
      rec.u32(entry.size);
      rec.u32(entry.size);
      rec.u16(entry.nameBytes.length);
      rec.u16(0); // extra field length
      rec.u16(0); // file comment length
      rec.u16(0); // disk number start
      rec.u16(0); // internal file attributes
      rec.u32(0); // external file attributes
      rec.u32(entry.localHeaderOffset);
      rec.bytes(entry.nameBytes);
      const recBytes = rec.toUint8Array();
      await writeAll(out, recBytes);
      offset += recBytes.length;
    }
    const centralDirSize = offset - centralDirStart;

    const eocd = new ByteWriter();
    eocd.u32(0x06054b50); // end of central directory signature
    eocd.u16(0); // number of this disk
    eocd.u16(0); // disk where central directory starts
    eocd.u16(central.length); // number of central dir records on this disk
    eocd.u16(central.length); // total number of central dir records
    eocd.u32(centralDirSize);
    eocd.u32(centralDirStart);
    eocd.u16(0); // comment length
    await writeAll(out, eocd.toUint8Array());
  } finally {
    out.close();
  }

  await Deno.rename(partPath, outputPath);
}

/** Picks a friendly zip file name from the first entry's name, e.g. "My Playlist (1).mp4" -> "My Playlist.zip". */
export function suggestZipName(entries: ZipEntryInput[]): string {
  if (entries.length === 0) return "download.zip";
  const first = entries[0].name;
  const dot = first.lastIndexOf(".");
  const base = dot > 0 ? first.slice(0, dot) : first;
  return `${base} and ${entries.length - 1} more.zip`;
}

export function zipTempPath(appRoot: string, id: string): string {
  return join(appRoot, "downloads", "temp", `${id}.zip`);
}
