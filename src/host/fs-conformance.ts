import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostFs, HostFsError } from "./types.js";

/**
 * The definition of a {@link HostFs} (HOST-214): one suite of cases, parameterised over a factory, that every implementation must
 * pass. `nodeFs` passes it against a temporary folder (`node-fs.conformance.test.ts`), so the suite describes what the disk
 * really does; the in-memory file system of the browser is held to the same cases.
 *
 * A `HostFs` is a case-sensitive POSIX tree with errno-coded errors (HOST-201): `A` and `a` are two entries, a name is stored as
 * created (no normalisation, no folding of trailing dots), `readdir` has no order, and a failure carries the Node errno `code`.
 * The Windows rules (NTFS case folding, trailing dots and spaces, device names) are the file layer's, above this interface
 * (`io/windows-fs.ts`, HOST-210).
 *
 * Every case names the engine-layer call that depends on it (`needs`: file, line at the commit that adds this file, function,
 * and the `HostFs` method it calls), so a case that no code needs can be told from one that a call site relies on. The
 * cases a host may not be able to meet, because the disk it stands on cannot (links, a case-insensitive disk, a short path
 * limit), are marked `optional`: the suite probes the capability once, with the real host, and skips them when it is absent.
 * That is how the suite stays right on a developer's Windows or macOS laptop and runs in full on Linux and on the in-memory
 * host.
 *
 * This module is a vitest helper: only a test imports it, the library's entry does not, and it uses no Node built-in, no
 * `Buffer` and no DOM, so a browser test can run it too.
 *
 * @spec HOST-200 HOST-201 HOST-214
 */

/** What a host may be unable to do: the `optional` of a case. */
export type Capability = "symlink" | "caseSensitive" | "normalization" | "trailing" | "longName" | "longPath" | "enotdir";

/** A host under test: the file system, an empty folder to work in, and the means to clean up. */
export interface HostFsFixture {
  fs: HostFs;
  /** An existing, empty and writable folder, as a path `fs` accepts, with no trailing separator. The suite adds `/` and a name. */
  root: string;
  /** Creates a symbolic link at `path` that points to `target`. Absent on a host that has no links (the in-memory one). */
  symlink?(target: string, path: string): void;
  /** Removes everything the fixture made, `root` included. */
  dispose?(): void;
}

/** Makes a new, empty fixture; called once for each case and once for the capability probe. */
export type HostFsFactory = () => HostFsFixture;

/** An engine-layer call that a case exists for. */
export interface Need {
  /** The file of the call, relative to `src/`. */
  file: string;
  /** The line of the call, at the commit that adds this suite (later slices move it; `file`, `symbol` and `call` stay). */
  line: number;
  /** The function that makes the call. */
  symbol: string;
  /** The `HostFs` member it calls. */
  call: keyof HostFs;
}

export interface ConformanceCase {
  group: string;
  name: string;
  needs: Need[];
  optional?: Capability;
  run(t: Context): void;
}

const need = (file: string, line: number, symbol: string, call: keyof HostFs): Need => ({ file, line, symbol, call });

/** The engine-layer call sites, as of the commit that adds this file. */
const N = {
  // io/windows-fs.ts
  lookupStat: need("io/windows-fs.ts", 144, "lookup", "stat"),
  lookupList: need("io/windows-fs.ts", 150, "lookup", "readdir"),
  lookupFoundStat: need("io/windows-fs.ts", 158, "lookup", "stat"),
  mkdir: need("io/windows-fs.ts", 237, "madeDirectory", "mkdir"),
  rm: need("io/windows-fs.ts", 261, "directoryDelete", "rm"),
  volumeWrite: need("io/windows-fs.ts", 288, "writeVolumeFile", "writeFile"),
  // io/host-path.ts
  fileExistsStat: need("io/host-path.ts", 164, "fileExists", "stat"),
  translateExists: need("io/host-path.ts", 197, "translateFileError", "exists"),
  readBytes: need("io/host-path.ts", 219, "readFileBytes", "readFile"),
  writeBytes: need("io/host-path.ts", 236, "writeFileBytes", "writeFile"),
  // import/package-files.ts
  listEntries: need("import/package-files.ts", 73, "listEntries", "readdir"),
  linkIsDirectory: need("import/package-files.ts", 84, "isDirectory", "stat"),
  linkIsFile: need("import/package-files.ts", 94, "isFile", "stat"),
  listedRead: need("import/package-files.ts", 190, "readListedFile", "readFile"),
  // export/run-log.ts
  logOpen: need("export/run-log.ts", 114, "open", "openAppend"),
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What a case works with: the file system, paths under the fixture's folder, and short forms of the common calls. */
export class Context {
  readonly fs: HostFs;
  readonly root: string;
  readonly symlinkTo: HostFsFixture["symlink"];

  constructor(fixture: HostFsFixture) {
    this.fs = fixture.fs;
    this.root = fixture.root.replace(/[\\/]+$/, "");
    this.symlinkTo = fixture.symlink;
  }

  /** The path of a name under the root; `rel` may have `/` between names. */
  p(rel: string): string {
    return `${this.root}/${rel}`;
  }

  put(rel: string, content: string | Uint8Array = ""): void {
    this.fs.writeFile(this.p(rel), typeof content === "string" ? encoder.encode(content) : content);
  }

  text(rel: string): string {
    return decoder.decode(this.fs.readFile(this.p(rel)));
  }

  mkdir(rel: string): void {
    this.fs.mkdir(this.p(rel));
  }

  /** `mkdir -p`: each folder of `rel` that is missing, one `mkdir` at a time (the host has no `recursive`). */
  mkdirs(rel: string): void {
    let current = "";
    for (const name of rel.split("/")) {
      current = current === "" ? name : `${current}/${name}`;
      if (!this.fs.exists(this.p(current))) this.mkdir(current);
    }
  }

  /** The names in a folder (the root when `rel` is empty), sorted, since the host's own order is unspecified. */
  names(rel = ""): string[] {
    return this.fs
      .readdir(rel === "" ? this.root : this.p(rel))
      .map((entry) => entry.name)
      .sort();
  }

  /** The `code` of the error `action` throws; a failure of the case when it does not throw. */
  code(action: () => unknown): string | undefined {
    try {
      action();
    } catch (error) {
      const code = (error as HostFsError).code;
      if (typeof code !== "string") throw new Error(`the error has no errno code: ${String(error)}`, { cause: error });
      return code;
    }
    throw new Error("expected the call to throw");
  }
}

const bytesOf = (...values: number[]): Uint8Array => Uint8Array.from(values);

function sameBytes(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index++) if (actual[index] !== expected[index]) return false;
  return true;
}

