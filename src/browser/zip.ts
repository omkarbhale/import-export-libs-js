import { deflateSync, inflateSync } from "fflate";
import { MemoryVfs } from "../host/memory-fs.js";
import type { HostFs } from "../host/types.js";
import { compareNtfsNames } from "../import/ntfs-order.js";
import { posix } from "../io/path.js";

/**
 * The zip adapter of the browser (HOST-250, HOST-251): a package or an export as a `.zip`, mounted into a {@link MemoryVfs} before
 * a run and written out of one after it. The reading is a central-directory reader of its own over `fflate`'s inflate, and the
 * writing a zip writer of its own over `fflate`'s deflate, and not `unzipSync` and `zipSync`, which cannot do what the rules ask:
 * `unzipSync` decodes a name without the UTF-8 flag as Latin-1 (the rule is code page 437), shows no flag to its filter, inflates
 * entry by entry before the total size is known (the guard against a zip bomb must refuse first), and keys its result by name; and
 * `zipSync` reorders names that are whole numbers, dates entries in the machine's time zone, and wraps the entry count at 65 535.
 *
 * Both calls are synchronous, as the tree is. Peak memory of {@link vfsFromZip}: the input, the tree, and one inflated entry. Of
 * {@link vfsToZip}: the tree, the compressed entries, and the zip it returns.
 *
 * It imports no Node module and uses neither `Buffer` nor `process`, so it is clean for the browser typecheck ratchet.
 *
 * @spec HOST-250 HOST-251
 */

/** Why a zip was refused or could not be made (HOST-250). */
export type ZipErrorCode = "ZIP_INVALID" | "ZIP_UNSUPPORTED" | "ZIP_PATH_ESCAPES_ROOT" | "ZIP_CONFLICT" | "ZIP_TOO_LARGE";

/** The error of this adapter: a message that names the entry or the field, and a `code` to test for. */
export class ZipError extends Error {
  readonly code: ZipErrorCode;

  constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

/** What {@link vfsFromZip} takes. Every member is optional. */
export interface VfsFromZipOptions {
  /**
   * Which part of the zip becomes the root: `"auto"` takes off the one top-level folder a zip of a folder has (and keeps the paths of
   * a zip that has none); any other value is a folder of the zip, and only what is below it is mounted. Default: the paths as they are.
   */
  root?: string;
  /** The folder of the tree the paths are mounted under, made if missing. Default `/`. */
  at?: string;
  /** The tree to mount into. Default: a new one. */
  into?: MemoryVfs;
  /** The most bytes the kept entries may inflate to, by the central directory; a zip over it is refused before anything is inflated. */
  maxBytes?: number;
}

/** What {@link vfsToZip} takes. Every member is optional. */
export interface VfsToZipOptions {
  /** `6` (default) deflates a file, and stores it when that is not smaller; `0` stores every file. */
  level?: 0 | 6;
  /** The modification time of every entry, read in UTC; default the DOS epoch, 1980-01-01 00:00:00. */
  mtime?: Date;
}

// ---------------------------------------------------------------------------------------------------------- shared pieces

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
/** The most one deflate stream can expand: a 258-byte match costs two bits. */
const MAX_DEFLATE_RATIO = 1032;

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE) of the bytes, as a zip stores it. */
function crc32(bytes: Uint8Array): number {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Code page 437 for the bytes 0x80 to 0xFF (below that it is ASCII). */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeCp437(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80]!;
  return text;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const lenientUtf8 = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

function isAscii(bytes: Uint8Array): boolean {
  for (const byte of bytes) if (byte >= 0x80) return false;
  return true;
}

// ------------------------------------------------------------------------------------------------------------------ reading

interface RawEntry {
  /** The name as the central directory holds it, as bytes. */
  nameBytes: Uint8Array;
  extra: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** A 64-bit little-endian field as a number, refused past 2^53. */
function uint64(view: DataView, at: number, what: string): number {
  const low = view.getUint32(at, true);
  const high = view.getUint32(at + 4, true);
  if (high > 0x1fffff) throw new ZipError("ZIP_UNSUPPORTED", `${what} is past 2^53`);
  return high * 0x100000000 + low;
}

/** Finds the end-of-central-directory record from the end of the file; a comment of any length may follow it. */
function findEndRecord(view: DataView): number {
  const last = view.byteLength - 22;
  let fallback = -1;
  for (let at = last; at >= 0 && at >= last - MAX16; at -= 1) {
    if (view.getUint32(at, true) !== END_SIGNATURE) continue;
    // the comment length must reach the end of the file; a signature inside the comment does not
    if (at + 22 + view.getUint16(at + 20, true) === view.byteLength) return at;
    if (fallback < 0) fallback = at;
  }
  if (fallback < 0) throw new ZipError("ZIP_INVALID", "not a zip file: no end-of-central-directory record");
  return fallback;
}

/** The entries of the central directory, in its order (HOST-250). */
function readCentralDirectory(bytes: Uint8Array): RawEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 22) throw new ZipError("ZIP_INVALID", "not a zip file: too short");
  const end = findEndRecord(view);
  let diskNumber = view.getUint16(end + 4, true);
  let directoryDisk = view.getUint16(end + 6, true);
  let count = view.getUint16(end + 10, true);
  let directorySize = view.getUint32(end + 12, true);
  let directoryOffset = view.getUint32(end + 16, true);
  const needs64 = count === MAX16 || directorySize === MAX32 || directoryOffset === MAX32;
  if (needs64 && end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR_SIGNATURE) {
    const at = uint64(view, end - 12, "the offset of the ZIP64 end record");
    if (at + 56 > view.byteLength || view.getUint32(at, true) !== ZIP64_END_SIGNATURE) {
      throw new ZipError("ZIP_INVALID", "the ZIP64 end-of-central-directory record is not where the locator says");
    }
    diskNumber = view.getUint32(at + 16, true);
    directoryDisk = view.getUint32(at + 20, true);
    count = uint64(view, at + 32, "the entry count");
    directorySize = uint64(view, at + 40, "the size of the central directory");
    directoryOffset = uint64(view, at + 48, "the offset of the central directory");
  }
  if (diskNumber !== 0 || directoryDisk !== 0) throw new ZipError("ZIP_UNSUPPORTED", "a zip spread over several disks is not supported");
  if (directoryOffset + directorySize > view.byteLength) throw new ZipError("ZIP_INVALID", "the central directory runs past the end of the file");
  // an entry takes 46 bytes at least, so a count that cannot fit is a lie that would make the loop below spin
  if (count * 46 > directorySize) throw new ZipError("ZIP_INVALID", "the entry count is more than the central directory can hold");

  const entries: RawEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError("ZIP_INVALID", `entry ${index + 1}: the central directory record is damaged`);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > view.byteLength) throw new ZipError("ZIP_INVALID", `entry ${index + 1}: the record runs past the end of the file`);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    let size = view.getUint32(at + 24, true);
    let compressedSize = view.getUint32(at + 20, true);
    let localOffset = view.getUint32(at + 42, true);
    if (size === MAX32 || compressedSize === MAX32 || localOffset === MAX32) {
      // the ZIP64 field (id 1) holds, in this order, the ones of the three that are 0xFFFFFFFF
      const field = findExtra(extra, 0x0001);
      if (field === undefined) throw new ZipError("ZIP_INVALID", `entry ${index + 1}: a size or offset says ZIP64 and the record has no ZIP64 field`);
      const fieldView = new DataView(field.buffer, field.byteOffset, field.byteLength);
      let position = 0;
      const take = (what: string): number => {
        if (position + 8 > field.length) throw new ZipError("ZIP_INVALID", `entry ${index + 1}: the ZIP64 field is too short`);
        const value = uint64(fieldView, position, what);
        position += 8;
        return value;
      };
      if (size === MAX32) size = take("the size of an entry");
      if (compressedSize === MAX32) compressedSize = take("the stored size of an entry");
      if (localOffset === MAX32) localOffset = take("the offset of an entry");
    }
    entries.push({
      nameBytes,
      extra,
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressedSize,
      size,
      localOffset,
    });
    at = next;
  }
  return entries;
}

/** The data of the extra field with the given id, or undefined. */
function findExtra(extra: Uint8Array, id: number): Uint8Array | undefined {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let at = 0; at + 4 <= extra.length; ) {
    const length = view.getUint16(at + 2, true);
    if (at + 4 + length > extra.length) return undefined;
    if (view.getUint16(at, true) === id) return extra.subarray(at + 4, at + 4 + length);
    at += 4 + length;
  }
  return undefined;
}

