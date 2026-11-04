import type { MemoryVfs } from "../host/memory-fs.js";

/**
 * The settings every adapter that mounts a package into the in-memory tree takes (HOST-254): how much to read, how to lay it out,
 * how to stop and how to report. The folder adapters share them, so a caller that switches from a picked folder to a dropped one
 * changes nothing else.
 *
 * Nothing here reads a global, so it is clean for the browser typecheck ratchet.
 *
 * @spec HOST-254
 */

/** One report per file that was put into the tree, in the order they were put. */
export interface MountProgress {
  /** The path of the file in the tree, absolute. */
  path: string;
  /** The files put into the tree so far, this one included. */
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
  /**
   * The most bytes of content this call may read. It is checked against the sizes of the files before the first one is read, and
   * a source that needs more is refused with an `ENOSPC` error, so that nothing is half-read. Default unlimited.
   */
  maxBytes?: number;
  /** Stops the mount at the next file: the promise rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Called after each file is put into the tree; for a zip, once per file of the unzipped tree, after it is unzipped. */
  onProgress?: (progress: MountProgress) => void;
  /** Reads a chosen or dropped `.zip` (a single file whose name ends in `.zip`). Without it a zip is refused with a clear error. */
  unzip?: MountUnzip;
}