function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  // one comparison, so a mismatch of a few megabytes does not print them
  expect(sameBytes(actual, expected)).toBe(true);
}

/** Every byte value, in order, then in reverse. */
const everyByte = (): Uint8Array => Uint8Array.from({ length: 512 }, (_, index) => (index < 256 ? index : 511 - index));

/** The folders and the file of an absolute path of exactly 4 095 characters under `root`: POSIX `PATH_MAX` is 4 096 with its terminator. */
export function longPathUnder(root: string): { dirs: string[]; file: string } {
  const dirs: string[] = [];
  let rest = 4095 - root.length;
  while (rest - 201 >= 2) {
    dirs.push(String.fromCharCode(97 + (dirs.length % 26)).repeat(200));
    rest -= 201;
  }
  return { dirs, file: "z".repeat(rest - 1) };
}

const cases: ConformanceCase[] = [];

function add(group: string, name: string, needs: Need[], run: (t: Context) => void, optional?: Capability): void {
  cases.push({ group, name, needs, run, ...(optional === undefined ? {} : { optional }) });
}

/** The cases, for a test that checks the suite itself. */
export function conformanceCases(): readonly ConformanceCase[] {
  return cases;
}

const FILE = { isFile: true, isDirectory: false };
const FOLDER = { isFile: false, isDirectory: true };

// ---------------------------------------------------------------------------------------------------------------- stat

add("stat", "a file is a file", [N.fileExistsStat, N.lookupStat], (t) => {
  t.put("f.txt", "x");
  expect(t.fs.stat(t.p("f.txt"))).toEqual(FILE);
});

add("stat", "a directory is a directory", [N.lookupStat, N.lookupFoundStat], (t) => {
  t.mkdir("d");
  expect(t.fs.stat(t.p("d"))).toEqual(FOLDER);
});

add("stat", "the root folder is a directory", [N.lookupStat], (t) => {
  expect(t.fs.stat(t.root)).toEqual(FOLDER);
});

add("stat", "an empty file is a file", [N.fileExistsStat], (t) => {
  t.put("empty");
  expect(t.fs.stat(t.p("empty"))).toEqual(FILE);
});

add("stat", "a missing path is ENOENT", [N.lookupStat, N.fileExistsStat], (t) => {
  expect(t.code(() => t.fs.stat(t.p("missing")))).toBe("ENOENT");
});

add("stat", "a path below a missing folder is ENOENT", [N.lookupStat], (t) => {
  expect(t.code(() => t.fs.stat(t.p("no/such/x")))).toBe("ENOENT");
});

add("stat", "a path through a file is ENOTDIR", [N.lookupStat, N.fileExistsStat], (t) => {
  t.put("f.txt", "x");
  expect(t.code(() => t.fs.stat(t.p("f.txt/below")))).toBe("ENOTDIR");
  expect(t.code(() => t.fs.stat(t.p("f.txt/a/b")))).toBe("ENOTDIR");
}, "enotdir");

add("stat", "it says what is there now: a file, then nothing, then a folder", [N.lookupStat], (t) => {
  t.put("x", "1");
  expect(t.fs.stat(t.p("x"))).toEqual(FILE);
  t.fs.rm(t.p("x"), { recursive: false });
  expect(t.code(() => t.fs.stat(t.p("x")))).toBe("ENOENT");
  t.mkdir("x");
  expect(t.fs.stat(t.p("x"))).toEqual(FOLDER);
});

add("stat", "the result has the two booleans and nothing else", [N.fileExistsStat], (t) => {
  t.put("f", "x");
  expect(Object.keys(t.fs.stat(t.p("f"))).sort()).toEqual(["isDirectory", "isFile"]);
});

add("stat", "a link to a folder is followed", [N.linkIsDirectory], (t) => {
  t.mkdir("d");
  t.symlinkTo?.(t.p("d"), t.p("link"));
  expect(t.fs.stat(t.p("link"))).toEqual(FOLDER);
}, "symlink");

add("stat", "a link to a file is followed", [N.linkIsFile], (t) => {
  t.put("f", "x");
  t.symlinkTo?.(t.p("f"), t.p("link"));
  expect(t.fs.stat(t.p("link"))).toEqual(FILE);
}, "symlink");

add("stat", "a link whose target is missing is ENOENT", [N.linkIsDirectory, N.linkIsFile], (t) => {
  t.symlinkTo?.(t.p("nothing"), t.p("dangling"));
  expect(t.code(() => t.fs.stat(t.p("dangling")))).toBe("ENOENT");
}, "symlink");

// ------------------------------------------------------------------------------------------------------------- readdir

add("readdir", "lists files and folders with their kind", [N.listEntries], (t) => {
  t.put("f.txt", "x");
  t.mkdir("sub");
  const entries = t.fs.readdir(t.root).sort((a, b) => (a.name < b.name ? -1 : 1));
  expect(entries).toEqual([
    { name: "f.txt", isFile: true, isDirectory: false, isSymbolicLink: false },
    { name: "sub", isFile: false, isDirectory: true, isSymbolicLink: false },
  ]);
});

add("readdir", "gives names exactly as created, whatever the order", [N.listEntries], (t) => {
  for (const name of ["b.xml", "a.xml", "C.xml", "10.xml", "9.xml"]) t.put(name, "x");
  expect(t.names()).toEqual(["10.xml", "9.xml", "C.xml", "a.xml", "b.xml"]);
});

add("readdir", "keeps the case of a name as it was created", [N.listEntries, N.lookupList], (t) => {
  t.put("MiXeD.Xml", "x");
  t.mkdir("FoLdEr");
  expect(t.names()).toEqual(["FoLdEr", "MiXeD.Xml"]);
});

add("readdir", "an empty folder lists nothing", [N.listEntries, N.lookupList], (t) => {
  t.mkdir("empty");
  expect(t.fs.readdir(t.p("empty"))).toEqual([]);
});

add("readdir", "never lists . or ..", [N.listEntries], (t) => {
  t.put("f", "x");
  expect(t.names()).not.toContain(".");
  expect(t.names()).not.toContain("..");
  t.mkdir("e");
  expect(t.fs.readdir(t.p("e")).map((entry) => entry.name)).toEqual([]);
});

add("readdir", "lists only the folder's own entries, not what is below them", [N.listEntries], (t) => {
  t.mkdirs("a/b");
  t.put("a/b/deep.xml", "x");
  t.put("a/near.xml", "x");
  expect(t.names()).toEqual(["a"]);
  expect(t.names("a")).toEqual(["b", "near.xml"]);
});