/** The name of an entry as text (HOST-250): the UTF-8 flag, else the Unicode Path field, else UTF-8 if valid, else code page 437. */
function decodeName(entry: RawEntry): string {
  if (entry.flags & UTF8_FLAG) return lenientUtf8.decode(entry.nameBytes);
  if (isAscii(entry.nameBytes)) return decodeCp437(entry.nameBytes);
  const unicodePath = findExtra(entry.extra, 0x7075);
  if (unicodePath !== undefined && unicodePath.length > 5 && unicodePath[0] === 1) {
    const stored = new DataView(unicodePath.buffer, unicodePath.byteOffset, unicodePath.byteLength).getUint32(1, true);
    if (stored === crc32(entry.nameBytes)) return lenientUtf8.decode(unicodePath.subarray(5));
  }
  try {
    return strictUtf8.decode(entry.nameBytes);
  } catch {
    return decodeCp437(entry.nameBytes);
  }
}

interface PlannedEntry {
  raw: RawEntry;
  /** The segments of the normalised path. */
  segments: string[];
  directory: boolean;
}

/** The segments of an entry name after the rules of HOST-250; `escapes` when a `..` would leave the root. */
function normaliseName(name: string): { segments: string[]; directory: boolean; escapes: boolean } {
  const slashed = name.replaceAll("\\", "/");
  const directory = slashed.endsWith("/");
  const segments: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return { segments, directory, escapes: true };
    } else segments.push(segment);
  }
  return { segments, directory, escapes: false };
}

/** Whether an entry is junk that a zip tool adds and the import would read as a package file (HOST-250). */
function isJunk(segments: readonly string[]): boolean {
  if (segments.some((segment) => segment === "__MACOSX" || segment.startsWith("._"))) return true;
  const last = segments[segments.length - 1];
  return last === ".DS_Store" || last === "Thumbs.db";
}

/**
 * Mounts the files and folders of a zip into a tree (HOST-250). Everything is checked before the first byte is inflated; see the
 * rule for what is refused and with which {@link ZipError} code.
 *
 * Peak memory: the input, the tree, and one inflated entry. With `into`, a damaged entry stops the call with the entries before it
 * already in the tree.
 *
 * @spec HOST-250
 */
export function vfsFromZip(bytes: Uint8Array, options: VfsFromZipOptions = {}): MemoryVfs {
  const entries = readCentralDirectory(bytes);

  // names first, and the refusal of a path that leaves the root, for every entry
  const planned: PlannedEntry[] = [];
  for (const raw of entries) {
    const name = decodeName(raw);
    const { segments, directory, escapes } = normaliseName(name);
    if (escapes) throw new ZipError("ZIP_PATH_ESCAPES_ROOT", `the entry ${JSON.stringify(name)} leaves the root of the zip`);
    if (segments.length === 0 || isJunk(segments)) continue;
    planned.push({ raw, segments, directory });
  }

  const kept = applyRoot(planned, options.root);

  // a path that is a file in one entry and a folder in another
  const kinds = new Map<string, "file" | "folder">();
  for (const entry of kept) {
    for (let depth = 1; depth <= entry.segments.length; depth += 1) {
      const path = entry.segments.slice(0, depth).join("/");
      const kind = depth < entry.segments.length || entry.directory ? "folder" : "file";
      const known = kinds.get(path);
      if (known !== undefined && known !== kind) throw new ZipError("ZIP_CONFLICT", `the path ${JSON.stringify(path)} is a file and a folder in this zip`);
      kinds.set(path, kind);
    }
  }

  // what every file will cost, and what it may claim, before anything is inflated
  let total = 0;
  for (const { raw, directory, segments } of kept) {
    if (directory) continue;
    const label = JSON.stringify(segments.join("/"));
    if (raw.flags & ENCRYPTED_FLAG) throw new ZipError("ZIP_UNSUPPORTED", `the entry ${label} is encrypted`);
    if (raw.method !== 0 && raw.method !== 8) throw new ZipError("ZIP_UNSUPPORTED", `the entry ${label} uses compression method ${raw.method}, which is not supported`);
    if (raw.method === 0 ? raw.size !== raw.compressedSize : raw.size > (raw.compressedSize + 1) * MAX_DEFLATE_RATIO) {
      throw new ZipError("ZIP_INVALID", `the entry ${label} claims a size of ${raw.size} bytes, which its ${raw.compressedSize} stored bytes cannot hold`);
    }
    total += raw.size;
  }
  if (options.maxBytes !== undefined && total > options.maxBytes) {
    throw new ZipError("ZIP_TOO_LARGE", `the zip holds ${total} bytes, over the limit of ${options.maxBytes}`);
  }

  const vfs = options.into ?? new MemoryVfs();
  const at = options.at ?? "/";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (at !== "/") vfs.mount({ [`${at}/`]: new Uint8Array(0) });
  for (const { raw, segments, directory } of kept) {
    const path = posix.join(at, ...segments);
    if (directory) {
      vfs.mount({ [`${path}/`]: new Uint8Array(0) });
      continue;
    }
    vfs.mount({ [path]: extract(bytes, view, raw, segments.join("/")) });
  }
  return vfs;
}

