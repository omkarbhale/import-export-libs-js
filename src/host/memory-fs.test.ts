import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DirectoryNotFoundException, FileNotFoundException, UnauthorizedAccessException } from "../io/errors.js";
import { readFileBytes, translateFileError, writeFileBytes } from "../io/host-path.js";
import { MemoryVfs } from "./memory-fs.js";
import type { HostFsError } from "./types.js";

/**
 * The parts of `MemoryVfs` that the conformance suite (HOST-214) does not pin: what it offers beyond `HostFs`, the capacity, the
 * current directory, the account of bytes, and how the file layer sees its errors (HOST-215).
 *
 * @spec HOST-201 HOST-215
 */
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const codeOf = (action: () => unknown): HostFsError => {
  try {
    action();
  } catch (error) {
    return error as HostFsError;
  }
  throw new Error("expected the call to throw");
};

describe("MemoryVfs: construction and mount (HOST-215)", () => {
  it("is empty at the start: the root exists, and nothing is in it", () => {
    const fs = new MemoryVfs();
    expect(fs.stat("/")).toEqual({ isFile: false, isDirectory: true });
    expect(fs.readdir("/")).toEqual([]);
    expect(fs.size).toBe(0);
    expect(fs.toTree()).toEqual([]);
    expect([...fs.snapshot()]).toEqual([]);
  });

  it("takes the files of the constructor, strings as UTF-8, with their folders made", () => {
    const fs = new MemoryVfs({ "/pkg/Methods/a.xml": "<a/>", "/pkg/b.bin": Uint8Array.of(0, 255, 7), "/pkg/empty/": "" });
    expect(text(fs.readFile("/pkg/Methods/a.xml"))).toBe("<a/>");
    expect([...fs.readFile("/pkg/b.bin")]).toEqual([0, 255, 7]);
    expect(fs.stat("/pkg/empty")).toEqual({ isFile: false, isDirectory: true });
    expect(fs.size).toBe(4 + 3);
  });

  it("writes a string as UTF-8, with astral characters and no byte-order mark", () => {
    const fs = new MemoryVfs({ "/a": "é𝄞" });
    expect([...fs.readFile("/a")]).toEqual([0xc3, 0xa9, 0xf0, 0x9d, 0x84, 0x9e]);
  });

  it("mount replaces a file that is there, and merges into a folder that is there", () => {
    const fs = new MemoryVfs({ "/d/a": "1", "/d/b": "2" });
    fs.mount({ "/d/a": "three", "/d/c": "4" });
    expect(fs.toTree()).toEqual(["d/", "d/a", "d/b", "d/c"]);
    expect(text(fs.readFile("/d/a"))).toBe("three");
    expect(fs.size).toBe(5 + 1 + 1);
  });

  it("mount fails like the call that failed: a file in the way of a folder is ENOTDIR, a folder in the way of a file is EISDIR", () => {
    const fs = new MemoryVfs({ "/f": "x", "/d/e": "y" });
    expect(codeOf(() => fs.mount({ "/f/g": "z" })).code).toBe("ENOTDIR");
    expect(codeOf(() => fs.mount({ "/d": "z" })).code).toBe("EISDIR");
    expect(() => fs.mount({ "/n/": "not empty" })).toThrow(TypeError);
  });

  it("mount makes relative paths against cwd", () => {
    const fs = new MemoryVfs({ "rel/a.txt": "x" }, { cwd: "/base" });
    expect(fs.toTree()).toEqual(["base/", "base/rel/", "base/rel/a.txt"]);
  });

  it("is only memory: two trees share nothing", () => {
    const a = new MemoryVfs({ "/x": "a" });
    const b = new MemoryVfs();
    expect(b.exists("/x")).toBe(false);
    a.writeFile("/y", Uint8Array.of(1));
    expect(b.exists("/y")).toBe(false);
  });
});

