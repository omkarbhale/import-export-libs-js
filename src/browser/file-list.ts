import { MemoryVfs } from "../host/memory-fs.js";
import { posix } from "../io/path.js";
import { defaultInclude, markStub } from "./mount-options.js";
import type { MountDecision, MountKind, MountOptions } from "./mount-options.js";

/**
 * The adapters for what a page's folder input and a drop give it: the `File`s of an `<input type="file" webkitdirectory>`
 * (`mountFileList`) and the items of a `drop` event (`mountDataTransfer`), which are mounted into the in-memory tree before a run
 * (HOST-254, HOST-255). The library draws no control; the caller owns the input and the drop target and hands over what they
 * yield. A single `.zip` that was chosen or dropped is handed to the zip reader of the options (HOST-254).
 *
 * The parameters are written against the small structural types below instead of the DOM's, which a Node build does not have;
 * the real `File`, `DataTransferItemList` and `FileSystemEntry` of a browser satisfy them.
 *
 * @spec HOST-254 HOST-255
 */

/** The part of a `File` the adapters read. */
export interface FileLike {
  readonly name: string;
  readonly size: number;
  /** The path of a file chosen through `webkitdirectory`, from the chosen folder's name (`Folder/sub/a.xml`); empty or absent otherwise. */
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The part of a `FileSystemDirectoryReader` the walk reads. */
export interface DirectoryReaderLike {
  readEntries(success: (entries: EntryLike[]) => void, failure: (error: unknown) => void): void;
}

/** The part of a `FileSystemEntry` (a `FileSystemFileEntry` or a `FileSystemDirectoryEntry`) the walk reads. */
export interface EntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  file?(success: (file: FileLike) => void, failure: (error: unknown) => void): void;
  createReader?(): DirectoryReaderLike;
}

/** The part of a `DataTransferItem` the adapters read. */
export interface DataTransferItemLike {
  readonly kind: string;
  webkitGetAsEntry?(): EntryLike | null;
  getAsFile(): FileLike | null;
}

/** The part of a `DataTransferItemList` the adapters read: a `length` and the items by index. */
export interface DataTransferItemsLike {
  readonly length: number;
  readonly [index: number]: DataTransferItemLike | undefined;
}

/** An entry of the source before it is put into the tree. */
interface Raw {
  /** Relative to the mount point, with `/`, no leading `/`. */
  path: string;
  kind: MountKind;
  file?: FileLike;
}

/**
 * Mounts the files of a folder input into the tree and returns it. Each file's path is its `webkitRelativePath`; a file with none
 * (a plain multi-file input) is put at the mount point under its own name. A single `.zip` goes to `options.unzip` instead
 * (HOST-254).
 *
 * A file list shows files only, so a folder with no file below it is not in it and is not in the tree (HOST-254).
 *
 * @example
 * input.addEventListener("change", async () => {
 *   const vfs = await mountFileList(input.files, { root: "auto" });
 * });
 */
export async function mountFileList(files: Iterable<FileLike> | null, options: MountOptions = {}): Promise<MemoryVfs> {
  const list = files === null ? [] : [...files];
  const [only] = list;
  if (only !== undefined && list.length === 1 && isZipName(only.name) && posixPath(only.webkitRelativePath ?? "").length <= 1) {
    return mountZip(only, options);
  }
  const raw: Raw[] = list.map((file) => {
    const relative = posixPath(file.webkitRelativePath ?? "");
    return { path: (relative.length > 0 ? relative : posixPath(file.name)).join("/"), kind: "file", file };
  });
  return commit(raw, options);
}

/**
 * Mounts the files and folders of a drop into the tree and returns it. It must be called in the `drop` handler, before any
 * `await`: a browser empties the item list when the handler returns, so the entries are taken synchronously here and walked after
 * (HOST-255).
 *
 * A folder is walked through `webkitGetAsEntry()`, which all three engines have and which sees empty folders; a browser that has
 * none gives `getAsFile()`, the plain files. A single `.zip` goes to `options.unzip` (HOST-254).
 *
 * @example
 * target.addEventListener("drop", async (event) => {
 *   event.preventDefault();
 *   const vfs = await mountDataTransfer(event.dataTransfer.items, { root: "auto" });
 * });
 */
