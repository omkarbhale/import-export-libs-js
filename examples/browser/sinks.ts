import { type CommitResult, type FsaDirectoryHandle, MemoryVfs, commitToDirectory } from "../../src/browser.js";

/**
 * Where a result goes (HOST-280): a zip the person downloads, or a folder they picked. The zip is made in the Worker (HOST-251,
 * HOST-275); writing into a folder is the library's adapter (HOST-253), and the download itself, an anchor on a Blob URL, is the
 * page's.
 *
 * @spec HOST-280 HOST-251 HOST-253
 */

/** Hands a file to the person. */
export type SaveFile = (name: string, bytes: Uint8Array, type: string) => void;

/** Offers bytes as a download: the page's default of {@link SaveFile}. */
export const downloadFile: SaveFile = (name, bytes, type) => {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** A file name made of the time the run ended: `export-20261105-101112.zip`. */
export function stampedName(prefix: string, extension: string, now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}.${extension}`;
}

/** Writes the files of an export, by their paths from the working folder, into a picked folder; nothing that is in it is removed (HOST-253). */
export function writeToFolder(files: ReadonlyMap<string, Uint8Array>, handle: FsaDirectoryHandle): Promise<CommitResult> {
  const tree = new MemoryVfs();
  const mount: Record<string, Uint8Array> = {};
  for (const [path, bytes] of files) mount[`/${path}`] = bytes;
  tree.mount(mount);
  return commitToDirectory(tree, handle);
}
