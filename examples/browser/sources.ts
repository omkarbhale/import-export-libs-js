import type { DataTransferItemLike, DataTransferItemsLike, EntryLike, FsaDirectoryHandle, WorkerSource } from "../../src/browser.js";
import { isFileSystemAccessSupported } from "../../src/browser.js";
import { sizeText } from "./dom.js";

/**
 * Where a package comes from (HOST-280): the controls of the page hand what a person gave them to the engine's Worker as a source,
 * and the Worker mounts it into its tree (HOST-250, HOST-252, HOST-254, HOST-255, HOST-275). Nothing is read when the file is chosen:
 * a zip is inflated and a folder is read in the Worker when the run starts, so the page keeps its thread. The page owns the controls;
 * the library owns the mount.
 *
 * @spec HOST-280 HOST-275
 */

/** The read guard of the adapters (`maxBytes`, HOST-250): it stops a zip bomb and is not the size that fits, which is HOST-278. */
const READ_GUARD_BYTES = 500 * 1024 * 1024;

/** A package the person gave, and what to say about it. */
export interface PackageSource {
  /** What the person gave: a file name or a folder name. */
  label: string;
  /** What is known of its size without reading it. */
  description: string;
  /** The bytes known without reading it: of the zip itself, or of the files of a folder input. A drop and a picked folder have none. */
  bytes?: number;
  /** Whether `bytes` is the size of a zip, which holds more than that. */
  zipped?: boolean;
  source: WorkerSource;
}

const MOUNT = { root: "auto", maxBytes: READ_GUARD_BYTES } as const;

/** A zip from a file input, or a folder from a `webkitdirectory` input. */
export function sourceOfFiles(files: FileList | readonly File[]): PackageSource {
  const list = [...files];
  const first = list[0];
  if (first === undefined) throw new Error("no file was chosen");
  const folder = (first.webkitRelativePath ?? "").split("/")[0] ?? "";
  const bytes = list.reduce((sum, file) => sum + file.size, 0);
  if (folder === "" && list.length === 1) {
    return { label: first.name, description: `${first.name}: a zip of ${sizeText(first.size)}`, bytes: first.size, zipped: true, source: { zip: first, maxBytes: READ_GUARD_BYTES } };
  }
  return { label: folder, description: `${folder === "" ? `${list.length} files` : folder}: ${list.length} files, ${sizeText(bytes)}`, bytes, source: { fileList: list, mount: MOUNT } };
}

/**
 * A drop. The entries are taken now, before the first `await`, because a browser empties the item list when the handler returns
 * (HOST-255); the run walks them later, in the Worker's reach, from this list.
 */
export function sourceOfDrop(transfer: DataTransfer): PackageSource {
  const entries: EntryLike[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry !== null) entries.push(entry as EntryLike);
  }
  if (entries.length === 0) throw new Error("the drop holds no file or folder");
  const items: DataTransferItemLike[] = entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry }));
  const list: DataTransferItemsLike = Object.assign(items, { length: items.length });
  const label = entries.length === 1 ? (entries[0] as EntryLike).name : `${entries.length} items`;
  return { label, description: `${label}: dropped`, source: { dataTransfer: list, mount: MOUNT } };
}

/** A folder behind a handle, picked with `showDirectoryPicker`. */
export function sourceOfHandle(handle: FsaDirectoryHandle): PackageSource {
  return { label: handle.name, description: `${handle.name}: a picked folder`, source: { directory: handle, mount: { maxBytes: READ_GUARD_BYTES } } };
}

/** Whether the page can offer the picker: `showDirectoryPicker` is there (Chromium) (HOST-252). */
export function canPickDirectory(scope: object = globalThis): boolean {
  return isFileSystemAccessSupported(scope);
}

/** Opens the browser's folder picker; the call must be made in reaction to a click. */
export async function pickDirectory(mode: "read" | "readwrite"): Promise<FsaDirectoryHandle> {
  const picker = (globalThis as unknown as { showDirectoryPicker: (options: { mode: string }) => Promise<FsaDirectoryHandle> }).showDirectoryPicker;
  return picker.call(globalThis, { mode });
}