/** Applies `root` to the entries that are kept (HOST-250). */
function applyRoot(planned: PlannedEntry[], root: string | undefined): PlannedEntry[] {
  if (root === undefined) return planned;
  if (root === "auto") {
    const first = planned[0]?.segments[0];
    if (first === undefined) return planned;
    const sameFirst = planned.every((entry) => entry.segments[0] === first);
    const anyBelow = planned.some((entry) => entry.segments.length > 1);
    if (!sameFirst || !anyBelow) return planned;
    return planned.filter((entry) => entry.segments.length > 1).map((entry) => ({ ...entry, segments: entry.segments.slice(1) }));
  }
  const prefix = normaliseName(root).segments;
  const below = planned
    .filter((entry) => entry.segments.length > prefix.length && prefix.every((segment, index) => entry.segments[index] === segment))
    .map((entry) => ({ ...entry, segments: entry.segments.slice(prefix.length) }));
  if (below.length === 0) throw new ZipError("ZIP_INVALID", `the zip has no entry below ${JSON.stringify(root)}`);
  return below;
}

/** Reads and inflates one file entry, and checks it against what the central directory says. */
function extract(bytes: Uint8Array, view: DataView, entry: RawEntry, label: string): Uint8Array {
  const { localOffset, compressedSize, size } = entry;
  if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
    throw new ZipError("ZIP_INVALID", `the entry ${JSON.stringify(label)} has no local header where the central directory says`);
  }
  const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
  if (start + compressedSize > bytes.length) throw new ZipError("ZIP_INVALID", `the data of the entry ${JSON.stringify(label)} runs past the end of the file`);
  const stored = bytes.subarray(start, start + compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) data = stored;
  else {
    try {
      data = inflateSync(stored, { out: new Uint8Array(size) });
    } catch (error) {
      throw new ZipError("ZIP_INVALID", `the data of the entry ${JSON.stringify(label)} is damaged: ${(error as Error).message}`);
    }
  }
  if (data.length !== size) throw new ZipError("ZIP_INVALID", `the entry ${JSON.stringify(label)} inflates to ${data.length} bytes, not the ${size} it declares`);
  if (crc32(data) !== entry.crc) throw new ZipError("ZIP_INVALID", `the entry ${JSON.stringify(label)} does not match its CRC-32`);
  return data;
}

// ------------------------------------------------------------------------------------------------------------------ writing

interface WrittenEntry {
  nameBytes: Uint8Array;
  flags: number;
  method: 0 | 8;
  crc: number;
  size: number;
  /** The bytes as stored (compressed or not). */
  data: Uint8Array;
  directory: boolean;
  offset: number;
}