add("readdir", "a missing folder is ENOENT", [N.listEntries, N.lookupList], (t) => {
  expect(t.code(() => t.fs.readdir(t.p("missing")))).toBe("ENOENT");
  expect(t.code(() => t.fs.readdir(t.p("no/such/folder")))).toBe("ENOENT");
});

add("readdir", "a file is ENOTDIR", [N.listEntries, N.lookupList], (t) => {
  t.put("f.txt", "x");
  expect(t.code(() => t.fs.readdir(t.p("f.txt")))).toBe("ENOTDIR");
}, "enotdir");

add("readdir", "a path through a file is ENOTDIR", [N.listEntries], (t) => {
  t.put("f.txt", "x");
  expect(t.code(() => t.fs.readdir(t.p("f.txt/sub")))).toBe("ENOTDIR");
}, "enotdir");

add("readdir", "each entry has exactly the four members", [N.listEntries], (t) => {
  t.put("f", "x");
  const entry = t.fs.readdir(t.root)[0];
  expect(Object.keys(entry ?? {}).sort()).toEqual(["isDirectory", "isFile", "isSymbolicLink", "name"]);
});

add("readdir", "lists names with spaces, leading dots and several dots", [N.listEntries], (t) => {
  for (const name of ["with space.xml", ".hidden", "a.b.c.xml", " lead", "two  spaces"]) t.put(name, "x");
  expect(t.names()).toEqual([" lead", ".hidden", "a.b.c.xml", "two  spaces", "with space.xml"]);
});

add("readdir", "follows what is created and removed", [N.listEntries], (t) => {
  expect(t.names()).toEqual([]);
  t.put("one", "1");
  t.mkdir("two");
  expect(t.names()).toEqual(["one", "two"]);
  t.fs.rm(t.p("one"), { recursive: false });
  expect(t.names()).toEqual(["two"]);
  t.fs.rm(t.p("two"), { recursive: true });
  expect(t.names()).toEqual([]);
});

add("readdir", "lists five hundred entries once each", [N.listEntries], (t) => {
  const expected: string[] = [];
  for (let index = 0; index < 500; index++) {
    const name = `item-${String(index).padStart(3, "0")}.xml`;
    expected.push(name);
    t.put(name, "x");
  }
  const listed = t.names();
  expect(listed).toEqual(expected);
  expect(new Set(listed).size).toBe(500);
});

add("readdir", "a link is an entry of its own kind and is not followed", [N.listEntries, N.linkIsDirectory], (t) => {
  t.mkdir("sub");
  t.put("f", "x");
  t.symlinkTo?.(t.p("sub"), t.p("ln-dir"));
  t.symlinkTo?.(t.p("f"), t.p("ln-file"));
  const byName = Object.fromEntries(t.fs.readdir(t.root).map((entry) => [entry.name, entry]));
  expect(byName["ln-dir"]).toEqual({ name: "ln-dir", isFile: false, isDirectory: false, isSymbolicLink: true });
  expect(byName["ln-file"]).toEqual({ name: "ln-file", isFile: false, isDirectory: false, isSymbolicLink: true });
  expect(byName["sub"]).toEqual({ name: "sub", isFile: false, isDirectory: true, isSymbolicLink: false });
}, "symlink");

// --------------------------------------------------------------------------------------------------------------- mkdir

add("mkdir", "makes a new folder", [N.mkdir], (t) => {
  expect(t.fs.mkdir(t.p("made"))).toBeUndefined();
  expect(t.fs.stat(t.p("made"))).toEqual(FOLDER);
  expect(t.fs.readdir(t.p("made"))).toEqual([]);
});

add("mkdir", "an existing folder is EEXIST", [N.mkdir], (t) => {
  t.mkdir("d");
  expect(t.code(() => t.fs.mkdir(t.p("d")))).toBe("EEXIST");
});

add("mkdir", "an existing file is EEXIST", [N.mkdir], (t) => {
  t.put("f", "x");
  expect(t.code(() => t.fs.mkdir(t.p("f")))).toBe("EEXIST");
});

add("mkdir", "EEXIST leaves the folder and what is in it alone", [N.mkdir], (t) => {
  t.mkdir("d");
  t.put("d/keep.txt", "kept");
  expect(t.code(() => t.fs.mkdir(t.p("d")))).toBe("EEXIST");
  expect(t.text("d/keep.txt")).toBe("kept");
});

add("mkdir", "a missing parent is ENOENT and nothing is made", [N.mkdir], (t) => {
  expect(t.code(() => t.fs.mkdir(t.p("no/parent")))).toBe("ENOENT");
  expect(t.fs.exists(t.p("no"))).toBe(false);
  expect(t.names()).toEqual([]);
});

add("mkdir", "a path under a file is ENOTDIR", [N.mkdir], (t) => {
  t.put("f", "x");
  expect(t.code(() => t.fs.mkdir(t.p("f/sub")))).toBe("ENOTDIR");
}, "enotdir");

add("mkdir", "makes a folder in a folder it made", [N.mkdir], (t) => {
  t.mkdir("a");
  t.mkdir("a/b");
  t.mkdir("a/b/c");
  expect(t.fs.stat(t.p("a/b/c"))).toEqual(FOLDER);
  expect(t.names("a")).toEqual(["b"]);
});

add("mkdir", "takes names with spaces and dots", [N.mkdir], (t) => {
  t.mkdir("my folder");
  t.mkdir(".dot");
  t.mkdir("a.b");
  expect(t.names()).toEqual([".dot", "a.b", "my folder"]);
});

// ------------------------------------------------------------------------------------------------------------ writeFile

add("writeFile", "creates a file with the bytes it is given", [N.volumeWrite, N.writeBytes], (t) => {
  expect(t.fs.writeFile(t.p("a.bin"), bytesOf(1, 2, 3))).toBeUndefined();
  expectBytes(t.fs.readFile(t.p("a.bin")), bytesOf(1, 2, 3));
});

add("writeFile", "truncates a longer file", [N.volumeWrite, N.writeBytes], (t) => {
  t.put("a.txt", "first, longer");
  t.put("a.txt", "second");
  expect(t.text("a.txt")).toBe("second");
});

add("writeFile", "replaces a file with a longer one", [N.writeBytes], (t) => {
  t.put("a.txt", "ab");
  t.put("a.txt", "abcdef");
  expect(t.text("a.txt")).toBe("abcdef");
});

add("writeFile", "a zero-length write creates an empty file and empties an existing one", [N.writeBytes], (t) => {
  t.put("new", "");
  expect(t.fs.readFile(t.p("new")).length).toBe(0);
  t.put("old", "content");
  t.put("old", new Uint8Array(0));
  expect(t.fs.readFile(t.p("old")).length).toBe(0);
});