describe("MemoryVfs: cwd (HOST-215)", () => {
  it("resolves a relative path against the current directory, `.` and `..` included", () => {
    const fs = new MemoryVfs({ "/work/pkg/a.xml": "a", "/other/b.xml": "b" }, { cwd: "/work" });
    expect(text(fs.readFile("pkg/a.xml"))).toBe("a");
    expect(text(fs.readFile("./pkg/../pkg/a.xml"))).toBe("a");
    expect(text(fs.readFile("../other/b.xml"))).toBe("b");
    expect(text(fs.readFile("/work/pkg//a.xml"))).toBe("a");
    expect(fs.exists("pkg")).toBe(true);
    expect(fs.exists("/pkg")).toBe(false);
  });

  it("defaults to the root, where `..` stays", () => {
    const fs = new MemoryVfs({ "/a": "x" });
    expect(fs.cwd).toBe("/");
    expect(text(fs.readFile("a"))).toBe("x");
    expect(text(fs.readFile("../../a"))).toBe("x");
  });

  it("does not need the current directory to exist, and a relative one is refused", () => {
    expect(codeOf(() => new MemoryVfs(undefined, { cwd: "/nowhere" }).readFile("a")).code).toBe("ENOENT");
    expect(() => new MemoryVfs(undefined, { cwd: "rel" })).toThrow(TypeError);
  });

  it("the empty path is no path: ENOENT, and not the current directory", () => {
    const fs = new MemoryVfs({ "/a": "x" });
    expect(fs.exists("")).toBe(false);
    expect(codeOf(() => fs.stat("")).code).toBe("ENOENT");
    expect(codeOf(() => fs.writeFile("", new Uint8Array(0))).code).toBe("ENOENT");
  });

  it("the root is a folder that cannot be written, made or removed", () => {
    const fs = new MemoryVfs({ "/a": "x" });
    expect(codeOf(() => fs.writeFile("/", new Uint8Array(0))).code).toBe("EISDIR");
    expect(codeOf(() => fs.mkdir("/")).code).toBe("EEXIST");
    expect(codeOf(() => fs.rm("/", { recursive: true })).code).toBe("EPERM");
    expect(fs.exists("/a")).toBe(true);
  });
});