/** The DOS time and date of a `Date`, read in UTC; a zip stores no zone. */
function dosTimestamp(mtime: Date): { time: number; date: number } {
  const year = mtime.getUTCFullYear();
  if (!Number.isFinite(mtime.getTime()) || year < 1980 || year > 2107) {
    throw new RangeError("the modification time of a zip entry must be a date between 1980 and 2107");
  }
  return {
    time: (mtime.getUTCHours() << 11) | (mtime.getUTCMinutes() << 5) | (mtime.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((mtime.getUTCMonth() + 1) << 5) | mtime.getUTCDate(),
  };
}

/**
 * Writes the files and folders under `folder` as a zip (HOST-251). The same tree gives the same bytes: entries are in the engine's
 * NTFS directory order, every entry has the same time (`mtime`, default the DOS epoch), and nothing reads the clock or the zone.
 *
 * Peak memory: the tree, the compressed entries, and the zip returned.
 *
 * @spec HOST-251 IMP-004
 */
export function vfsToZip(vfs: HostFs, folder = "/", options: VfsToZipOptions = {}): Uint8Array {
  const level = options.level ?? 6;
  if (level !== 0 && level !== 6) throw new RangeError("level must be 0 or 6");
  const { time, date } = dosTimestamp(options.mtime ?? new Date(Date.UTC(1980, 0, 1, 0, 0, 0)));

  const written: WrittenEntry[] = [];
  let offset = 0;
  const add = (relative: string, directory: boolean, content?: Uint8Array): void => {
    const nameBytes = utf8Encoder.encode(directory ? `${relative}/` : relative);
    if (nameBytes.length > MAX16) throw new ZipError("ZIP_INVALID", `the name ${JSON.stringify(relative)} is longer than 65535 bytes`);
    let method: 0 | 8 = 0;
    let data = content ?? new Uint8Array(0);
    const size = data.length;
    const crc = crc32(data);
    if (level === 6 && size > 0) {
      const deflated = deflateSync(data, { level: 6 });
      if (deflated.length < size) {
        method = 8;
        data = deflated;
      }
    }
    if (size > MAX32 - 1 || data.length > MAX32 - 1) throw new ZipError("ZIP_TOO_LARGE", `the file ${JSON.stringify(relative)} is too large for this zip writer (4 GiB)`);
    written.push({ nameBytes, flags: isAscii(nameBytes) ? 0 : UTF8_FLAG, method, crc, size, data, directory, offset });
    offset += 30 + nameBytes.length + data.length;
    if (offset > MAX32 - 1) throw new ZipError("ZIP_TOO_LARGE", "the zip is too large for this zip writer (4 GiB)");
  };

  const visit = (path: string, relative: string): void => {
    const children = vfs.readdir(path).filter((entry) => !entry.isSymbolicLink && (entry.isFile || entry.isDirectory));
    children.sort((a, b) => compareNtfsNames(a.name, b.name));
    for (const child of children) {
      const childPath = posix.join(path, child.name);
      const childRelative = relative === "" ? child.name : `${relative}/${child.name}`;
      if (child.isDirectory) {
        add(childRelative, true);
        visit(childPath, childRelative);
      } else add(childRelative, false, vfs.readFile(childPath));
    }
  };
  visit(folder, "");

  const centralSize = written.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0);
  const zip64 = written.length >= MAX16;
  if (offset + centralSize > MAX32 - 1) throw new ZipError("ZIP_TOO_LARGE", "the zip is too large for this zip writer (4 GiB)");
  const out = new Uint8Array(offset + centralSize + (zip64 ? 56 + 20 : 0) + 22);
  const view = new DataView(out.buffer);

  let at = 0;
  for (const entry of written) {
    view.setUint32(at, LOCAL_SIGNATURE, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, entry.flags, true);
    view.setUint16(at + 8, entry.method, true);
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.size, true);
    view.setUint16(at + 26, entry.nameBytes.length, true);
    out.set(entry.nameBytes, at + 30);
    out.set(entry.data, at + 30 + entry.nameBytes.length);
    at += 30 + entry.nameBytes.length + entry.data.length;
  }
  const centralStart = at;
  for (const entry of written) {
    view.setUint32(at, CENTRAL_SIGNATURE, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, entry.flags, true);
    view.setUint16(at + 10, entry.method, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.size, true);
    view.setUint16(at + 28, entry.nameBytes.length, true);
    view.setUint32(at + 38, entry.directory ? 0x10 : 0, true);
    view.setUint32(at + 42, entry.offset, true);
    out.set(entry.nameBytes, at + 46);
    at += 46 + entry.nameBytes.length;
  }
  if (zip64) {
    const recordAt = at;
    view.setUint32(at, ZIP64_END_SIGNATURE, true);
    view.setUint32(at + 4, 44, true); // the size of the rest of the record, as a 64-bit number whose high half stays 0
    view.setUint16(at + 12, 45, true);
    view.setUint16(at + 14, 45, true);
    view.setUint32(at + 24, written.length, true);
    view.setUint32(at + 32, written.length, true);
    view.setUint32(at + 40, centralSize, true);
    view.setUint32(at + 48, centralStart, true);
    at += 56;
    view.setUint32(at, ZIP64_LOCATOR_SIGNATURE, true);
    view.setUint32(at + 8, recordAt, true);
    view.setUint32(at + 16, 1, true);
    at += 20;
  }
  view.setUint32(at, END_SIGNATURE, true);
  view.setUint16(at + 8, Math.min(written.length, MAX16), true);
  view.setUint16(at + 10, Math.min(written.length, MAX16), true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