add("writeFile", "a missing folder is ENOENT and the folder is not made", [N.volumeWrite, N.writeBytes], (t) => {
  expect(t.code(() => t.fs.writeFile(t.p("missing/x"), bytesOf(1)))).toBe("ENOENT");
  expect(t.fs.exists(t.p("missing"))).toBe(false);
});

add("writeFile", "a folder is EISDIR and stays what it was", [N.writeBytes], (t) => {
  t.mkdir("d");
  t.put("d/inside", "x");
  expect(t.code(() => t.fs.writeFile(t.p("d"), bytesOf(1)))).toBe("EISDIR");
  expect(t.fs.stat(t.p("d"))).toEqual(FOLDER);
  expect(t.text("d/inside")).toBe("x");
});

add("writeFile", "a path through a file is ENOTDIR", [N.writeBytes], (t) => {
  t.put("f", "x");
  expect(t.code(() => t.fs.writeFile(t.p("f/x"), bytesOf(1)))).toBe("ENOTDIR");
  expect(t.text("f")).toBe("x");
}, "enotdir");

add("writeFile", "keeps every byte value, text or not", [N.writeBytes, N.volumeWrite], (t) => {
  t.put("all.bin", everyByte());
  expectBytes(t.fs.readFile(t.p("all.bin")), everyByte());
});

add("writeFile", "does not keep the caller's array: a later change to it changes nothing", [N.writeBytes], (t) => {
  const data = bytesOf(1, 2, 3, 4);
  t.put("f", data);
  data.fill(9);
  expectBytes(t.fs.readFile(t.p("f")), bytesOf(1, 2, 3, 4));
});

add("writeFile", "writes a view of a larger buffer, only the bytes the view covers", [N.writeBytes], (t) => {
  const whole = bytesOf(0, 1, 2, 3, 4, 5, 6, 7);
  t.put("view", whole.subarray(2, 6));
  expectBytes(t.fs.readFile(t.p("view")), bytesOf(2, 3, 4, 5));
});

add("writeFile", "writes a file of three megabytes", [N.volumeWrite], (t) => {
  const big = Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, index) => (index * 31 + (index >> 8)) & 0xff);
  t.put("big.bin", big);
  expectBytes(t.fs.readFile(t.p("big.bin")), big);
});

add("writeFile", "touches no other file of the folder", [N.volumeWrite], (t) => {
  t.put("a", "1");
  t.put("b", "2");
  t.put("a", "changed");
  expect(t.text("b")).toBe("2");
  expect(t.names()).toEqual(["a", "b"]);
});

// ------------------------------------------------------------------------------------------------------------- readFile

add("readFile", "returns the bytes that were written", [N.readBytes, N.listedRead], (t) => {
  t.put("f.bin", bytesOf(0, 255, 128, 10, 13));
  expectBytes(t.fs.readFile(t.p("f.bin")), bytesOf(0, 255, 128, 10, 13));
});

add("readFile", "a zero-length file is zero bytes", [N.readBytes, N.listedRead], (t) => {
  t.put("empty");
  const bytes = t.fs.readFile(t.p("empty"));
  expect(bytes.length).toBe(0);
  expect(bytes.byteLength).toBe(0);
});

add("readFile", "a missing file is ENOENT", [N.readBytes, N.translateExists, N.listedRead], (t) => {
  expect(t.code(() => t.fs.readFile(t.p("missing")))).toBe("ENOENT");
});

add("readFile", "a file below a missing folder is ENOENT", [N.readBytes, N.translateExists], (t) => {
  expect(t.code(() => t.fs.readFile(t.p("no/such/f")))).toBe("ENOENT");
});

add("readFile", "a folder is EISDIR", [N.readBytes, N.listedRead], (t) => {
  t.mkdir("d");
  expect(t.code(() => t.fs.readFile(t.p("d")))).toBe("EISDIR");
});

add("readFile", "a path through a file is ENOTDIR", [N.readBytes, N.translateExists], (t) => {
  t.put("f", "x");
  expect(t.code(() => t.fs.readFile(t.p("f/x")))).toBe("ENOTDIR");
}, "enotdir");

add("readFile", "the bytes are a copy: changing them changes nothing", [N.readBytes], (t) => {
  t.put("f", bytesOf(1, 2, 3));
  const first = t.fs.readFile(t.p("f"));
  first.fill(0);
  expectBytes(t.fs.readFile(t.p("f")), bytesOf(1, 2, 3));
});

add("readFile", "byte-order marks, CR LF and NUL come back verbatim", [N.readBytes, N.listedRead], (t) => {
  const data = bytesOf(0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e, 0x0d, 0x0a, 0x00, 0xff, 0xfe, 0x3c, 0x00);
  t.put("bom.xml", data);
  expectBytes(t.fs.readFile(t.p("bom.xml")), data);
});

add("readFile", "text is what the bytes say: UTF-8 multi-byte characters survive", [N.readBytes], (t) => {
  const text = "é — 日本語 😀 \u0000 end";
  t.put("utf8.txt", text);
  expect(t.text("utf8.txt")).toBe(text);
});

add("readFile", "reads the file as it is now, after an overwrite", [N.readBytes], (t) => {
  t.put("f", "one");
  expect(t.text("f")).toBe("one");
  t.put("f", "two");
  expect(t.text("f")).toBe("two");
});

// --------------------------------------------------------------------------------------------------------------- exists

add("exists", "is true for a file", [N.translateExists], (t) => {
  t.put("f", "x");
  expect(t.fs.exists(t.p("f"))).toBe(true);
});

add("exists", "is true for a folder, empty or not", [N.translateExists], (t) => {
  t.mkdir("empty");
  t.mkdirs("full/sub");
  expect(t.fs.exists(t.p("empty"))).toBe(true);
  expect(t.fs.exists(t.p("full"))).toBe(true);
  expect(t.fs.exists(t.root)).toBe(true);
});

add("exists", "is false for a missing path, and does not throw", [N.translateExists], (t) => {
  expect(t.fs.exists(t.p("missing"))).toBe(false);
  expect(t.fs.exists(t.p("no/such/folder/x"))).toBe(false);
});

add("exists", "is false below a file, and does not throw (ENOTDIR)", [N.translateExists], (t) => {
  t.put("f", "x");
  expect(t.fs.exists(t.p("f/below"))).toBe(false);
});

add("exists", "is false for the empty path", [N.translateExists], (t) => {
  expect(t.fs.exists("")).toBe(false);
});

