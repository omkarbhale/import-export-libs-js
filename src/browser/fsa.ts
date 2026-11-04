import { MemoryVfs } from "../host/memory-fs.js";
import { posix } from "../io/path.js";
import { defaultInclude, stubsOf, type MountInclude } from "./mount-options.js";

/**
 * The File System Access adapter: a folder the user (or a page) holds a `FileSystemDirectoryHandle` for, brought into the in-memory
 * tree before a run and written back from it after (map D1). `mountDirectory` walks the handle and copies it into a
 * {@link MemoryVfs}; `commitToDirectory` writes a tree of the `MemoryVfs` into a handle. It reaches the browser only through the
 * handle's own methods, so the same code runs on the origin private file system (`navigator.storage.getDirectory()`, in every
 * browser) and on a folder picked with `showDirectoryPicker()` (Chromium), and, in the Node tests, on a handle written in memory.
 *
 * The handle types are declared here, as the part of the DOM interfaces the adapter uses: the Node project has no DOM library, and a
 * real `FileSystemDirectoryHandle` is assignable to {@link FsaDirectoryHandle} (`fsa-dom.check.ts` proves it for the browser project).
 *
 * @spec HOST-252 HOST-253
 */

/** The part of `FileSystemHandle` the adapter reads. */
export interface FsaHandle {
  readonly kind: "file" | "directory";
  readonly name: string;
}

