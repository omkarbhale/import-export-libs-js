import type { FsaDirectoryHandle, FsaFile, FsaFileHandle, FsaHandle, FsaWritable } from "./fsa.js";

/**
 * A directory handle written in memory, for the tests of the File System Access adapter (`fsa.ts`) under Node, which has none. It
 * implements the part of the interface the adapter uses and behaves as the origin private file system does where the adapter can
 * tell: a name that is empty, `.`, `..` or has a `/` is a `TypeError`, a missing name without `create` is a `NotFoundError`, a
 * file's bytes appear when its writable is closed (an aborted writable leaves the file as it was), and a folder lists its entries in
 * the order they were made. It adds what a test needs to look: the files whose bytes were read, the files written at once, and a
 * hook that refuses names, as an NTFS-backed folder refuses `a:b`.
 */

/** What every handle of one tree shares: the settings and the counters. */
export interface FakeState {
  /** A name that this returns `true` for is refused as an illegal name (a `TypeError`), by `getFileHandle` and `getDirectoryHandle`. */
  refuse: (name: string) => boolean;
  /** Called with the path of a file when its bytes are read with `arrayBuffer()`. */
  reads: string[];
  /** The most writables open at once, and how many are open now. */
  maxOpenWritables: number;
  openWritables: number;
  /** Every `removeEntry`, as `<folder path>/<name>`. */
  removed: string[];
}

export interface FakeOptions {
  refuse?: (name: string) => boolean;
}

function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function checkName(name: string): void {
  if (name === "" || name === "." || name === ".." || name.includes("/")) throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
}

class FakeFile implements FsaFile {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly path: string,
    private readonly state: FakeState,
  ) {}

  get size(): number {
    return this.bytes.length;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    this.state.reads.push(this.path);
    return Promise.resolve(this.bytes.slice().buffer);
  }
}

export class FakeFileHandle implements FsaFileHandle {
  readonly kind = "file";
  data = new Uint8Array(0);

  constructor(
    readonly name: string,
    private readonly path: string,
    private readonly state: FakeState,
  ) {}

  getFile(): Promise<FsaFile> {
    return Promise.resolve(new FakeFile(this.data, this.path, this.state));
  }

  createWritable(): Promise<FsaWritable> {
    const state = this.state;
    let pending = new Uint8Array(0);
    let open = true;
    state.openWritables += 1;
    state.maxOpenWritables = Math.max(state.maxOpenWritables, state.openWritables);
    const release = (): void => {
      if (open) state.openWritables -= 1;
      open = false;
    };
    return Promise.resolve({
      write: async (bytes: Uint8Array): Promise<void> => {
        await Promise.resolve(); // a real write takes a turn, which lets the others of a pool start
        const joined = new Uint8Array(pending.length + bytes.length);
        joined.set(pending, 0);
        joined.set(bytes, pending.length);
        pending = joined;
      },
      close: async (): Promise<void> => {
        await Promise.resolve();
        this.data = pending;
        release();
      },
      abort: (): Promise<void> => {
        release();
        return Promise.resolve();
      },
    });
  }
}

export class FakeDirectoryHandle implements FsaDirectoryHandle {
  readonly kind = "directory";
  readonly #children = new Map<string, FakeFileHandle | FakeDirectoryHandle>();
  readonly state: FakeState;

  constructor(
    readonly name = "",
    options: FakeOptions = {},
    private readonly path = "",
    state?: FakeState,
  ) {
    this.state = state ?? { refuse: options.refuse ?? (() => false), reads: [], maxOpenWritables: 0, openWritables: 0, removed: [] };
  }

  async *values(): AsyncIterable<FsaHandle> {
    for (const child of [...this.#children.values()]) {
      await Promise.resolve();
      yield child;
    }
  }

  getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FsaFileHandle> {
    return this.#get(name, options.create === true, "file") as Promise<FsaFileHandle>;
  }

  getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FsaDirectoryHandle> {
    return this.#get(name, options.create === true, "directory") as Promise<FsaDirectoryHandle>;
  }

  removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    const child = this.#children.get(name);
    if (child === undefined) return Promise.reject(domError("NotFoundError", `A requested file or directory could not be found: ${name}`));
    if (child instanceof FakeDirectoryHandle && child.#children.size > 0 && options.recursive !== true) {
      return Promise.reject(domError("InvalidModificationError", `The directory is not empty: ${name}`));
    }
    this.#children.delete(name);
    this.state.removed.push(`${this.path}/${name}`);
    return Promise.resolve();
  }

  #get(name: string, create: boolean, kind: "file" | "directory"): Promise<FakeFileHandle | FakeDirectoryHandle> {
    try {
      checkName(name);
      if (this.state.refuse(name)) throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
    } catch (error) {
      return Promise.reject(error);
    }
    const found = this.#children.get(name);
    if (found !== undefined) {
      if (found.kind !== kind) return Promise.reject(domError("TypeMismatchError", `The path supplied exists, but was not an entry of requested type: ${name}`));
      return Promise.resolve(found);
    }
    if (!create) return Promise.reject(domError("NotFoundError", `A requested file or directory could not be found: ${name}`));
    const path = `${this.path}/${name}`;
    const made = kind === "file" ? new FakeFileHandle(name, path, this.state) : new FakeDirectoryHandle(name, {}, path, this.state);
    this.#children.set(name, made);
    return Promise.resolve(made);
  }

  /** Puts a file in, with the folders above it; synchronous, for building a tree to mount. A path ending in `/` makes an empty folder. */
  put(path: string, content: Uint8Array | string = ""): this {
    const names = path.split("/").filter((name) => name !== "");
    const isFolder = path.endsWith("/");
    let folder: FakeDirectoryHandle = this;
    names.forEach((name, index) => {
      const last = index === names.length - 1;
      let child = folder.#children.get(name);
      if (child === undefined) {
        const childPath = `${folder.path}/${name}`;
        child = last && !isFolder ? new FakeFileHandle(name, childPath, folder.state) : new FakeDirectoryHandle(name, {}, childPath, folder.state);
        folder.#children.set(name, child);
      }
      if (last && child instanceof FakeFileHandle) child.data = typeof content === "string" ? new TextEncoder().encode(content) : content.slice();
      if (child instanceof FakeDirectoryHandle) folder = child;
    });
    return this;
  }

  /** Every file below this folder, by its path with `/`, and every folder with a trailing `/`, as bytes (a folder: `undefined`). */
  contents(prefix = ""): Map<string, Uint8Array | undefined> {
    const all = new Map<string, Uint8Array | undefined>();
    for (const [name, child] of this.#children) {
      if (child instanceof FakeDirectoryHandle) {
        all.set(`${prefix}${name}/`, undefined);
        for (const [path, bytes] of child.contents(`${prefix}${name}/`)) all.set(path, bytes);
      } else all.set(`${prefix}${name}`, child.data);
    }
    return all;
  }
}