add("exists", "is false once the path is removed", [N.translateExists], (t) => {
  t.put("f", "x");
  t.fs.rm(t.p("f"), { recursive: false });
  expect(t.fs.exists(t.p("f"))).toBe(false);
});

add("exists", "is true for a link whose target is there and false when it is not", [N.translateExists], (t) => {
  t.put("f", "x");
  t.symlinkTo?.(t.p("f"), t.p("ok"));
  t.symlinkTo?.(t.p("nothing"), t.p("dangling"));
  expect(t.fs.exists(t.p("ok"))).toBe(true);
  expect(t.fs.exists(t.p("dangling"))).toBe(false);
}, "symlink");

// ------------------------------------------------------------------------------------------------------------------ rm

add("rm", "removes a file", [N.rm], (t) => {
  t.put("gone.txt", "x");
  expect(t.fs.rm(t.p("gone.txt"), { recursive: false })).toBeUndefined();
  expect(t.fs.exists(t.p("gone.txt"))).toBe(false);
});

add("rm", "removes a file with recursive set, too", [N.rm], (t) => {
  t.put("gone.txt", "x");
  t.fs.rm(t.p("gone.txt"), { recursive: true });
  expect(t.fs.exists(t.p("gone.txt"))).toBe(false);
});

add("rm", "removes a folder and everything in it when recursive", [N.rm], (t) => {
  t.mkdirs("tree/a/b");
  t.put("tree/a/b/c.txt", "x");
  t.put("tree/a/d.txt", "x");
  t.put("tree/top.txt", "x");
  t.mkdir("tree/empty");
  t.fs.rm(t.p("tree"), { recursive: true });
  expect(t.fs.exists(t.p("tree"))).toBe(false);
  expect(t.names()).toEqual([]);
});

add("rm", "removes an empty folder when recursive", [N.rm], (t) => {
  t.mkdir("e");
  t.fs.rm(t.p("e"), { recursive: true });
  expect(t.fs.exists(t.p("e"))).toBe(false);
});

add("rm", "removes a tree fifty folders deep", [N.rm], (t) => {
  const path = Array.from({ length: 50 }, (_, index) => `d${index}`).join("/");
  t.mkdirs(path);
  t.put(`${path}/leaf`, "x");
  t.fs.rm(t.p("d0"), { recursive: true });
  expect(t.names()).toEqual([]);
});

add("rm", "a missing path is ENOENT, recursive or not (there is no force)", [N.rm], (t) => {
  expect(t.code(() => t.fs.rm(t.p("missing"), { recursive: false }))).toBe("ENOENT");
  expect(t.code(() => t.fs.rm(t.p("missing"), { recursive: true }))).toBe("ENOENT");
});

add("rm", "a path through a file is ENOTDIR", [N.rm], (t) => {
  t.put("f", "x");
  expect(t.code(() => t.fs.rm(t.p("f/x"), { recursive: false }))).toBe("ENOTDIR");
  expect(t.text("f")).toBe("x");
}, "enotdir");

add("rm", "a non-empty folder without recursive is an error and nothing is removed", [N.rm], (t) => {
  t.mkdirs("full/sub");
  t.put("full/f.txt", "x");
  expect(t.code(() => t.fs.rm(t.p("full"), { recursive: false }))).toBeTypeOf("string");
  expect(t.names("full")).toEqual(["f.txt", "sub"]);
  expect(t.text("full/f.txt")).toBe("x");
});

// Node's rmSync refuses a folder without `recursive` before it looks inside (ERR_FS_EISDIR), so the empty folder fails as well.
add("rm", "an empty folder without recursive is an error too, as Node's rmSync has it", [N.rm], (t) => {
  t.mkdir("e");
  expect(t.code(() => t.fs.rm(t.p("e"), { recursive: false }))).toBeTypeOf("string");
  expect(t.fs.stat(t.p("e"))).toEqual(FOLDER);
});

add("rm", "touches neither the siblings nor the parent", [N.rm], (t) => {
  t.mkdirs("parent/a");
  t.put("parent/a/x", "x");
  t.put("parent/b", "keep");
  t.mkdir("parent/c");
  t.fs.rm(t.p("parent/a"), { recursive: true });
  expect(t.names("parent")).toEqual(["b", "c"]);
  expect(t.text("parent/b")).toBe("keep");
});

add("rm", "a removed name can be created again, as a file or as a folder", [N.rm, N.mkdir], (t) => {
  t.put("n", "file");
  t.fs.rm(t.p("n"), { recursive: false });
  t.mkdir("n");
  expect(t.fs.stat(t.p("n"))).toEqual(FOLDER);
  t.fs.rm(t.p("n"), { recursive: true });
  t.put("n", "file again");
  expect(t.text("n")).toBe("file again");
});

add("rm", "removes a link and not what it points to", [N.rm], (t) => {
  t.put("f", "x");
  t.mkdirs("d");
  t.put("d/inner", "x");
  t.symlinkTo?.(t.p("f"), t.p("ln-file"));
  t.symlinkTo?.(t.p("d"), t.p("ln-dir"));
  t.fs.rm(t.p("ln-file"), { recursive: false });
  t.fs.rm(t.p("ln-dir"), { recursive: true });
  expect(t.names()).toEqual(["d", "f"]);
  expect(t.text("d/inner")).toBe("x");
}, "symlink");

// ------------------------------------------------------------------------------------------------------------ openAppend

function append(t: Context, rel: string, ...chunks: Uint8Array[]): void {
  const handle = t.fs.openAppend(t.p(rel));
  try {
    for (const chunk of chunks) handle.write(chunk);
  } finally {
    handle.close();
  }
}

add("openAppend", "creates the file when it is not there", [N.logOpen], (t) => {
  t.fs.openAppend(t.p("log.txt")).close();
  expect(t.fs.stat(t.p("log.txt"))).toEqual(FILE);
  expect(t.fs.readFile(t.p("log.txt")).length).toBe(0);
});

add("openAppend", "appends each write after the one before, in one handle", [N.logOpen], (t) => {
  append(t, "log.txt", encoder.encode("one\r\n"), new Uint8Array(0), encoder.encode("two\r\n"));
  expect(t.text("log.txt")).toBe("one\r\ntwo\r\n");
});

add("openAppend", "appends across two handles opened one after the other", [N.logOpen], (t) => {
  append(t, "log.txt", encoder.encode("first;"));
  append(t, "log.txt", encoder.encode("second;"));
  append(t, "log.txt", encoder.encode("third"));
  expect(t.text("log.txt")).toBe("first;second;third");
});

