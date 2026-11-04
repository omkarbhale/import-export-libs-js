import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryVfs } from "../host/memory-fs.js";
import { assertTreesEqual, diskTree, fakeHostEnv, loadTreeIntoVfs, readDiskFiles } from "./test-support.js";

/**
 * The helpers of the in-memory replays compare a virtual tree with a folder of the disk, so they must fail on any difference
 * (HOST-217): one byte, a missing file, an extra file, a missing folder.
 * @spec HOST-217
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function folder(files: Record<string, string | Uint8Array>, folders: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "vfs-support-"));
  roots.push(root);
  for (const name of folders) mkdirSync(join(root, name), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const FILES = { "imports.mf": "<imports/>", "a/b/one.xml": "<one/>", "a/two.xml": new Uint8Array([0xef, 0xbb, 0xbf, 0x00, 0xff]) };

describe("loadTreeIntoVfs and assertTreesEqual (HOST-217)", () => {
  it("loads every file with its bytes and every empty folder, and a loaded tree equals its folder", () => {
    const dir = folder(FILES, ["empty/deeper"]);
    const vfs = new MemoryVfs();
    const bytes = loadTreeIntoVfs(dir, vfs, "/in");
    expect(bytes).toBe(10 + 6 + 5);
    expect(vfs.stat("/in/empty/deeper").isDirectory).toBe(true);
    expect([...vfs.snapshot("/in").keys()]).toEqual(["a/b/one.xml", "a/two.xml", "imports.mf"]);
    expect(diskTree(dir)).toEqual(["a/", "a/b/", "a/b/one.xml", "a/two.xml", "imports.mf"]);
    expect(vfs.toTree("/in")).toEqual(diskTree(dir));
    assertTreesEqual(vfs, "/in", dir);
    expect([...readDiskFiles(dir).keys()].sort()).toEqual(["a/b/one.xml", "a/two.xml", "imports.mf"]);
  });

  it("makes the folder of an empty source folder", () => {
    const vfs = new MemoryVfs();
    loadTreeIntoVfs(folder({}), vfs, "/nothing");
    expect(vfs.stat("/nothing").isDirectory).toBe(true);
    expect(vfs.toTree("/nothing")).toEqual([]);
  });

  it("fails when one byte of one file differs", () => {
    const dir = folder(FILES);
    const vfs = new MemoryVfs();
    loadTreeIntoVfs(dir, vfs, "/out");
    const corrupted = new Uint8Array(vfs.readFile("/out/a/two.xml"));
    corrupted[4] = 0xfe;
    vfs.writeFile("/out/a/two.xml", corrupted);
    expect(() => assertTreesEqual(vfs, "/out", dir, "case")).toThrow(/case: a\/two\.xml byte for byte/);
  });

  it("fails when a file is missing, extra, or in another folder", () => {
    const dir = folder(FILES);
    const vfs = new MemoryVfs();
    loadTreeIntoVfs(dir, vfs, "/out");
    vfs.rm("/out/imports.mf", { recursive: false });
    expect(() => assertTreesEqual(vfs, "/out", dir)).toThrow(/the folders and files/);
    vfs.writeFile("/out/imports.mf", new TextEncoder().encode("<imports/>"));
    assertTreesEqual(vfs, "/out", dir);
    vfs.writeFile("/out/extra.xml", new Uint8Array());
    expect(() => assertTreesEqual(vfs, "/out", dir)).toThrow(/the folders and files/);
    vfs.rm("/out/extra.xml", { recursive: false });
    vfs.mkdir("/out/c");
    vfs.writeFile("/out/c/one.xml", new TextEncoder().encode("<one/>"));
    vfs.rm("/out/a/b", { recursive: true });
    expect(() => assertTreesEqual(vfs, "/out", dir)).toThrow(/the folders and files/);
  });
});

describe("fakeHostEnv (HOST-203)", () => {
  it("is a Linux machine in /work with a fixed account, and its members can be replaced", () => {
    const host = fakeHostEnv();
    expect(host.platform).toBe("linux");
    expect(host.cwd()).toBe("/work");
    expect(host.tmpdir()).toBe("/tmp");
    expect(host.randomBytes(3)).toEqual(Uint8Array.from([11, 48, 85]));
    expect(host.monotonicNs()).toBeLessThan(host.monotonicNs());
    expect(fakeHostEnv({ locale: () => "en-IN" }).locale()).toBe("en-IN");
  });
});