export function mountDataTransfer(items: DataTransferItemsLike, options: MountOptions = {}): Promise<MemoryVfs> {
  const taken: Array<{ entry: EntryLike | null; file: FileLike | null }> = [];
  try {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item === undefined || item.kind !== "file") continue;
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      taken.push({ entry, file: item.getAsFile() });
    }
  } catch (error) {
    return Promise.reject(error);
  }
  return fromTaken(taken, options);
}

async function fromTaken(taken: Array<{ entry: EntryLike | null; file: FileLike | null }>, options: MountOptions): Promise<MemoryVfs> {
  const [only] = taken;
  const single = only !== undefined && taken.length === 1 ? await singleFile(only.entry, only.file) : undefined;
  if (single !== undefined && isZipName(single.name)) return mountZip(single, options);
  const raw: Raw[] = [];
  for (const { entry, file } of taken) {
    if (entry !== null) await walk(entry, "", raw, options.signal);
    else if (file !== null) raw.push({ path: posixPath(file.name).join("/"), kind: "file", file });
  }
  return commit(raw, options);
}

/** The file a dropped item is, when it is a file and not a folder; `undefined` for a folder. */
async function singleFile(entry: EntryLike | null, file: FileLike | null): Promise<FileLike | undefined> {
  if (entry === null) return file ?? undefined;
  return entry.isFile ? await entryFile(entry) : undefined;
}

function entryFile(entry: EntryLike): Promise<FileLike> {
  const read = entry.file;
  if (read === undefined) return Promise.reject(new TypeError(`the entry ${entry.name} is a file and has no file()`));
  return new Promise<FileLike>((resolve, reject) => read.call(entry, resolve, reject));
}

function readBatch(reader: DirectoryReaderLike): Promise<EntryLike[]> {
  return new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
}

/**
 * Walks an entry: a file is read to its `File`; a folder is listed by its reader until the reader answers an empty batch. One
 * `readEntries` call gives at most a batch (Chromium: 100) and a folder with more entries needs more calls, so a single call
 * would lose the rest of a large folder silently (HOST-255).
 */
async function walk(entry: EntryLike, parent: string, out: Raw[], signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted();
  const path = parent === "" ? entry.name : `${parent}/${entry.name}`;
  checkSegments(posixPath(entry.name), path);
  if (entry.isFile) {
    out.push({ path, kind: "file", file: await entryFile(entry) });
    return;
  }
  if (!entry.isDirectory) return;
  out.push({ path, kind: "directory" });
  const reader = entry.createReader?.();
  if (reader === undefined) throw new TypeError(`the entry ${path} is a folder and has no createReader()`);
  for (;;) {
    const batch = await readBatch(reader);
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, path, out, signal);
  }
}

// -------------------------------------------------------------------------------------------------------------- the tree

function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}