describe("MemoryVfs: snapshot and toTree (HOST-215)", () => {
  const files = {
    "/out/Methods/b.xml": "b",
    "/out/Methods/a.xml": "a",
    "/out/Forms/f.xml": "f",
    "/out/Forms/empty/": "",
    "/out/imports.mf": "mf",
    "/out/deep/er/est/z.xml": "z",
    "/other/o.txt": "o",
  };

  it("snapshot is every file under a folder, by its path relative to it with `/`, in code unit order", () => {
    const fs = new MemoryVfs(files);
    const snapshot = fs.snapshot("/out");
    expect([...snapshot.keys()]).toEqual(["Forms/f.xml", "Methods/a.xml", "Methods/b.xml", "deep/er/est/z.xml", "imports.mf"]);
    expect(text(snapshot.get("Methods/b.xml") ?? new Uint8Array())).toBe("b");
    expect([...fs.snapshot().keys()]).toContain("other/o.txt");
    expect([...fs.snapshot().keys()]).toHaveLength(6);
  });

  it("snapshot of a relative folder resolves against cwd, and of a missing folder or a file is an error", () => {
    const fs = new MemoryVfs(files, { cwd: "/out" });
    expect([...fs.snapshot("Methods").keys()]).toEqual(["a.xml", "b.xml"]);
    expect(codeOf(() => fs.snapshot("/nope")).code).toBe("ENOENT");
    expect(codeOf(() => fs.snapshot("/out/imports.mf")).code).toBe("ENOTDIR");
  });

  it("snapshot hands out copies, so changing one changes nothing in the tree", () => {
    const fs = new MemoryVfs({ "/a": "abc" });
    const bytes = fs.snapshot().get("a");
    bytes?.fill(0);
    expect(text(fs.readFile("/a"))).toBe("abc");
  });

  it("toTree lists the files and the folders that have a file below them, sorted, folders with a trailing `/`", () => {
    const fs = new MemoryVfs(files);
    expect(fs.toTree("/out")).toEqual([
      "Forms/",
      "Forms/f.xml",
      "Methods/",
      "Methods/a.xml",
      "Methods/b.xml",
      "deep/",
      "deep/er/",
      "deep/er/est/",
      "deep/er/est/z.xml",
      "imports.mf",
    ]);
    expect(fs.toTree()).toContain("out/Forms/f.xml");
  });

  it("toTree leaves out a folder with no file in it, and a folder with only empty folders in it", () => {
    const fs = new MemoryVfs({ "/a/b/c/": "", "/a/d/": "", "/e/f.txt": "x" });
    expect(fs.toTree()).toEqual(["e/", "e/f.txt"]);
  });

  it("toTree has the format of the replay tests' `tree()` of the same files on a disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "libsjs-memfs-tree-"));
    try {
      const fs = new MemoryVfs(files);
      for (const [path, content] of Object.entries(files)) {
        if (!path.startsWith("/out/")) continue;
        const target = join(dir, path.slice("/out/".length));
        mkdirSync(join(target, path.endsWith("/") ? "" : ".."), { recursive: true });
        if (!path.endsWith("/")) writeFileSync(target, content);
      }
      expect(fs.toTree("/out")).toEqual(diskTree(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** `tree()` of `src/export/run-replay.test.ts`, which the replay tests compare an output folder with. */
function diskTree(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${prefix}${entry.name}`;
      if (!entry.isDirectory()) return [path];
      const below = diskTree(root, `${path}/`);
      return below.length > 0 ? [`${path}/`, ...below] : [];
    })
    .sort();
}

describe("MemoryVfs: capacity and size (HOST-215)", () => {
  it("size is the bytes of every file, through creates, replaces, appends, removals and clear", () => {
    const fs = new MemoryVfs();
    fs.writeFile("/a", new Uint8Array(10));
    fs.writeFile("/b", new Uint8Array(5));
    expect(fs.size).toBe(15);
    fs.writeFile("/a", new Uint8Array(3));
    expect(fs.size).toBe(8);
    const handle = fs.openAppend("/b");
    handle.write(new Uint8Array(4));
    expect(fs.size).toBe(8);
    handle.close();
    expect(fs.size).toBe(12);
    fs.mkdir("/d");
    fs.writeFile("/d/x", new Uint8Array(100));
    expect(fs.size).toBe(112);
    fs.rm("/d", { recursive: true });
    expect(fs.size).toBe(12);
    fs.rm("/a", { recursive: false });
    expect(fs.size).toBe(9);
    fs.clear();
    expect(fs.size).toBe(0);
    expect(fs.readdir("/")).toEqual([]);
  });

  it("writing past maxBytes throws ENOSPC and changes nothing", () => {
    const fs = new MemoryVfs({ "/a": "12345" }, { maxBytes: 10 });
    expect(codeOf(() => fs.writeFile("/b", new Uint8Array(6))).code).toBe("ENOSPC");
    expect(fs.exists("/b")).toBe(false);
    expect(codeOf(() => fs.writeFile("/a", new Uint8Array(11))).code).toBe("ENOSPC");
    expect(text(fs.readFile("/a"))).toBe("12345");
    expect(fs.size).toBe(5);
    fs.writeFile("/b", new Uint8Array(5));
    expect(fs.size).toBe(10);
    fs.writeFile("/a", new Uint8Array(0));
    fs.writeFile("/c", new Uint8Array(5));
    expect(fs.size).toBe(10);
    expect(codeOf(() => fs.writeFile("/d", new Uint8Array(1))).message).toBe("ENOSPC: no space left on device, write '/d'");
  });

  it("a replace that makes the file smaller or the same size is never refused, even at capacity", () => {
    const fs = new MemoryVfs({ "/a": "12345" }, { maxBytes: 5 });
    fs.writeFile("/a", new Uint8Array(5));
    fs.writeFile("/a", new Uint8Array(2));
    expect(fs.size).toBe(2);
  });

  it("an append past maxBytes throws ENOSPC at the write and appends nothing", () => {
    const fs = new MemoryVfs({ "/log": "ab" }, { maxBytes: 6 });
    const handle = fs.openAppend("/log");
    handle.write(Uint8Array.of(99, 99));
    expect(codeOf(() => handle.write(Uint8Array.of(1, 2, 3))).code).toBe("ENOSPC");
    handle.close();
    expect(text(fs.readFile("/log"))).toBe("abcc");
  });

  it("the capacity can be set after the tree is made, and mount obeys it", () => {
    const fs = new MemoryVfs();
    fs.maxBytes = 3;
    expect(codeOf(() => fs.mount({ "/a": "1234" })).code).toBe("ENOSPC");
    expect(fs.exists("/a")).toBe(false);
    fs.maxBytes = Number.POSITIVE_INFINITY;
    fs.mount({ "/a": "1234" });
    expect(fs.size).toBe(4);
  });

  it("a removed file frees its bytes for the next write", () => {
    const fs = new MemoryVfs({ "/a": "1234" }, { maxBytes: 4 });
    fs.rm("/a", { recursive: false });
    fs.writeFile("/b", new Uint8Array(4));
    expect(fs.size).toBe(4);
  });
});

describe("MemoryVfs: append handles (HOST-215)", () => {
  it("buffers the writes and commits them on close, in order, after what the file held", () => {
    const fs = new MemoryVfs({ "/log": "head " });
    const handle = fs.openAppend("/log");
    handle.write(new TextEncoder().encode("one "));
    handle.write(new TextEncoder().encode("two"));
    expect(text(fs.readFile("/log"))).toBe("head ");
    handle.close();
    expect(text(fs.readFile("/log"))).toBe("head one two");
  });

  it("creates the file when it opens, empty", () => {
    const fs = new MemoryVfs();
    const handle = fs.openAppend("/new.log");
    expect(fs.stat("/new.log")).toEqual({ isFile: true, isDirectory: false });
    expect(fs.readFile("/new.log")).toHaveLength(0);
    handle.close();
  });

  it("allows a second handle on a path that one has open; each commits on its own close", () => {
    const fs = new MemoryVfs();
    const first = fs.openAppend("/log");
    const second = fs.openAppend("/log");
    first.write(new TextEncoder().encode("A"));
    second.write(new TextEncoder().encode("B"));
    second.close();
    first.close();
    expect(text(fs.readFile("/log"))).toBe("BA");
  });

  it("copies what is written, so the caller can reuse its array", () => {
    const fs = new MemoryVfs();
    const handle = fs.openAppend("/log");
    const bytes = Uint8Array.of(1, 2, 3);
    handle.write(bytes);
    bytes.fill(9);
    handle.close();
    expect([...fs.readFile("/log")]).toEqual([1, 2, 3]);
  });

  it("a write or a second close after close is EBADF, as a closed file descriptor is", () => {
    const handle = new MemoryVfs().openAppend("/log");
    handle.close();
    expect(codeOf(() => handle.write(Uint8Array.of(1))).code).toBe("EBADF");
    expect(codeOf(() => handle.close()).code).toBe("EBADF");
  });

  it("a handle on a file that was removed appends to nothing, and takes no space", () => {
    const fs = new MemoryVfs();
    const handle = fs.openAppend("/log");
    handle.write(Uint8Array.of(1, 2));
    fs.rm("/log", { recursive: false });
    handle.close();
    expect(fs.exists("/log")).toBe(false);
    expect(fs.size).toBe(0);
  });

  it("a handle stands for the file when the file is rewritten under it", () => {
    const fs = new MemoryVfs({ "/log": "old" });
    const handle = fs.openAppend("/log");
    fs.writeFile("/log", new TextEncoder().encode("new"));
    handle.write(new TextEncoder().encode("!"));
    handle.close();
    expect(text(fs.readFile("/log"))).toBe("new!");
    expect(fs.size).toBe(4);
  });
});

describe("MemoryVfs: bytes are not shared (HOST-215)", () => {
  it("a Buffer view of a larger buffer is written as just its bytes, and read back as a plain Uint8Array", () => {
    const fs = new MemoryVfs();
    const pool = Buffer.from("0123456789");
    fs.writeFile("/a", pool.subarray(2, 5));
    pool.fill(0);
    const read = fs.readFile("/a");
    expect(Buffer.isBuffer(read)).toBe(false);
    expect(text(read)).toBe("234");
    read.fill(0);
    expect(text(fs.readFile("/a"))).toBe("234");
  });
});

describe("MemoryVfs: errors carry what the file layer reads (HOST-201, HOST-215)", () => {
  it("have Node's messages, code, syscall and the path as given", () => {
    const fs = new MemoryVfs({ "/f": "x", "/d/a": "y" });
    const missing = codeOf(() => fs.readFile("/nope"));
    expect(missing.message).toBe("ENOENT: no such file or directory, open '/nope'");
    expect([missing.code, missing.path]).toEqual(["ENOENT", "/nope"]);
    expect(codeOf(() => fs.stat("/f/x")).message).toBe("ENOTDIR: not a directory, stat '/f/x'");
    expect(codeOf(() => fs.readdir("/f")).message).toBe("ENOTDIR: not a directory, scandir '/f'");
    expect(codeOf(() => fs.writeFile("/d", new Uint8Array(0))).message).toBe("EISDIR: illegal operation on a directory, open '/d'");
    expect(codeOf(() => fs.mkdir("/d")).message).toBe("EEXIST: file already exists, mkdir '/d'");
    expect(codeOf(() => fs.mkdir("/x/y")).message).toBe("ENOENT: no such file or directory, mkdir '/x/y'");
    expect(codeOf(() => fs.rm("/d", { recursive: false })).code).toBe("ERR_FS_EISDIR");
    expect(fs.exists("/d/a")).toBe(true);
  });

  it("are the same as nodeFs's for the same failure, member by member", async () => {
    const { nodeFs } = await import("./node-fs.js");
    const dir = mkdtempSync(join(tmpdir(), "libsjs-memfs-errors-"));
    try {
      const memory = new MemoryVfs({ "/f": "x", "/d/a": "y" });
      writeFileSync(join(dir, "f"), "x");
      mkdirSync(join(dir, "d"));
      writeFileSync(join(dir, "d", "a"), "y");
      const failures: Array<[string, (fs: typeof nodeFs, root: string) => unknown]> = [
        ["stat missing", (fs, r) => fs.stat(`${r}/nope`)],
        ["stat below file", (fs, r) => fs.stat(`${r}/f/x`)],
        ["readdir file", (fs, r) => fs.readdir(`${r}/f`)],
        ["readdir missing", (fs, r) => fs.readdir(`${r}/nope`)],
        ["readFile missing", (fs, r) => fs.readFile(`${r}/nope`)],
        ["readFile folder", (fs, r) => fs.readFile(`${r}/d`)],
        ["writeFile folder", (fs, r) => fs.writeFile(`${r}/d`, new Uint8Array(0))],
        ["writeFile missing parent", (fs, r) => fs.writeFile(`${r}/nope/a`, new Uint8Array(0))],
        ["mkdir existing", (fs, r) => fs.mkdir(`${r}/d`)],
        ["mkdir missing parent", (fs, r) => fs.mkdir(`${r}/nope/a`)],
        ["mkdir below file", (fs, r) => fs.mkdir(`${r}/f/a`)],
        ["rm missing", (fs, r) => fs.rm(`${r}/nope`, { recursive: true })],
        ["rm folder", (fs, r) => fs.rm(`${r}/d`, { recursive: false })],
        ["openAppend folder", (fs, r) => fs.openAppend(`${r}/d`)],
      ];
      for (const [label, action] of failures) {
        const disk = codeOf(() => action(nodeFs, dir));
        const virtual = codeOf(() => action(memory, ""));
        expect([label, virtual.code, virtual.message.replaceAll("'/", "'")]).toEqual([label, disk.code, disk.message.replaceAll(dir, "").replaceAll("'/", "'")]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("are turned into the exceptions of .NET by the file layer, as a disk's are (translateFileError)", () => {
    const fs = new MemoryVfs({ "/d/a": "x" });
    const environment = { fs, platform: "linux", cwd: "/", normalizePaths: false };
    expect(translateFileError(codeOf(() => fs.readFile("/d/nope")), "/d/nope", false, environment)).toBeInstanceOf(FileNotFoundException);
    expect(translateFileError(codeOf(() => fs.writeFile("/nope/a", new Uint8Array(0))), "/nope/a", true, environment)).toBeInstanceOf(
      DirectoryNotFoundException,
    );
    expect(translateFileError(codeOf(() => fs.stat("/d/a/x")), "/d/a/x", false, environment)).toBeInstanceOf(DirectoryNotFoundException);
    expect(translateFileError(codeOf(() => fs.readFile("/d")), "/d", false, environment)).toBeInstanceOf(UnauthorizedAccessException);
    // a full tree is not a failure the .NET layer has a name for: it reaches the caller as it is
    fs.maxBytes = 1;
    const full = codeOf(() => fs.writeFile("/d/b", new Uint8Array(5)));
    expect(translateFileError(full, "/d/b", true, environment)).toBe(full);
  });

  it("serve the file layer's own reads and writes, through the environment", () => {
    // the environment's current directory and the tree's are the same one: a relative host path reaches the tree as it is given
    const fs = new MemoryVfs({ "/pkg/a.xml": "<a/>" }, { cwd: "/pkg" });
    const environment = { fs, platform: "linux", cwd: "/pkg", normalizePaths: false };
    expect(readFileBytes("a.xml", environment).toString("utf8")).toBe("<a/>");
    writeFileBytes("b.xml", Buffer.from("<b/>"), environment);
    expect(text(fs.readFile("/pkg/b.xml"))).toBe("<b/>");
    expect(() => readFileBytes("missing.xml", environment)).toThrow(FileNotFoundException);
  });
});

describe("MemoryVfs: size of the tree (HOST-215)", () => {
  it("lists a folder of 100 000 files in under a second", () => {
    const fs = new MemoryVfs();
    fs.mkdir("/big");
    for (let index = 0; index < 100_000; index++) fs.writeFile(`/big/file-${index}.xml`, new Uint8Array(0));
    const started = performance.now();
    const entries = fs.readdir("/big");
    const names = entries.map((entry) => entry.name).sort();
    const elapsed = performance.now() - started;
    expect(entries).toHaveLength(100_000);
    expect(names[0]).toBe("file-0.xml");
    expect(entries.every((entry) => entry.isFile && !entry.isDirectory && !entry.isSymbolicLink)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it("makes 100 000 files and lists the tree of them in a short time", () => {
    const started = performance.now();
    const files: Record<string, string> = {};
    for (let index = 0; index < 100_000; index++) files[`/t/d${index % 100}/f${index}.xml`] = "";
    const fs = new MemoryVfs(files);
    expect(fs.toTree()).toHaveLength(100_000 + 100 + 1);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe("MemoryVfs: Node-free (HOST-215)", () => {
  it("runs with neither `Buffer` nor `process` in the realm", () => {
    const realBuffer = globalThis.Buffer;
    const realProcess = globalThis.process;
    let outcome: unknown;
    try {
      // @ts-expect-error: the point of the test is that the tree reaches for neither
      globalThis.Buffer = undefined;
      // @ts-expect-error: as above
      globalThis.process = undefined;
      const fs = new MemoryVfs({ "/p/a.xml": "<a/>é", "/p/q/": "" }, { cwd: "/p", maxBytes: 100 });
      const handle = fs.openAppend("log.txt");
      handle.write(new TextEncoder().encode("x"));
      handle.close();
      fs.rm("q", { recursive: true });
      let code = "";
      try {
        fs.readFile("/missing");
      } catch (error) {
        code = (error as HostFsError).code ?? "";
      }
      outcome = [fs.toTree(), [...fs.snapshot().keys()], fs.size, fs.readdir("/p").length, code];
    } finally {
      globalThis.Buffer = realBuffer;
      globalThis.process = realProcess;
    }
    expect(outcome).toEqual([["p/", "p/a.xml", "p/log.txt"], ["p/a.xml", "p/log.txt"], 6 + 1, 2, "ENOENT"]);
  });
});

describe("MemoryVfs: stubs (HOST-252, HOST-254)", () => {
  const stub = (fs: MemoryVfs, path: string): void => {
    fs.mount({ [path]: new Uint8Array(0) });
    fs.markStub(path);
  };

  it("lists a stub as a file of no bytes that cannot be read, and counts nothing", () => {
    const fs = new MemoryVfs({ "/a/real.txt": "abc" });
    stub(fs, "/a/b/big.bin");
    expect(fs.toTree()).toEqual(["a/", "a/b/", "a/b/big.bin", "a/real.txt"]);
    expect(fs.stat("/a/b/big.bin")).toEqual({ isFile: true, isDirectory: false });
    expect(fs.size).toBe(3);
    expect(fs.stubs()).toEqual(["/a/b/big.bin"]);
    expect(() => fs.readFile("/a/b/big.bin")).toThrow(expect.objectContaining({ code: "EIO", syscall: "read", path: "/a/b/big.bin", message: "EIO: i/o error, read '/a/b/big.bin'" }));
    expect(() => fs.openAppend("/a/b/big.bin")).toThrow(expect.objectContaining({ code: "EIO" }));
    expect([...fs.snapshot().keys()]).toEqual(["a/real.txt"]);
  });

  it("refuses a folder, and a path that is not there", () => {
    const fs = new MemoryVfs({ "/d/": "" });
    expect(() => fs.markStub("/d")).toThrow(expect.objectContaining({ code: "EISDIR" }));
    expect(() => fs.markStub("/missing")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  it("is replaced by a write, and a removal takes it out", () => {
    const fs = new MemoryVfs();
    stub(fs, "/s");
    fs.writeFile("/s", new Uint8Array([1, 2]));
    expect(fs.stubs()).toEqual([]);
    expect(fs.readFile("/s")).toEqual(new Uint8Array([1, 2]));
    expect(fs.size).toBe(2);
    stub(fs, "/s");
    expect(fs.size).toBe(0);
    fs.rm("/s", { recursive: false });
    expect(fs.exists("/s")).toBe(false);
  });
});
