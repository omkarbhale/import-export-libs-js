import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultHost } from "./default-host.js";
import { nodeFs } from "./node-fs.js";
import type { HostFsError } from "./types.js";

/**
 * `nodeFs` is `node:fs` and nothing else (HOST-210): each method gives what the call it is named after gives, and a failure is
 * Node's own error with its real errno code (HOST-201). Run against a temporary folder.
 *
 * @spec HOST-200 HOST-201 HOST-210
 */
const work = mkdtempSync(join(tmpdir(), "libsjs-nodefs-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const at = (...parts: string[]): string => join(work, ...parts);

/** The error a call throws, or a failure of the test when it does not throw. */
function thrown(action: () => unknown): HostFsError {
  try {
    action();
  } catch (error) {
    return error as HostFsError;
  }
  throw new Error("expected the call to throw");
}

describe("HOST-210: nodeFs is the default host's file system", () => {
  it("is what defaultHost() gives", () => {
    expect(defaultHost().fs).toBe(nodeFs);
  });
});

describe("HOST-210: each method is the node:fs call it is named after", () => {
  it("writeFile creates a file and truncates an existing one", () => {
    nodeFs.writeFile(at("a.txt"), Buffer.from("first, longer"));
    nodeFs.writeFile(at("a.txt"), Buffer.from("second"));
    expect(readFileSync(at("a.txt"), "utf8")).toBe("second");
    nodeFs.writeFile(at("empty.bin"), new Uint8Array(0));
    expect(readFileSync(at("empty.bin")).length).toBe(0);
  });

  it("writeFile takes any Uint8Array, bytes included that are no text", () => {
    nodeFs.writeFile(at("bytes.bin"), Uint8Array.from([0, 255, 0xef, 0xbb, 0xbf, 10, 13]));
    expect([...readFileSync(at("bytes.bin"))]).toEqual([0, 255, 0xef, 0xbb, 0xbf, 10, 13]);
  });

  it("readFile returns the whole file, as a Buffer", () => {
    writeFileSync(at("r.bin"), Uint8Array.from([1, 2, 3, 4]));
    const bytes = nodeFs.readFile(at("r.bin"));
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });

  it("stat says what the path is, and follows a link", () => {
    mkdirSync(at("d"));
    expect(nodeFs.stat(at("a.txt"))).toEqual({ isFile: true, isDirectory: false });
    expect(nodeFs.stat(at("d"))).toEqual({ isFile: false, isDirectory: true });
    if (process.platform === "win32") return;
    symlinkSync(at("d"), at("link-to-d"));
    symlinkSync(at("a.txt"), at("link-to-a"));
    expect(nodeFs.stat(at("link-to-d"))).toEqual({ isFile: false, isDirectory: true });
    expect(nodeFs.stat(at("link-to-a"))).toEqual({ isFile: true, isDirectory: false });
  });

  it("readdir lists the entries with their own kind, without . and .., and does not follow a link", () => {
    mkdirSync(at("list"));
    writeFileSync(at("list", "f.txt"), "x");
    mkdirSync(at("list", "sub"));
    if (process.platform !== "win32") symlinkSync(at("list", "sub"), at("list", "ln"));
    const entries = nodeFs.readdir(at("list"));
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    expect(Object.keys(byName).sort()).toEqual(process.platform === "win32" ? ["f.txt", "sub"] : ["f.txt", "ln", "sub"]);
    expect(byName["f.txt"]).toEqual({ name: "f.txt", isFile: true, isDirectory: false, isSymbolicLink: false });
    expect(byName["sub"]).toEqual({ name: "sub", isFile: false, isDirectory: true, isSymbolicLink: false });
    if (process.platform !== "win32") expect(byName["ln"]).toEqual({ name: "ln", isFile: false, isDirectory: false, isSymbolicLink: true });
    expect(nodeFs.readdir(at("d"))).toEqual([]);
  });

  it("mkdir makes one folder", () => {
    nodeFs.mkdir(at("made"));
    expect(nodeFs.stat(at("made")).isDirectory).toBe(true);
    expect(nodeFs.mkdir(at("made2"))).toBeUndefined();
  });

  it("exists is true for a file, a folder and a link, and false for anything else, without throwing", () => {
    expect(nodeFs.exists(at("a.txt"))).toBe(true);
    expect(nodeFs.exists(at("d"))).toBe(true);
    expect(nodeFs.exists(at("nothing"))).toBe(false);
    expect(nodeFs.exists(at("a.txt", "below"))).toBe(false); // ENOTDIR
    expect(nodeFs.exists(at("no", "such", "folder", "x"))).toBe(false);
    expect(nodeFs.exists("")).toBe(false);
  });

  it("rm removes a file, an empty folder with or without recursive, and a full folder with it", () => {
    writeFileSync(at("gone.txt"), "x");
    nodeFs.rm(at("gone.txt"), { recursive: false });
    expect(existsSync(at("gone.txt"))).toBe(false);
    mkdirSync(at("full", "deep"), { recursive: true });
    writeFileSync(at("full", "deep", "f"), "x");
    nodeFs.rm(at("full"), { recursive: true });
    expect(existsSync(at("full"))).toBe(false);
  });

  it("openAppend creates the file, appends to it, and appends to what is there", () => {
    const handle = nodeFs.openAppend(at("log.txt"));
    handle.write(Buffer.from("one\r\n"));
    handle.write(new Uint8Array(0));
    handle.write(Buffer.from("two\r\n"));
    handle.close();
    expect(readFileSync(at("log.txt"), "utf8")).toBe("one\r\ntwo\r\n");
    const again = nodeFs.openAppend(at("log.txt"));
    again.write(Buffer.from("three"));
    again.close();
    expect(readFileSync(at("log.txt"), "utf8")).toBe("one\r\ntwo\r\nthree");
  });

  it("openAppend writes all of a large buffer", () => {
    const big = Buffer.alloc(4 * 1024 * 1024, "x");
    const handle = nodeFs.openAppend(at("big.txt"));
    handle.write(big);
    handle.close();
    expect(readFileSync(at("big.txt")).length).toBe(big.length);
  });
});

describe("HOST-201: a failure is Node's own error, with its errno code", () => {
  it("stat: ENOENT for a missing path, ENOTDIR below a file", () => {
    expect(thrown(() => nodeFs.stat(at("missing"))).code).toBe("ENOENT");
    expect(thrown(() => nodeFs.stat(at("a.txt", "x"))).code).toBe("ENOTDIR");
  });

  it("readdir: ENOENT for a missing folder, ENOTDIR for a file", () => {
    expect(thrown(() => nodeFs.readdir(at("missing"))).code).toBe("ENOENT");
    expect(thrown(() => nodeFs.readdir(at("a.txt"))).code).toBe("ENOTDIR");
  });

  it("readFile: ENOENT, ENOTDIR and, for a folder, EISDIR", () => {
    expect(thrown(() => nodeFs.readFile(at("missing"))).code).toBe("ENOENT");
    expect(thrown(() => nodeFs.readFile(at("a.txt", "x"))).code).toBe("ENOTDIR");
    expect(thrown(() => nodeFs.readFile(at("d"))).code).toBe("EISDIR");
  });

  it("writeFile: ENOENT for a missing folder, ENOTDIR below a file, EISDIR for a folder", () => {
    expect(thrown(() => nodeFs.writeFile(at("missing", "x"), new Uint8Array(1))).code).toBe("ENOENT");
    expect(thrown(() => nodeFs.writeFile(at("a.txt", "x"), new Uint8Array(1))).code).toBe("ENOTDIR");
    expect(thrown(() => nodeFs.writeFile(at("d"), new Uint8Array(1))).code).toBe("EISDIR");
  });

  it("mkdir: EEXIST when the path exists, ENOENT when a parent is missing (no recursive)", () => {
    expect(thrown(() => nodeFs.mkdir(at("d"))).code).toBe("EEXIST");
    expect(thrown(() => nodeFs.mkdir(at("a.txt"))).code).toBe("EEXIST");
    expect(thrown(() => nodeFs.mkdir(at("no", "parent"))).code).toBe("ENOENT");
    expect(existsSync(at("no"))).toBe(false);
  });

  it("rm: ENOENT for a missing path (force is off), and an error for a folder without recursive", () => {
    expect(thrown(() => nodeFs.rm(at("missing"), { recursive: false })).code).toBe("ENOENT");
    expect(thrown(() => nodeFs.rm(at("missing"), { recursive: true })).code).toBe("ENOENT");
    expect(thrown(() => nodeFs.rm(at("d"), { recursive: false })).code).toBeTypeOf("string");
    expect(existsSync(at("d"))).toBe(true);
  });

  it("openAppend: ENOENT for a missing folder, EISDIR for a folder", () => {
    expect(thrown(() => nodeFs.openAppend(at("missing", "log"))).code).toBe("ENOENT");
    expect(thrown(() => nodeFs.openAppend(at("d"))).code).toMatch(/^(EISDIR|EPERM)$/);
  });

  it("names the path of the failure in `path`, as Node does", () => {
    expect(thrown(() => nodeFs.readFile(at("missing"))).path).toBe(at("missing"));
    expect(thrown(() => nodeFs.mkdir(at("d"))).path).toBe(at("d"));
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("EACCES for a folder or file the account may not use", () => {
    mkdirSync(at("locked"));
    writeFileSync(at("locked", "f.txt"), "x");
    chmodSync(at("locked"), 0o000);
    try {
      expect(thrown(() => nodeFs.readFile(at("locked", "f.txt"))).code).toBe("EACCES");
      expect(thrown(() => nodeFs.writeFile(at("locked", "g.txt"), new Uint8Array(1))).code).toBe("EACCES");
      expect(thrown(() => nodeFs.readdir(at("locked"))).code).toBe("EACCES");
      expect(thrown(() => nodeFs.mkdir(at("locked", "sub"))).code).toBe("EACCES");
    } finally {
      chmodSync(at("locked"), 0o700);
    }
  });
});
