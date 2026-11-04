import { posix } from "../io/path.js";
import type { AppendHandle, HostDirent, HostFs, HostFsError, HostStat } from "./types.js";

/**
 * The in-memory file system of the browser (HOST-215): a {@link HostFs} over a tree of folders and files that lives in the page's
 * memory and nowhere else. A caller mounts a package into it before a run (a zip, a picked folder, a file list) and reads the
 * output tree out of it after (`snapshot`, `toTree`), which is how a browser, with no synchronous file API, runs an engine
 * whose file calls are all synchronous (map D1).
 *
 * It is the tree of HOST-214 and passes its suite (`memory-fs.conformance.test.ts`): case-sensitive, names kept as created (no
 * normalisation of any kind), no links, no order in `readdir`, and an error that carries a Node errno `code` and a Node-like
 * message, so that `translateFileError` and `translateListError` treat it as they treat a disk. It imports no Node module and
 * uses neither `Buffer` nor `process`, so it is clean for the browser typecheck ratchet.
 *
 * Bytes are copied on the way in and on the way out: no array the caller holds is ever the one the tree holds, so a caller may
 * reuse or change what it wrote or read (the price is a transient second copy of each file while it moves; the memory budget of
 * ticket 31 measures it).
 *
 * @spec HOST-200 HOST-201 HOST-214 HOST-215 HOST-252 HOST-254
 */

/** The settings of a {@link MemoryVfs}. */
export interface MemoryVfsOptions {
  /** The folder that a relative path is resolved against; an absolute POSIX path, default `/`. It need not exist. */
  cwd?: string;
  /** The most bytes of file content the tree may hold; a write past it throws `ENOSPC`. Default unlimited. */
  maxBytes?: number;
}

/** What {@link MemoryVfs.mount} takes: the content of each file by its path; a path with a trailing `/` stands for an empty folder. */
export type MountFiles = Record<string, Uint8Array | string>;

interface FileNode {
  readonly kind: "file";
  data: Uint8Array;
  /** True once the file has been removed from the tree, so that a handle that is still open appends to nothing, as to an unlinked file. */
  detached: boolean;
  /** True from {@link MemoryVfs.markStub} until something writes the file: its name is in the tree, its content was never read, and it cannot be read (HOST-252). */
  stub?: boolean;
}

interface DirNode {
  readonly kind: "dir";
  readonly children: Map<string, Entry>;
}

type Entry = FileNode | DirNode;

interface Located {
  /** The folder that holds `node` (or would hold it); absent for the root. */
  parent: DirNode | undefined;
  /** The last name of the path; empty for the root. */
  name: string;
  /** What the path names, or undefined when only its last name is missing. */
  node: Entry | undefined;
  /** True when the path as given ends with `/`. */
  slash: boolean;
}

const encoder = new TextEncoder();

/** A copy of the bytes, as a plain `Uint8Array` (a `Buffer` or a view of a larger buffer gives just its own elements). */
const copy = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes);

const MESSAGES: Record<string, string> = {
  ENOENT: "no such file or directory",
  ENOTDIR: "not a directory",
  EISDIR: "illegal operation on a directory",
  EEXIST: "file already exists",
  EPERM: "operation not permitted",
  ENOSPC: "no space left on device",
  EBADF: "bad file descriptor",
  EIO: "i/o error",
};

/** An error as Node makes it: `CODE: description, syscall 'path'`, with `code`, `syscall` and `path` set. */
function fsError(code: string, syscall: string, path?: string): HostFsError {
  const error: HostFsError & { syscall?: string } = new Error(
    `${code}: ${MESSAGES[code]}, ${syscall}${path === undefined ? "" : ` '${path}'`}`,
  );
  error.code = code;
  error.syscall = syscall;
  if (path !== undefined) error.path = path;
  return error;
}

