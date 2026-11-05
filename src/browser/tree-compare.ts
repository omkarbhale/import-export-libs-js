import { expect } from "vitest";
import type { MemoryVfs } from "../host/memory-fs.js";

/**
 * The comparison of a tree of the in-memory file system with the files a recording holds, with nothing in it that reads a disk, so
 * that the replays under Node (`test-support.ts`, HOST-218) and the replays in the browsers (HOST-265) fail on the same differences
 * by the same code: the list of files and folders, and each file byte for byte.
 *
 * @spec HOST-218 HOST-265
 */

/** The current directory every virtual run starts in, as the disk replays start in a temp folder. */
export const VFS_WORK = "/work";

/** True when the two byte arrays hold the same bytes. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The sorted list of a set of files in the format of {@link MemoryVfs.toTree}: every file as a relative path with `/`, and every
 * folder that has a file anywhere below it as its path with a trailing `/`. A folder with no file in it is not listed.
 */
export function treeOfPaths(paths: Iterable<string>): string[] {
  const listed = new Set<string>();
  for (const path of paths) {
    listed.add(path);
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end += 1) listed.add(`${parts.slice(0, end).join("/")}/`);
  }
  return [...listed].sort();
}

/**
 * Asserts that the tree below `root` of the virtual file system holds exactly the files `wanted` (relative path with `/`, bytes):
 * the same list of files and folders and, for each file, the same bytes. A difference names the file.
 */
export function assertFilesEqual(vfs: MemoryVfs, root: string, wanted: ReadonlyMap<string, Uint8Array>, label: string): void {
  expect(vfs.toTree(root), `${label}: the folders and files`).toEqual(treeOfPaths(wanted.keys()));
  const made = vfs.snapshot(root);
  for (const [path, bytes] of wanted) {
    const actual = made.get(path);
    expect(actual !== undefined && bytesEqual(actual, bytes), `${label}: ${path} byte for byte`).toBe(true);
  }
}