add("openAppend", "appends to a file that was written before, and does not truncate it", [N.logOpen], (t) => {
  t.put("log.txt", "before\n");
  append(t, "log.txt", encoder.encode("after\n"));
  expect(t.text("log.txt")).toBe("before\nafter\n");
});

add("openAppend", "the content is there once the handle is closed", [N.logOpen], (t) => {
  const handle = t.fs.openAppend(t.p("log.txt"));
  handle.write(encoder.encode("abc"));
  handle.close();
  expectBytes(t.fs.readFile(t.p("log.txt")), encoder.encode("abc"));
});

add("openAppend", "a zero-length write changes nothing", [N.logOpen], (t) => {
  append(t, "log.txt", encoder.encode("a"), new Uint8Array(0), new Uint8Array(0));
  expect(t.text("log.txt")).toBe("a");
});

add("openAppend", "writes bytes, not text: every byte value comes back", [N.logOpen], (t) => {
  append(t, "log.bin", everyByte());
  expectBytes(t.fs.readFile(t.p("log.bin")), everyByte());
});

add("openAppend", "writes four megabytes in one write, all of them", [N.logOpen], (t) => {
  const big = Uint8Array.from({ length: 4 * 1024 * 1024 }, (_, index) => (index * 7 + 3) & 0xff);
  append(t, "big.log", big);
  expectBytes(t.fs.readFile(t.p("big.log")), big);
});

add("openAppend", "does not keep the caller's array", [N.logOpen], (t) => {
  const data = bytesOf(1, 2, 3);
  const handle = t.fs.openAppend(t.p("log.bin"));
  handle.write(data);
  data.fill(9);
  handle.close();
  expectBytes(t.fs.readFile(t.p("log.bin")), bytesOf(1, 2, 3));
});

add("openAppend", "a missing folder is ENOENT", [N.logOpen], (t) => {
  expect(t.code(() => t.fs.openAppend(t.p("missing/log")))).toBe("ENOENT");
  expect(t.fs.exists(t.p("missing"))).toBe(false);
});

add("openAppend", "a folder is EISDIR (EPERM where the host says so)", [N.logOpen], (t) => {
  t.mkdir("d");
  expect(t.code(() => t.fs.openAppend(t.p("d")))).toMatch(/^(EISDIR|EPERM)$/);
});

add("openAppend", "a path through a file is ENOTDIR", [N.logOpen], (t) => {
  t.put("f", "x");
  expect(t.code(() => t.fs.openAppend(t.p("f/log")))).toBe("ENOTDIR");
}, "enotdir");

add("openAppend", "a file that was appended to can be removed and made again empty", [N.logOpen, N.rm], (t) => {
  append(t, "log.txt", encoder.encode("old"));
  t.fs.rm(t.p("log.txt"), { recursive: false });
  append(t, "log.txt", encoder.encode("new"));
  expect(t.text("log.txt")).toBe("new");
});

// ----------------------------------------------------------------------------------------------------------------- paths

const NFC = "café";
const NFD = "café";

add("paths", "a name with spaces", [N.lookupStat, N.volumeWrite], (t) => {
  t.put("a b  c.xml", "x");
  t.mkdir("my dir");
  t.put("my dir/in side.xml", "y");
  expect(t.text("my dir/in side.xml")).toBe("y");
  expect(t.names()).toEqual(["a b  c.xml", "my dir"]);
});

add("paths", "a name with a leading space", [N.lookupStat], (t) => {
  t.put(" lead", "x");
  expect(t.names()).toEqual([" lead"]);
  expect(t.fs.exists(t.p("lead"))).toBe(false);
});

add("paths", "names of dots that are not . or .. are names like any other", [N.lookupStat, N.listEntries], (t) => {
  t.put(".hidden", "1");
  t.put("..a", "2");
  t.put(".a.b", "3");
  expect(t.names()).toEqual(["..a", ".a.b", ".hidden"]);
  expect(t.text("..a")).toBe("2");
});

add("paths", "a name ending in a dot is not the name without it", [N.lookupStat, N.lookupList], (t) => {
  t.put("a.", "dot");
  t.put("a", "plain");
  expect(t.names()).toEqual(["a", "a."]);
  expect(t.text("a.")).toBe("dot");
  expect(t.text("a")).toBe("plain");
}, "trailing");

add("paths", "a name made of three dots", [N.lookupStat], (t) => {
  t.put("...", "x");
  expect(t.names()).toEqual(["..."]);
}, "trailing");

add("paths", "a name ending in a space is not the name without it", [N.lookupStat, N.lookupList], (t) => {
  t.put("a ", "space");
  t.put("a", "plain");
  expect(t.names()).toEqual(["a", "a "]);
  expect(t.text("a ")).toBe("space");
}, "trailing");

add("paths", "a folder name ending in a dot, and a file in it", [N.lookupStat, N.mkdir], (t) => {
  t.mkdir("dir.");
  t.put("dir./f.xml", "x");
  expect(t.names()).toEqual(["dir."]);
  expect(t.names("dir.")).toEqual(["f.xml"]);
}, "trailing");

add("paths", "é as one code point (NFC) and as two (NFD) are two different names", [N.lookupStat, N.lookupList], (t) => {
  t.put(NFC, "composed");
  t.put(NFD, "decomposed");
  expect(t.names()).toEqual([NFD, NFC].sort());
  expect(t.text(NFC)).toBe("composed");
  expect(t.text(NFD)).toBe("decomposed");
}, "normalization");

add("paths", "a name comes back with the code points it was created with", [N.lookupList, N.listEntries], (t) => {
  t.put(NFC, "x");
  const [only] = t.names();
  expect(only).toBe(NFC);
  expect([...(only ?? "")].map((c) => c.codePointAt(0))).toEqual([0x63, 0x61, 0x66, 0xe9]);
});

add("paths", "a decomposed name comes back decomposed", [N.lookupList, N.listEntries], (t) => {
  t.put(NFD, "x");
  const [only] = t.names();
  expect(only).toBe(NFD);
  expect(only?.length).toBe(5);
}, "normalization");

add("paths", "names outside the BMP, CJK and right-to-left text", [N.lookupStat, N.listEntries], (t) => {
  const names = ["😀.xml", "日本語.xml", "עברית.xml", "ñandú", "Ünï"];
  for (const name of names) t.put(name, name);
  expect(t.names()).toEqual([...names].sort());
  for (const name of names) expect(t.text(name)).toBe(name);
});