/** The in-memory {@link HostFs}. */
export class MemoryVfs implements HostFs {
  readonly cwd: string;
  /** The capacity in bytes of file content; may be changed between calls. A write that would pass it throws `ENOSPC`. */
  maxBytes: number;
  #root: DirNode = { kind: "dir", children: new Map() };
  #size = 0;

  /** @param files what to mount at the start, as {@link MemoryVfs.mount} takes it. */
  constructor(files?: MountFiles, options: MemoryVfsOptions = {}) {
    const cwd = options.cwd ?? "/";
    if (!posix.isAbsolute(cwd)) throw new TypeError(`the current directory of a MemoryVfs must be an absolute path: ${cwd}`);
    this.cwd = posix.resolveFrom("/", cwd);
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
    if (files !== undefined) this.mount(files);
  }

  /** The total bytes of file content in the tree (what `maxBytes` bounds; the budget of ticket 31 reads it). */
  get size(): number {
    return this.#size;
  }

  // ------------------------------------------------------------------------------------------------------------ HostFs

  stat(path: string): HostStat {
    const found = this.#locate(path, "stat");
    const node = this.#existing(found, "stat", path);
    return { isFile: node.kind === "file", isDirectory: node.kind === "dir" };
  }

  readdir(path: string): HostDirent[] {
    const node = this.#existing(this.#locate(path, "scandir"), "scandir", path);
    if (node.kind !== "dir") throw fsError("ENOTDIR", "scandir", path);
    return Array.from(node.children, ([name, child]) => ({
      name,
      isFile: child.kind === "file",
      isDirectory: child.kind === "dir",
      isSymbolicLink: false,
    }));
  }

  readFile(path: string): Uint8Array {
    const node = this.#existing(this.#locate(path, "open"), "open", path);
    // Node names no path for a read of a folder: the open succeeds and the read is what fails
    if (node.kind === "dir") throw fsError("EISDIR", "read");
    if (node.stub === true) throw fsError("EIO", "read", path);
    return copy(node.data);
  }

  writeFile(path: string, data: Uint8Array): void {
    const found = this.#locate(path, "open");
    if (found.node?.kind === "dir") throw fsError("EISDIR", "open", path);
    if (found.node === undefined) {
      if (found.slash) throw fsError("EISDIR", "open", path);
      this.#reserve(data.length, "write", path);
      found.parent?.children.set(found.name, { kind: "file", data: copy(data), detached: false });
      this.#size += data.length;
      return;
    }
    if (found.slash) throw fsError("ENOTDIR", "open", path);
    const delta = data.length - found.node.data.length;
    this.#reserve(delta, "write", path);
    // the node is kept and its content replaced, so that an append handle open on the file still stands for it
    found.node.data = copy(data);
    found.node.stub = false;
    this.#size += delta;
  }

  mkdir(path: string): void {
    const found = this.#locate(path, "mkdir");
    if (found.node !== undefined) throw fsError("EEXIST", "mkdir", path);
    found.parent?.children.set(found.name, { kind: "dir", children: new Map() });
  }

  rm(path: string, options: { recursive: boolean }): void {
    const found = this.#locate(path, "lstat");
    const node = this.#existing(found, "lstat", path);
    if (found.parent === undefined) throw fsError("EPERM", "rm", path);
    if (node.kind === "dir" && !options.recursive) {
      // Node's own refusal of a folder without `recursive`, which has no errno code of its own
      const error: HostFsError & { syscall?: string } = new Error(`Path is a directory: rm returned EISDIR (is a directory) ${path}`);
      error.code = "ERR_FS_EISDIR";
      error.syscall = "rm";
      error.path = path;
      throw error;
    }
    found.parent.children.delete(found.name);
    this.#release(node);
  }

  exists(path: string): boolean {
    try {
      const found = this.#locate(path, "access");
      return found.node !== undefined && !(found.slash && found.node.kind === "file");
    } catch {
      return false;
    }
  }