/** The part of `File` the adapter reads. */
export interface FsaFile {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The part of `FileSystemWritableFileStream` the adapter uses. */
export interface FsaWritable {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

/** The part of `FileSystemFileHandle` the adapter uses. */
export interface FsaFileHandle extends FsaHandle {
  readonly kind: "file";
  getFile(): Promise<FsaFile>;
  createWritable(): Promise<FsaWritable>;
}

/** The part of `FileSystemDirectoryHandle` the adapter uses. */
export interface FsaDirectoryHandle extends FsaHandle {
  readonly kind: "directory";
  values(): AsyncIterable<FsaHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsaDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** What the adapter has done so far, as `onProgress` is told; the counts only grow. */
export interface FsaProgress {
  /** Files taken (mount) or written (commit), stubs apart. */
  files: number;
  directories: number;
  /** Stubs made (mount) or skipped (commit). */
  stubs: number;
  /** Bytes of file content taken or written. */
  bytes: number;
  /** The path of the entry just done, relative to the folder and written with `/`. */
  current: string;
}

/** The settings of {@link mountDirectory}. */
export interface MountDirectoryOptions {
  /** The tree to mount into. Default: a new empty {@link MemoryVfs}. */
  into?: MemoryVfs;
  /** The folder of the tree that the contents of the handle go into (made when missing); relative to the tree's `cwd`. Default `/`. */
  at?: string;
  /**
   * Decides, for each entry, whether its content is copied, only its name is kept (a stub), or it is left out; `path` is relative
   * to the handle, written with `/`, and `size` is the size of a file in bytes (0 for a folder). A folder that is left out is left
   * out whole; for a folder, `"stub"` is `"content"`. Default {@link defaultInclude}. Leaving an entry out removes its name from the
   * listing the engine reads, which the default never does (HOST-252).
   */
  include?: MountInclude;
  /**
   * The most bytes of file content to take, counting every file whose decision is `"content"`; also bounded by the room that
   * `into` has left (`into.maxBytes - into.size`). A mount that would pass it is refused with an error whose `code` is `ENOSPC`
   * before the file that passes it is read. Default unlimited.
   */
  maxBytes?: number;
  /** Stops the mount: it rejects with the signal's reason and the tree is as it was before. */
  signal?: AbortSignal;
  onProgress?: (progress: FsaProgress) => void;
}

/** One thing the walk found, held until the whole walk has succeeded. */
interface Staged {
  kind: "directory" | "file" | "stub";
  /** Relative to the handle, written with `/`. */
  path: string;
  bytes: Uint8Array | undefined;
}

/** Throws the signal's reason when it has been aborted. */
function checkAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

/** A name the handle gave that no path could hold; a real handle never gives one. */
function checkName(name: string): void {
  if (name === "" || name === "." || name === ".." || name.includes("/")) {
    throw new TypeError(`the folder handle listed an entry with a name that is not a file name: ${JSON.stringify(name)}`);
  }
}

function noRoom(limit: number, path: string): Error & { code: string } {
  const error: Error & { code: string } = Object.assign(
    new Error(`ENOSPC: no space left, the folder holds more than the ${limit} bytes of content that may be mounted, at '${path}'`),
    { code: "ENOSPC" },
  );
  return error;
}

/**
 * Copies the folder behind a directory handle into an in-memory tree (HOST-252).
 *
 * The walk lists each folder with `values()` and, for each file, asks the handle for the `File` (its size is known without reading)
 * and reads its bytes; it goes folder by folder, one entry at a time. Nothing is put into the tree until the whole walk has
 * succeeded: a failure, a refused size or an abort leaves the tree exactly as it was. Memory: the content of the folder is held
 * once while the walk runs and a second time as the tree takes it, file by file, so the peak is the content plus the largest file.
 *
 * @returns the tree: `options.into`, or a new one.
 * @spec HOST-252
 */
export async function mountDirectory(handle: FsaDirectoryHandle, options: MountDirectoryOptions = {}): Promise<MemoryVfs> {
  const { signal } = options;
  const include = options.include ?? defaultInclude;
  const into = options.into ?? new MemoryVfs();
  const base = posix.resolveFrom(into.cwd, options.at ?? "/");
  const limit = Math.min(options.maxBytes ?? Number.POSITIVE_INFINITY, into.maxBytes - into.size);
  const staged: Staged[] = [];
  const progress: FsaProgress = { files: 0, directories: 0, stubs: 0, bytes: 0, current: "" };
  const done = (entry: Staged): void => {
    staged.push(entry);
    if (entry.kind === "directory") progress.directories += 1;
    else if (entry.kind === "stub") progress.stubs += 1;
    else progress.files += 1;
    progress.current = entry.path;
    options.onProgress?.({ ...progress });
  };

  const walk = async (folder: FsaDirectoryHandle, prefix: string): Promise<void> => {
    const listed: FsaHandle[] = [];
    for await (const entry of folder.values()) listed.push(entry);
    for (const entry of listed) {
      checkAborted(signal);
      checkName(entry.name);
      const path = `${prefix}${entry.name}`;
      if (entry.kind === "directory") {
        if (include(path, "directory", 0) === "skip") continue;
        done({ kind: "directory", path, bytes: undefined });
        await walk(entry as FsaDirectoryHandle, `${path}/`);
        continue;
      }
      const file = await (entry as FsaFileHandle).getFile();
      checkAborted(signal);
      const decision = include(path, "file", file.size);
      if (decision === "skip") continue;
      if (decision === "stub") {
        done({ kind: "stub", path, bytes: undefined });
        continue;
      }
      if (progress.bytes + file.size > limit) throw noRoom(limit, path);
      const bytes = new Uint8Array(await file.arrayBuffer());
      checkAborted(signal);
      // a file may have changed between the size and the read; the bytes read are what counts
      if (progress.bytes + bytes.length > limit) throw noRoom(limit, path);
      progress.bytes += bytes.length;
      done({ kind: "file", path, bytes });
    }
  };

  checkAborted(signal);
  await walk(handle, "");
  checkAborted(signal);

  // The walk is over and nothing below awaits, so the tree changes all at once or, on a clash with what it holds, fails like `mount`.
  into.mount({ [`${base === "/" ? "" : base}/`]: new Uint8Array(0) });
  const at = (path: string): string => `${base === "/" ? "" : base}/${path}`;
  for (const entry of staged) {
    if (entry.kind === "directory") into.mount({ [`${at(entry.path)}/`]: new Uint8Array(0) });
    else if (entry.kind === "stub") {
      into.mount({ [at(entry.path)]: new Uint8Array(0) });
      into.markStub(at(entry.path));
    }
    else {
      into.writeFile(at(entry.path), entry.bytes as Uint8Array);
      entry.bytes = undefined;
    }
  }
  return into;
}

/** The settings of {@link commitToDirectory}. */
export interface CommitToDirectoryOptions {
  /** The folder of the tree to write out, relative to the tree's `cwd`. Default `/`. */
  from?: string;
  /**
   * Empties the target folder first; rejects, touching nothing, when the folder written holds stubs. Default `false`: nothing that
   * is in the target is removed unless the caller says so.
   */
  clean?: boolean;
  /** Stops the commit: it rejects with a {@link CommitError} that is `aborted` and says what had been written. */
  signal?: AbortSignal;
  onProgress?: (progress: FsaProgress) => void;
  /** The most files written at once within a folder. Default 8. */
  concurrency?: number;
}

/** What a commit wrote. */
export interface CommitResult {
  files: number;
  directories: number;
  /** Bytes of file content written. */
  bytes: number;
  /** Stubs left out: a stub has no content to write (HOST-252). */
  stubs: number;
}

/** One entry the handle refused or that could not be written. */
export interface CommitFailure {
  /** Relative to the folder written, with `/`. */
  path: string;
  error: unknown;
}

/**
 * What {@link commitToDirectory} rejects with when it did not write everything: the entries it could not write (`failures`), or an
 * abort (`aborted`, with the signal's reason as `cause`). In both, `written` says what is in the target.
 */
export class CommitError extends Error {
  readonly failures: readonly CommitFailure[];
  readonly written: CommitResult;
  readonly aborted: boolean;