add("paths", "characters that mean something elsewhere are plain characters here", [N.lookupStat, N.listEntries], (t) => {
  const names = ["a%20b", "a#b", "a&b", "a'b", "a;b", "a(b)", "a[b]", "a{b}", "a~b", "a+b", "a=b", "a,b", "a@b", "a!b", "a$b"];
  for (const name of names) t.put(name, name);
  expect(t.names()).toEqual([...names].sort());
  expect(t.fs.exists(t.p("a b"))).toBe(false);
  for (const name of names) expect(t.text(name)).toBe(name);
});

add("paths", "a name of 255 characters", [N.volumeWrite, N.lookupStat], (t) => {
  const name = `${"n".repeat(251)}.xml`;
  expect(name.length).toBe(255);
  t.put(name, "x");
  expect(t.names()).toEqual([name]);
  expect(t.text(name)).toBe("x");
  t.fs.rm(t.p(name), { recursive: false });
  expect(t.names()).toEqual([]);
}, "longName");

add("paths", "a folder name of 255 characters", [N.mkdir], (t) => {
  const name = "d".repeat(255);
  t.mkdir(name);
  t.put(`${name}/f`, "x");
  expect(t.names(name)).toEqual(["f"]);
}, "longName");

add("paths", "an absolute path of 4 095 characters (PATH_MAX 4 096 with its terminator)", [N.volumeWrite, N.mkdir], (t) => {
  const { dirs, file } = longPathUnder(t.root);
  let relative = "";
  for (const dir of dirs) {
    relative = relative === "" ? dir : `${relative}/${dir}`;
    t.mkdir(relative);
  }
  const full = t.p(relative === "" ? file : `${relative}/${file}`);
  expect(full.length).toBe(4095);
  t.fs.writeFile(full, bytesOf(7, 8, 9));
  expectBytes(t.fs.readFile(full), bytesOf(7, 8, 9));
  expect(t.fs.stat(full)).toEqual(FILE);
  expect(t.fs.exists(full)).toBe(true);
  if (dirs.length > 0) expect(t.names(relative)).toEqual([file]);
  t.fs.rm(t.p(dirs[0] ?? file), { recursive: true });
  expect(t.names()).toEqual([]);
}, "longPath");

add("paths", "a tree one hundred folders deep", [N.mkdir, N.lookupStat], (t) => {
  const path = Array.from({ length: 100 }, (_, index) => `n${index}`).join("/");
  t.mkdirs(path);
  t.put(`${path}/leaf.xml`, "deep");
  expect(t.text(`${path}/leaf.xml`)).toBe("deep");
  expect(t.fs.stat(t.p(path))).toEqual(FOLDER);
});

add("paths", "the same name in two folders is two files", [N.lookupStat], (t) => {
  t.mkdir("a");
  t.mkdir("b");
  t.put("a/same.xml", "in a");
  t.put("b/same.xml", "in b");
  expect(t.text("a/same.xml")).toBe("in a");
  expect(t.text("b/same.xml")).toBe("in b");
});

// ------------------------------------------------------------------------------------------------------------------ case

add("case", "A and a are two files, each with its own content", [N.lookupStat, N.lookupList], (t) => {
  t.put("A", "upper");
  t.put("a", "lower");
  expect(t.names()).toEqual(["A", "a"]);
  expect(t.text("A")).toBe("upper");
  expect(t.text("a")).toBe("lower");
}, "caseSensitive");

add("case", "A and a are two folders", [N.lookupStat, N.mkdir], (t) => {
  t.mkdir("D");
  t.mkdir("d");
  t.put("D/x", "in D");
  expect(t.names()).toEqual(["D", "d"]);
  expect(t.names("d")).toEqual([]);
  expect(t.names("D")).toEqual(["x"]);
}, "caseSensitive");

add("case", "a file and a folder can differ only in case", [N.lookupStat], (t) => {
  t.put("Name", "file");
  t.mkdir("name");
  expect(t.fs.stat(t.p("Name"))).toEqual(FILE);
  expect(t.fs.stat(t.p("name"))).toEqual(FOLDER);
}, "caseSensitive");

add("case", "a spelling in another case is a missing path (the layer then searches the folder, EXP-420)", [N.lookupStat, N.lookupList], (t) => {
  t.put("Report.XML", "x");
  expect(t.code(() => t.fs.stat(t.p("report.xml")))).toBe("ENOENT");
  expect(t.fs.exists(t.p("report.xml"))).toBe(false);
  expect(t.code(() => t.fs.readFile(t.p("REPORT.xml")))).toBe("ENOENT");
  expect(t.fs.readdir(t.root).map((entry) => entry.name)).toEqual(["Report.XML"]);
}, "caseSensitive");

add("case", "mkdir of d succeeds while D is there", [N.mkdir], (t) => {
  t.mkdir("D");
  t.mkdir("d");
  expect(t.names()).toEqual(["D", "d"]);
}, "caseSensitive");

add("case", "rm of one spelling leaves the other", [N.rm], (t) => {
  t.put("A", "upper");
  t.put("a", "lower");
  t.fs.rm(t.p("A"), { recursive: false });
  expect(t.names()).toEqual(["a"]);
  expect(t.text("a")).toBe("lower");
}, "caseSensitive");

add("case", "an append to one spelling does not reach the other", [N.logOpen], (t) => {
  t.put("L", "upper;");
  t.put("l", "lower;");
  append(t, "L", encoder.encode("more"));
  expect(t.text("L")).toBe("upper;more");
  expect(t.text("l")).toBe("lower;");
}, "caseSensitive");

add("case", "the extension's case is part of the name: a.xml and a.XML", [N.listEntries], (t) => {
  t.put("a.xml", "lower");
  t.put("a.XML", "upper");
  expect(t.names()).toEqual(["a.XML", "a.xml"]);
}, "caseSensitive");

// ------------------------------------------------------------------------------------ the layer's own sequences, end to end

add("layer", "the lookup of windows-fs: stat misses, a listing finds the fold-equal name, stat says what it is", [N.lookupStat, N.lookupList, N.lookupFoundStat], (t) => {
  t.mkdir("Output");
  t.put("Output/Item.XML", "x");
  expect(t.code(() => t.fs.stat(t.p("output")))).toBe("ENOENT");
  const listed = t.fs.readdir(t.root).map((entry) => entry.name);
  expect(listed).toEqual(["Output"]);
  expect(t.fs.stat(t.p("Output"))).toEqual(FOLDER);
}, "caseSensitive");

