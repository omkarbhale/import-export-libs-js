import { MemoryVfs } from "../host/memory-fs.js";
import { posix } from "../io/path.js";
import type { MountOptions } from "./mount-options.js";

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
  webkitGetAsEntry(): EntryLike | null;
}

/** The part of a `DataTransferItemList` the adapters read: a `length` and the items by index. */
export interface DataTransferItemsLike {
  readonly length: number;
  readonly [index: number]: DataTransferItemLike | undefined;
}

/** An entry of the source before it is put into the tree. */
interface Raw {
  /** Relative to the root of the tree, with `/`, no leading `/`. */
  path: string;
  /** Absent for a folder. */
  file?: FileLike;
}

/**
 * Mounts the files of a folder input into the tree and returns it. Each file's path is its `webkitRelativePath`; a file with none
 * (a plain multi-file input) is put at the root of the tree under its own name. A single `.zip` goes to `options.unzip` instead
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
    return { path: (relative.length > 0 ? relative : posixPath(file.name)).join("/"), file };
  });
  return commit(raw, options);
}

/**
 * Mounts the files and folders of a drop into the tree and returns it. It must be called in the `drop` handler, before any
 * `await`: a browser empties the item list when the handler returns, so the entries are taken synchronously here and walked after
 * (HOST-255).
 *
 * A folder is walked through `webkitGetAsEntry()`, which sees empty folders; an item with no entry is ignored. A single `.zip`
 * goes to `options.unzip` (HOST-254).
 *
 * @example
 * target.addEventListener("drop", async (event) => {
 *   event.preventDefault();
 *   const vfs = await mountDataTransfer(event.dataTransfer.items, { root: "auto" });
 * });
 */
export function mountDataTransfer(items: DataTransferItemsLike, options: MountOptions = {}): Promise<MemoryVfs> {
  const taken: EntryLike[] = [];
  try {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item === undefined || item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry();
      if (entry !== null) taken.push(entry);
    }
  } catch (error) {
    return Promise.reject(error);
  }
  return fromTaken(taken, options);
}

async function fromTaken(taken: EntryLike[], options: MountOptions): Promise<MemoryVfs> {
  const [only] = taken;
  if (only !== undefined && taken.length === 1 && only.isFile && isZipName(only.name)) return mountZip(await entryFile(only), options);
  const raw: Raw[] = [];
  for (const entry of taken) await walk(entry, "", raw, options.signal);
  return commit(raw, options);
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
    out.push({ path, file: await entryFile(entry) });
    return;
  }
  if (!entry.isDirectory) return;
  out.push({ path });
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
  options.signal?.throwIfAborted();
  if (!hasZipMagic(bytes)) throw failure("ERR_MOUNT_NOT_ZIP", `${file.name} has the name of a zip archive and is not one`);
  const { unzip } = options;
  if (unzip === undefined) {
    throw failure("ERR_MOUNT_NO_UNZIP", `${file.name} is a zip archive: pass the zip reader (vfsFromZip) as the unzip option to mount it`);
  }
  const zipOptions: { root?: "auto" | "keep"; maxBytes?: number } = {};
  if (options.root !== undefined) zipOptions.root = options.root;
  if (options.maxBytes !== undefined) zipOptions.maxBytes = options.maxBytes;
  const unzipped = unzip(bytes, zipOptions);
  if (options.onProgress !== undefined) {
    let files = 0;
    let total = 0;
    for (const path of filePaths(unzipped, "/").sort()) {
      options.signal?.throwIfAborted();
      files += 1;
      total += unzipped.readFile(path).length;
      options.onProgress({ path, files, bytes: total });
    }
  }
  return unzipped;
}

/** The absolute path of every file below a folder of the tree, in no order. */
function filePaths(vfs: MemoryVfs, folder: string): string[] {
  return vfs.readdir(folder).flatMap((entry) => {
    const path = posix.join(folder, entry.name);
    return entry.isDirectory ? filePaths(vfs, path) : [path];
  });
}

/** The segments of a path as a source gives it: `.` and empty ones dropped, `..` refused (it would leave the tree). */
function posixPath(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  checkSegments(segments, path);
  return segments;
}

function checkSegments(segments: string[], path: string): void {
  if (segments.includes("..")) throw failure("ERR_MOUNT_UNSAFE_PATH", `the path ${path} leaves the folder it is mounted in`);
}

/**
 * Removes the first segment of every path when they all start with the same folder (HOST-254). The folder's own entry goes with
 * it. Nothing is removed when a file is at the top (it has no folder to remove) or the first segments differ.
 */
function stripRoot(raw: Raw[]): Raw[] {
  const [head] = raw;
  if (head === undefined) return raw;
  const first = head.path.split("/")[0] ?? "";
  const shared = raw.every((entry) => entry.path === first ? entry.file === undefined : entry.path.startsWith(`${first}/`));
  if (!shared) return raw;
  return raw.filter((entry) => entry.path !== first).map((entry) => ({ ...entry, path: entry.path.slice(first.length + 1) }));
}

/** Refuses a source over `maxBytes` before reading, then reads the files and puts them into a new tree. */
async function commit(entries: Raw[], options: MountOptions): Promise<MemoryVfs> {
  const raw = options.root === "auto" ? stripRoot(entries) : entries;

  if (options.maxBytes !== undefined) {
    let total = 0;
    for (const entry of raw) total += entry.file?.size ?? 0;
    if (total > options.maxBytes) {
      throw failure("ENOSPC", `the package has ${total} bytes of content to read, more than the limit of ${options.maxBytes} bytes`);
    }
  }

  const vfs = new MemoryVfs();
  let files = 0;
  let bytes = 0;
  for (const entry of raw) {
    options.signal?.throwIfAborted();
    const path = posix.join("/", entry.path);
    if (entry.file === undefined) {
      vfs.mount({ [`${path}/`]: "" });
      continue;
    }
    const content = new Uint8Array(await entry.file.arrayBuffer());
    vfs.mount({ [path]: content });
    files += 1;
    bytes += content.length;
    options.onProgress?.({ path, files, bytes });
  }
  return vfs;
}