  constructor(failures: readonly CommitFailure[], written: CommitResult, aborted: boolean, reason?: unknown) {
    const first = failures[0];
    const detail = first === undefined ? "" : `, first: ${first.path}: ${first.error instanceof Error ? first.error.message : String(first.error)}`;
    super(
      aborted
        ? `the commit was aborted after ${written.files} files`
        : `${failures.length} ${failures.length === 1 ? "entry" : "entries"} could not be written; ${written.files} files were${detail}`,
      aborted ? { cause: reason } : undefined,
    );
    this.name = "CommitError";
    this.failures = failures;
    this.written = written;
    this.aborted = aborted;
  }
}

/** Orders names by code unit, so that the writes go in the same order whatever order the tree lists. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** How many stubs (HOST-252) the folder `source` of the tree holds, at any depth. */
function countStubs(vfs: MemoryVfs, source: string): number {
  let stubs = 0;
  for (const entry of vfs.readdir(source)) {
    const path = posix.join(source, entry.name);
    if (entry.isDirectory) stubs += countStubs(vfs, path);
    else if (vfs.stubSize(path) !== undefined) stubs += 1;
  }
  return stubs;
}

/**
 * Writes a folder of an in-memory tree into a directory handle (HOST-253): every folder with `getDirectoryHandle(name, {create:
 * true})` and every file with `getFileHandle(name, {create: true})` and `createWritable()`. A folder is written one at a time, its
 * files up to `concurrency` at a time, then its subfolders. A name the handle refuses is not the end: the rest is written, and the
 * refusals are reported together, as a {@link CommitError}, when nothing else is left. Stubs (HOST-252) are not written.
 *
 * Without `clean`, a file of the target that has the name of one written is replaced and everything else in the target is left alone.
 * With `clean`, a tree that holds stubs under `from` is refused before the target is touched: emptying the target could delete the
 * only copy of a stubbed file.
 *
 * @spec HOST-253
 */
export async function commitToDirectory(vfs: MemoryVfs, handle: FsaDirectoryHandle, options: CommitToDirectoryOptions = {}): Promise<CommitResult> {
  const { signal } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 8));
  const root = posix.resolveFrom(vfs.cwd, options.from ?? "/");
  if (!vfs.stat(root).isDirectory) vfs.readdir(root); // a file: the tree's own ENOTDIR
  const written: CommitResult = { files: 0, directories: 0, bytes: 0, stubs: 0 };
  const failures: CommitFailure[] = [];
  const stubs = stubsOf(vfs);
  const progress = (current: string): void => options.onProgress?.({ ...written, current });
  let stopped = false;
  const shouldStop = (): boolean => {
    if (signal?.aborted) stopped = true;
    return stopped;
  };
  const fail = (path: string, error: unknown): void => {
    failures.push({ path, error });
  };