add("layer", "the folder walk of an export: mkdir each level, tolerate EEXIST, write the file, read it back", [N.mkdir, N.volumeWrite, N.readBytes], (t) => {
  for (const level of ["Pkg", "Pkg/Methods", "Pkg/Methods/Sub"]) {
    try {
      t.mkdir(level);
    } catch (error) {
      expect((error as HostFsError).code).toBe("EEXIST");
    }
  }
  expect(t.code(() => t.mkdir("Pkg/Methods"))).toBe("EEXIST");
  t.put("Pkg/Methods/Sub/m.xml", "<m/>");
  expect(t.text("Pkg/Methods/Sub/m.xml")).toBe("<m/>");
});

add("layer", "the package listing of an import: readdir, then stat of each entry, folders apart from files", [N.listEntries, N.linkIsDirectory, N.linkIsFile], (t) => {
  t.mkdir("Pkg");
  t.mkdir("Pkg/ItemType");
  t.mkdir("Pkg/Form");
  t.put("Pkg/imports.mf", "<mf/>");
  t.put("Pkg/readme.txt", "x");
  const entries = t.fs.readdir(t.p("Pkg"));
  const folders = entries.filter((entry) => t.fs.stat(t.p(`Pkg/${entry.name}`)).isDirectory).map((entry) => entry.name).sort();
  const files = entries.filter((entry) => t.fs.stat(t.p(`Pkg/${entry.name}`)).isFile).map((entry) => entry.name).sort();
  expect(folders).toEqual(["Form", "ItemType"]);
  expect(files).toEqual(["imports.mf", "readme.txt"]);
  expect(entries.every((entry) => entry.isFile !== entry.isDirectory)).toBe(true);
});

add("layer", "the run log: two handles one after the other, read back through readFile", [N.logOpen, N.readBytes], (t) => {
  t.mkdir("logs");
  append(t, "logs/run.log", encoder.encode("line 1\r\n"), encoder.encode("line 2\r\n"));
  append(t, "logs/run.log", encoder.encode("line 3\r\n"));
  expect(t.text("logs/run.log")).toBe("line 1\r\nline 2\r\nline 3\r\n");
  expect(t.names("logs")).toEqual(["run.log"]);
});

add("layer", "the translation of a failed read: ENOENT, then exists() of the folder tells a missing file from a missing folder", [N.readBytes, N.translateExists], (t) => {
  t.mkdir("here");
  expect(t.code(() => t.fs.readFile(t.p("here/missing.xml")))).toBe("ENOENT");
  expect(t.fs.exists(t.p("here"))).toBe(true);
  expect(t.code(() => t.fs.readFile(t.p("gone/missing.xml")))).toBe("ENOENT");
  expect(t.fs.exists(t.p("gone"))).toBe(false);
});

add("layer", "delete and rewrite: directoryDelete of an output folder, then the same folder is written again", [N.rm, N.mkdir, N.volumeWrite], (t) => {
  t.mkdirs("out/Methods");
  t.put("out/Methods/a.xml", "1");
  t.fs.rm(t.p("out"), { recursive: true });
  t.mkdirs("out/Methods");
  t.put("out/Methods/a.xml", "2");
  expect(t.names("out/Methods")).toEqual(["a.xml"]);
  expect(t.text("out/Methods/a.xml")).toBe("2");
});

// ----------------------------------------------------------------------------------------------------------------- probe

/** Whether the host can do what each `optional` case needs, found by trying it on a fresh fixture. */
export function probeCapabilities(makeFs: HostFsFactory): Record<Capability, boolean> {
  const fixture = makeFs();
  const t = new Context(fixture);
  const attempt = (action: () => boolean): boolean => {
    try {
      return action();
    } catch {
      return false;
    }
  };
  try {
    return {
      symlink: attempt(() => {
        if (t.symlinkTo === undefined) return false;
        t.put("probe-target", "x");
        t.symlinkTo(t.p("probe-target"), t.p("probe-link"));
        return t.fs.stat(t.p("probe-link")).isFile && t.fs.readdir(t.root).some((entry) => entry.name === "probe-link" && entry.isSymbolicLink);
      }),
      enotdir: attempt(() => {
        t.put("probe-file", "x");
        return t.code(() => t.fs.stat(t.p("probe-file/below"))) === "ENOTDIR";
      }),
      caseSensitive: attempt(() => {
        t.put("CaseProbe", "upper");
        t.put("caseprobe", "lower");
        return t.names().filter((name) => name.toLowerCase() === "caseprobe").length === 2 && t.text("CaseProbe") === "upper";
      }),
      normalization: attempt(() => {
        t.put(NFC, "composed");
        t.put(NFD, "decomposed");
        const names = t.names();
        return names.includes(NFC) && names.includes(NFD) && t.text(NFC) === "composed" && t.text(NFD) === "decomposed";
      }),
      trailing: attempt(() => {
        t.put("dots.", "dot");
        t.put("dots", "plain");
        t.put("space ", "space");
        t.put("...", "dots");
        const names = t.names();
        return ["dots.", "dots", "space ", "..."].every((name) => names.includes(name));
      }),
      longName: attempt(() => {
        const name = "n".repeat(255);
        t.put(name, "x");
        return t.names().includes(name);
      }),
      longPath: attempt(() => {
        const { dirs, file } = longPathUnder(t.root);
        let relative = "";
        for (const dir of dirs) {
          relative = relative === "" ? dir : `${relative}/${dir}`;
          t.mkdir(relative);
        }
        const full = t.p(relative === "" ? file : `${relative}/${file}`);
        t.fs.writeFile(full, bytesOf(1));
        return t.fs.readFile(full).length === 1;
      }),
    };
  } finally {
    fixture.dispose?.();
  }
}

// ------------------------------------------------------------------------------------------------------------------ run

/**
 * Runs the whole suite against the file system `makeFs` makes (HOST-214). A case marked `optional` is skipped when the probe
 * (once, at collection) finds the host unable to do what it needs: the probe tries the thing on the real host, so a laptop on
 * a case-insensitive disk skips the case-sensitivity cases, and a host that cannot hold a 4 095-character path skips that one.
 *
 * @spec HOST-214
 */
export function describeHostFs(name: string, makeFs: HostFsFactory): void {
  const capabilities = probeCapabilities(makeFs);
  describe(`HostFs conformance: ${name} (HOST-214)`, () => {
    let fixture: HostFsFixture;
    let context: Context;
    beforeEach(() => {
      fixture = makeFs();
      context = new Context(fixture);
    });
    afterEach(() => {
      fixture.dispose?.();
    });
    for (const group of [...new Set(cases.map((c) => c.group))]) {
      describe(group, () => {
        for (const c of cases.filter((candidate) => candidate.group === group)) {
          it.skipIf(c.optional !== undefined && !capabilities[c.optional])(c.name, () => c.run(context));
        }
      });
    }
  });
}