  openAppend(path: string): AppendHandle {
    const found = this.#locate(path, "open");
    if (found.node?.kind === "dir") throw fsError("EISDIR", "open", path);
    let file: FileNode;
    if (found.node === undefined) {
      if (found.slash) throw fsError("EISDIR", "open", path);
      file = { kind: "file", data: new Uint8Array(0), detached: false };
      found.parent?.children.set(found.name, file);
    } else {
      if (found.slash) throw fsError("ENOTDIR", "open", path);
      file = found.node;
      if (file.stub === true) throw fsError("EIO", "open", path);
    }
    // What is written waits in the handle and joins the file when the handle is closed (HOST-215).
    const chunks: Uint8Array[] = [];
    let pending = 0;
    let closed = false;
    return {
      write: (bytes: Uint8Array): void => {
        if (closed) throw fsError("EBADF", "write");
        if (bytes.length === 0) return;
        this.#reserve(pending + bytes.length, "write", path);
        chunks.push(copy(bytes));
        pending += bytes.length;
      },
      close: (): void => {
        if (closed) throw fsError("EBADF", "close");
        closed = true;
        if (pending === 0 || file.detached) return;
        this.#reserve(pending, "write", path);
        const joined = new Uint8Array(file.data.length + pending);
        joined.set(file.data, 0);
        let offset = file.data.length;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.length;
        }
        file.data = joined;
        file.stub = false;
        this.#size += pending;
      },
    };
  }

  // ------------------------------------------------------------------------------------------------- beyond HostFs

  /**
   * Puts files into the tree, as `writeFile` does for each (a file that exists is replaced) after making the folders above it that
   * are missing. `files` maps a path, absolute or relative to `cwd`, to the content of the file: bytes, or a string that is
   * written as UTF-8. A path that ends with `/` makes an empty folder and takes an empty content. A failure (a folder in the
   * way of a file, a file in the way of a folder, `ENOSPC`) throws as the call that failed does and leaves what was put before it.
   */
  mount(files: MountFiles): void {
    for (const [path, content] of Object.entries(files)) {
      const bytes = typeof content === "string" ? encoder.encode(content) : content;
      if (path.endsWith("/")) {
        if (bytes.length > 0) throw new TypeError(`a path that ends with "/" is a folder and takes no content: ${path}`);
        this.#makeFolders(path);
        continue;
      }
      this.#makeFolders(posix.dirname(path), path);
      this.writeFile(path, bytes);
    }
  }

  /** Records that a file of the tree is a stub. It stays one until a write reaches it or it leaves the tree. */
  markStub(path: string): void {
    const node = this.#existing(this.#locate(path, "open"), "open", path);
    if (node.kind === "dir") throw fsError("EISDIR", "open", path);
    node.stub = true;
  }

  /** The absolute paths of the files that are stubs now, in the order of the paths compared by code unit. */
  stubs(): string[] {
    return this.#files("/")
      .filter(([, file]) => file.stub === true)
      .map(([path]) => `/${path}`)
      .sort(compareCodeUnits);
  }

  /** Removes everything; the tree is empty again and `size` is 0. A handle still open on a file stands for nothing. */
  clear(): void {
    for (const node of this.#root.children.values()) this.#release(node);
    this.#root.children.clear();
  }

  /**
   * Every file under `root` (a folder; default the root of the tree) with its bytes, by its path relative to `root`, written with `/`,
   * in the order of the paths compared by code unit. The bytes are copies. A stub (HOST-252) has no content and is
   * left out. A path that is not there throws `ENOENT`, and one that is a file `ENOTDIR`.
   */
  snapshot(root = "/"): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    for (const [path, file] of this.#files(root).sort(([a], [b]) => compareCodeUnits(a, b))) {
      if (file.stub !== true) files.set(path, copy(file.data));
    }
    return files;
  }

  /**
   * The sorted list the replay tests compare (`tree()` in `src/export/run-replay.test.ts`): every file below `root` as a path
   * relative to it, written with `/`, and every folder that has a file anywhere below it as its path with a trailing `/`. A
   * folder with no file in it, or only empty folders, is not listed. Sorted by code unit, as `Array.prototype.sort` does.
   */
  toTree(root = "/"): string[] {
    const found = this.#existing(this.#locate(root, "scandir"), "scandir", root);
    if (found.kind !== "dir") throw fsError("ENOTDIR", "scandir", root);
    const listed: string[] = [];
    const visit = (dir: DirNode, prefix: string): boolean => {
      let any = false;
      for (const [name, child] of dir.children) {
        const path = `${prefix}${name}`;
        if (child.kind === "file") {
          listed.push(path);
          any = true;
        } else if (visit(child, `${path}/`)) {
          listed.push(`${path}/`);
          any = true;
        }
      }
      return any;
    };
    visit(found, "");
    return listed.sort();
  }

  // ----------------------------------------------------------------------------------------------------------- inside

  /** Resolves a path against `cwd` and walks it; a missing or non-folder name above the last one is the error of the call `syscall`. */
  #locate(path: string, syscall: string): Located {
    if (path === "") throw fsError("ENOENT", syscall, path);
    const names = posix
      .resolveFrom(this.cwd, path)
      .split("/")
      .filter((name) => name !== "");
    const slash = path.endsWith("/");
    let parent: DirNode | undefined;
    let node: Entry | undefined = this.#root;
    for (const [index, name] of names.entries()) {
      if (node?.kind !== "dir") throw fsError(node === undefined ? "ENOENT" : "ENOTDIR", syscall, path);
      parent = node;
      node = node.children.get(name);
      if (index === names.length - 1) return { parent, name, node, slash };
    }
    return { parent: undefined, name: "", node, slash };
  }

  /** The node a located path names, or `ENOENT`; a file named with a trailing `/` is `ENOTDIR`. */
  #existing(found: Located, syscall: string, path: string): Entry {
    if (found.node === undefined) throw fsError("ENOENT", syscall, path);
    if (found.slash && found.node.kind === "file") throw fsError("ENOTDIR", syscall, path);
    return found.node;
  }

  /** Throws `ENOSPC` when `bytes` more would pass `maxBytes`. */
  #reserve(bytes: number, syscall: string, path: string): void {
    if (bytes > 0 && this.#size + bytes > this.maxBytes) throw fsError("ENOSPC", syscall, path);
  }

  /** Takes a node that left the tree out of the account, and cuts its files loose from any handle that is open on them. */
  #release(node: Entry): void {
    const stack: Entry[] = [node];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (next.kind === "file") {
        next.detached = true;
        this.#size -= next.data.length;
      } else stack.push(...next.children.values());
    }
  }

  /** `mkdir -p` of an absolute or relative folder path; `forFile` is the path the folder is made for, named in an error. */
  #makeFolders(folder: string, forFile?: string): void {
    const names = posix
      .resolveFrom(this.cwd, folder)
      .split("/")
      .filter((name) => name !== "");
    let dir = this.#root;
    for (const name of names) {
      const child = dir.children.get(name);
      if (child === undefined) {
        const made: DirNode = { kind: "dir", children: new Map() };
        dir.children.set(name, made);
        dir = made;
      } else if (child.kind === "dir") dir = child;
      else throw fsError("ENOTDIR", "mkdir", forFile ?? folder);
    }
  }

  /** Every file under a folder with its path relative to the folder, in no order. */
  #files(root: string): Array<[string, FileNode]> {
    const found = this.#existing(this.#locate(root, "scandir"), "scandir", root);
    if (found.kind !== "dir") throw fsError("ENOTDIR", "scandir", root);
    const files: Array<[string, FileNode]> = [];
    const visit = (dir: DirNode, prefix: string): void => {
      for (const [name, child] of dir.children) {
        if (child.kind === "file") files.push([`${prefix}${name}`, child]);
        else visit(child, `${prefix}${name}/`);
      }
    };
    visit(found, "");
    return files;
  }
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
