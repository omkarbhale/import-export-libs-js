import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { MemoryVfs, type MountFiles } from "../host/memory-fs.js";
import type { HostEnv } from "../host/types.js";

/**
 * What the tests of the in-memory file system share (HOST-218): reading a folder of the fixtures into a {@link MemoryVfs}, and comparing
 * a tree of the virtual file system with a folder on disk. These read the disk with Node (the browser variant, ticket 22, reads the
 * same fixtures through vitest commands); nothing here is part of the browser bundle.
 *
 * @spec HOST-218
 */

/** Every file below a folder on disk, by its path relative to the folder, written with `/`, with its bytes; and every folder, with a trailing `/`. */
function walk(dir: string, prefix: string, files: Map<string, Uint8Array>, folders: string[]): void {
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      folders.push(`${path}/`);
      walk(dir, `${path}/`, files, folders);
    } else {
      files.set(path, readFileSync(join(dir, path)));
    }
  }
}

/** Every file below a folder on disk with its bytes, by relative path with `/`. */
export function readDiskFiles(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  walk(dir, "", files, []);
  return files;
}

/**
 * The sorted list of a folder on disk in the format of {@link MemoryVfs.toTree}: every file as a relative path with `/`, and every
 * folder that has a file anywhere below it as its path with a trailing `/`. A folder with no file in it is not listed.
 */
export function diskTree(dir: string): string[] {
  const listed = new Set<string>();
  for (const path of readDiskFiles(dir).keys()) {
    listed.add(path);
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end += 1) listed.add(`${parts.slice(0, end).join("/")}/`);
  }
  return [...listed].sort();
}

/**
 * Copies a folder of the disk into the virtual file system below `at` (an absolute POSIX path): every file with its bytes, and every
 * empty folder as an empty folder. `at` itself is made even when the folder is empty.
 */
export function loadTreeIntoVfs(dir: string, vfs: MemoryVfs, at: string): void {
  const files = new Map<string, Uint8Array>();
  const folders: string[] = [];
  walk(dir, "", files, folders);
  const base = at.endsWith("/") ? at : `${at}/`;
  const mount: MountFiles = { [base]: "" };
  for (const folder of folders) mount[`${base}${folder}`] = "";
  for (const [path, content] of files) mount[`${base}${path}`] = content;
  vfs.mount(mount);
}

/** True when the two byte arrays hold the same bytes. */
export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);

/**
 * Asserts that the tree below `root` of the virtual file system is the folder `dir` of the disk: the same list of files and folders
 * (as {@link MemoryVfs.toTree} and {@link diskTree} write them) and, for each file, the same bytes. A difference names the file.
 */
export function assertTreesEqual(vfs: MemoryVfs, root: string, dir: string, label = dir): void {
  const wanted = readDiskFiles(dir);
  expect(vfs.toTree(root), `${label}: the folders and files`).toEqual(diskTree(dir));
  const made = vfs.snapshot(root);
  for (const [path, bytes] of wanted) {
    const actual = made.get(path);
    expect(actual !== undefined && bytesEqual(actual, bytes), `${label}: ${path} byte for byte`).toBe(true);
  }
}

/** The current directory every virtual run starts in, as the disk replays start in a temp folder. */
export const VFS_WORK = "/work";

/**
 * A host environment that is no machine's: Linux, `/work` as the current directory, `/tmp` as the temp folder, and a fixed account,
 * clock and randomness. A run on it reads nothing from the process (HOST-203).
 */
export function fakeHostEnv(): HostEnv {
  return {
    platform: "linux",
    cwd: () => VFS_WORK,
    tmpdir: () => "/tmp",
    osUser: () => ({ user: "libsjs", machine: "VFSBOX" }),
    availableParallelism: () => 4,
    monotonicNs: (() => {
      let now = 0n;
      return () => (now += 1_000_000n);
    })(),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, index) => (index * 37 + 11) % 256),
    randomUuid: () => "00000000-0000-4000-8000-000000000000",
    yieldTurn: () => Promise.resolve(),
    windowsTimeZoneId: () => undefined,
    locale: () => "en-US",
  };
}
