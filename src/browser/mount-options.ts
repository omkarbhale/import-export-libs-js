import type { MemoryVfs } from "../host/memory-fs.js";

/**
 * The settings every adapter that mounts a package into the in-memory tree takes (HOST-254): which files to read, how much to read,
 * how to lay it out, how to stop and how to report. The folder adapters share them, so a caller that switches from a picked folder to a dropped one
 * changes nothing else.
 *
 * Nothing here reads a global, so it is clean for the browser typecheck ratchet.
 *
 * @spec HOST-254
 */

/** What an entry of the source is. */
export type MountKind = "file" | "directory";

/**
 * What to do with an entry. `content`: read its bytes into the tree. `stub`: put the name in the tree with no bytes, so that its
 * name is there for the 8.3 short-name numbering of its siblings (`import/ntfs-order.ts`) but its content is never read; a stub
 * is listed by {@link stubsOf}. `skip`: leave it out; a skipped folder leaves out everything below it.
 */
export type MountDecision = "content" | "stub" | "skip";

/**
 * Decides per entry. `path` is relative to the root of the tree, written with `/`, without a leading `/` (after the root has been
 * stripped, when the caller asked for that), and `size` is the file's size in bytes (0 for a folder).
 */
export type MountInclude = (path: string, kind: MountKind, size: number) => MountDecision;

/** One report per file that was put into the tree, in the order they were put; for a zip, in the order of the paths compared by code unit. */
export interface MountProgress {
  /** The path of the file in the tree, absolute. */
  path: string;
  /** The files put into the tree so far, this one included (stubs count). */
  files: number;
  /** The bytes of content put into the tree so far, this one included. */
  bytes: number;
}

/** Reads a `.zip` that a caller chose or dropped; `vfsFromZip` of `zip.ts` has this shape. */
export type MountUnzip = (bytes: Uint8Array, options: { root?: "auto" | "keep"; maxBytes?: number }) => MemoryVfs;

/** The settings of {@link import("./file-list.js").mountFileList} and {@link import("./file-list.js").mountDataTransfer}. */
export interface MountOptions {
  /**
   * `"keep"` puts the paths as the source gives them (a picked folder `Pkg` gives `/Pkg/imports.mf`); `"auto"` removes the first
   * segment when every path of the source starts with the same folder, so that `imports.mf` is at the root of the tree. Default
   * `"keep"`: what the caller does with the folder's name is the caller's decision.
   */
  root?: "auto" | "keep";
  /** Decides per entry. Default {@link defaultInclude}. */
  include?: MountInclude;
  /**
   * The most bytes of content this call may read. It is checked against the sizes of the files to read before the first one is read, and
   * a source that needs more is refused with an `ENOSPC` error, so that nothing is half-read. Default unlimited.
   */
  maxBytes?: number;
  /** Stops the mount at the next file: the promise rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Called after each file is put into the tree; for a zip, once per file of the unzipped tree, after it is unzipped. */
  onProgress?: (progress: MountProgress) => void;
  /** Reads a chosen or dropped `.zip` (a single file whose name ends in `.zip` or whose bytes start with the zip magic). Without it a zip is refused with a clear error. */
  unzip?: MountUnzip;
}

/** The size above which a file the engine does not read is left as a stub by {@link defaultInclude}: 1 MiB. */
export const STUB_THRESHOLD = 1_048_576;

/**
 * The default decision. The import reads only `*.xml*` files and `imports.mf` (`matchesXmlPattern`), so those are always
 * `content`; any other file above {@link STUB_THRESHOLD} (a binary the package carries along, such as a vault file) is a `stub`,
 * which keeps a large package inside its memory budget; every other file is `content`.
 */
export const defaultInclude: MountInclude = (path, kind, size) => {
  if (kind === "directory") return "content";
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/\.(xml|mf)/i.test(name)) return "content";
  return size > STUB_THRESHOLD ? "stub" : "content";
};

/**
 * The paths (absolute) of the tree that are stubs now: names with no bytes, whose content was never read. A path that was written
 * since, with bytes or empty, or replaced or removed, is not one.
 */
export function stubsOf(vfs: MemoryVfs): ReadonlySet<string> {
  return new Set(vfs.stubs());
}