/** `PK\x03\x04` (a local file header) or `PK\x05\x06` (the end record of an empty archive). */
function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Hands a chosen or dropped `.zip` to the zip reader of the options (HOST-254). */
async function mountZip(file: FileLike, options: MountOptions): Promise<MemoryVfs> {
  options.signal?.throwIfAborted();
  if (options.maxBytes !== undefined && file.size > options.maxBytes) {
    throw failure("ENOSPC", `${file.name} is ${file.size} bytes, more than the limit of ${options.maxBytes} bytes`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasZipMagic(bytes)) throw failure("ERR_MOUNT_NOT_ZIP", `${file.name} has the name of a zip archive and is not one`);
  const { unzip } = options;
  if (unzip === undefined) {
    throw failure("ERR_MOUNT_NO_UNZIP", `${file.name} is a zip archive: pass the zip reader (vfsFromZip) as the unzip option to mount it`);
  }
  const zipOptions: { root?: "auto" | "keep"; maxBytes?: number } = {};
  if (options.root !== undefined) zipOptions.root = options.root;
  if (options.maxBytes !== undefined) zipOptions.maxBytes = options.maxBytes;
  const unzipped = unzip(bytes, zipOptions);
  const at = mountPoint(options.at);
  if (options.into === undefined && at === "/") return unzipped;
  const target = options.into ?? new MemoryVfs();
  for (const [path, content] of unzipped.snapshot()) {
    options.signal?.throwIfAborted();
    target.mount({ [posix.join(at, path)]: content });
  }
  return target;
}

/** The segments of a path as a source gives it: `.` and empty ones dropped, `..` refused (it would leave the mount point). */
function posixPath(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  checkSegments(segments, path);
  return segments;
}

function checkSegments(segments: string[], path: string): void {
  if (segments.includes("..")) throw failure("ERR_MOUNT_UNSAFE_PATH", `the path ${path} leaves the folder it is mounted in`);
}

function mountPoint(at: string | undefined): string {
  if (at === undefined) return "/";
  if (!posix.isAbsolute(at)) throw new TypeError(`the mount point must be an absolute path: ${at}`);
  return posix.resolveFrom("/", at);
}

/**
 * Removes the first segment of every path when they all start with the same folder (HOST-254). The folder's own entry goes with
 * it. Nothing is removed when a file is at the top (it has no folder to remove) or the first segments differ.
 */
function stripRoot(raw: Raw[]): Raw[] {
  const [head] = raw;
  if (head === undefined) return raw;
  const first = head.path.split("/")[0] ?? "";
  const shared = raw.every((entry) => entry.path === first ? entry.kind === "directory" : entry.path.startsWith(`${first}/`));
  if (!shared) return raw;
  return raw.filter((entry) => entry.path !== first).map((entry) => ({ ...entry, path: entry.path.slice(first.length + 1) }));
}

/** Decides every entry, refuses a source over `maxBytes` before reading, then reads the files and puts them into the tree. */
async function commit(entries: Raw[], options: MountOptions): Promise<MemoryVfs> {
  const raw = options.root === "auto" ? stripRoot(entries) : entries;
  const include = options.include ?? defaultInclude;
  const at = mountPoint(options.at);

  const skipped = new Set<string>();
  const decided: Array<{ entry: Raw; decision: MountDecision }> = [];
  // folders first: a skipped folder leaves out everything below it
  for (const entry of [...raw].sort((a, b) => a.path.length - b.path.length)) {
    const parents = entry.path.split("/").slice(0, -1);
    if (parents.some((_, index) => skipped.has(parents.slice(0, index + 1).join("/")))) {
      if (entry.kind === "directory") skipped.add(entry.path);
      continue;
    }
    const decision = include(entry.path, entry.kind, entry.file?.size ?? 0);
    if (decision === "skip" && entry.kind === "directory") skipped.add(entry.path);
    else if (decision !== "skip") decided.push({ entry, decision });
  }
  // keep the source's order for the files
  const order = new Map(raw.map((entry, index) => [entry, index]));
  decided.sort((a, b) => (order.get(a.entry) ?? 0) - (order.get(b.entry) ?? 0));

  if (options.maxBytes !== undefined) {
    let total = 0;
    for (const { entry, decision } of decided) if (decision === "content") total += entry.file?.size ?? 0;
    if (total > options.maxBytes) {
      throw failure("ENOSPC", `the package has ${total} bytes of content to read, more than the limit of ${options.maxBytes} bytes`);
    }
  }

  const vfs = options.into ?? new MemoryVfs();
  let files = 0;
  let bytes = 0;
  for (const { entry, decision } of decided) {
    options.signal?.throwIfAborted();
    const path = posix.join(at, entry.path);
    if (entry.kind === "directory") {
      vfs.mount({ [`${path}/`]: "" });
      continue;
    }
    const content = decision === "stub" || entry.file === undefined ? new Uint8Array(0) : new Uint8Array(await entry.file.arrayBuffer());
    vfs.mount({ [path]: content });
    if (decision === "stub") markStub(vfs, path);
    files += 1;
    bytes += content.length;
    options.onProgress?.({ path, files, bytes });
  }
  return vfs;
}