  if (options.clean === true) {
    const stubs = countStubs(vfs, root);
    if (stubs > 0) {
      throw new Error(
        `clean refused, nothing in the target was touched: the tree holds ${stubs} ${stubs === 1 ? "stub" : "stubs"}, whose content is not in the tree and may exist only in the target; a mount never causes the loss of a user's only copy`,
      );
    }
    const names: string[] = [];
    for await (const entry of handle.values()) names.push(entry.name);
    for (const name of names) {
      if (shouldStop()) break;
      try {
        await handle.removeEntry(name, { recursive: true });
      } catch (error) {
        fail(name, error);
      }
    }
  }

  const writeFile = async (folder: FsaDirectoryHandle, name: string, path: string, source: string): Promise<void> => {
    let writable: FsaWritable | undefined;
    try {
      // `MemoryVfs.readFile` returns a copy it made itself, which is backed by an `ArrayBuffer` (the DOM's `write` takes no shared one)
      const bytes = vfs.readFile(source) as Uint8Array<ArrayBuffer>;
      const file = await folder.getFileHandle(name, { create: true });
      writable = await file.createWritable();
      await writable.write(bytes);
      await writable.close();
      written.files += 1;
      written.bytes += bytes.length;
      progress(path);
    } catch (error) {
      if (writable !== undefined) await writable.abort?.(error).catch(() => undefined);
      fail(path, error);
    }
  };

  const writeFolder = async (folder: FsaDirectoryHandle, source: string, prefix: string): Promise<void> => {
    const entries = vfs.readdir(source).sort((a, b) => byName(a.name, b.name));
    const files = entries.filter((entry) => entry.isFile);
    const folders = entries.filter((entry) => entry.isDirectory);
    const pending: Array<() => Promise<void>> = [];
    for (const entry of files) {
      const path = `${prefix}${entry.name}`;
      const from = posix.join(source, entry.name);
      if (stubs.has(from)) {
        written.stubs += 1;
        continue;
      }
      pending.push(() => writeFile(folder, entry.name, path, from));
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!shouldStop()) {
        const job = pending[next++];
        if (job === undefined) return;
        await job();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    for (const entry of folders) {
      if (shouldStop()) return;
      const path = `${prefix}${entry.name}`;
      let child: FsaDirectoryHandle;
      try {
        child = await folder.getDirectoryHandle(entry.name, { create: true });
      } catch (error) {
        fail(path, error);
        continue;
      }
      written.directories += 1;
      progress(path);
      await writeFolder(child, posix.join(source, entry.name), `${path}/`);
    }
  };

  if (!shouldStop()) await writeFolder(handle, root, "");
  if (stopped) throw new CommitError(failures, written, true, signal?.reason);
  if (failures.length > 0) throw new CommitError(failures, written, false);
  return written;
}

/**
 * Whether this page can open a folder picker, `showDirectoryPicker` (HOST-253): true in a window of Chromium, false in Firefox,
 * WebKit and in a Worker. A handle to the origin private file system (`navigator.storage.getDirectory()`) needs no picker and works in
 * every browser, so this tells only whether the user can be asked for a folder of their own.
 *
 * @param scope where to look for the function; default the global object.
 */
export function isFileSystemAccessSupported(scope: object = globalThis): boolean {
  return typeof (scope as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}
