import {
  type FsaDirectoryHandle,
  type MemoryVfs,
  type MountOptions,
  isFileSystemAccessSupported,
  mountDataTransfer,
  mountDirectory,
  mountFileList,
  vfsFromZip,
} from "../../src/browser.js";

/**
 * Where a package comes from (HOST-280): the controls of the page hand what a person gave them to the library's adapters, which
 * mount it into a tree in memory (HOST-250, HOST-252, HOST-254, HOST-255). The page owns the controls; the library owns the mount.
 *
 * @spec HOST-280 HOST-250 HOST-252 HOST-254 HOST-255
 */

/** The package budget the browser build is designed for (Q5): 500 MiB of package data in memory. */
export const PACKAGE_BUDGET = 500 * 1024 * 1024;

/** A package that has been mounted, and what to say about it. */
export interface MountedSource {
  /** What the person gave: a file name or a folder name. */
  label: string;
  tree: MemoryVfs;
}

const options = (extra: MountOptions = {}): MountOptions => ({
  root: "auto",
  maxBytes: PACKAGE_BUDGET,
  unzip: (bytes, unzipOptions) => vfsFromZip(bytes, unzipOptions),
  ...extra,
});

/** A zip from a file input, or a folder from a `webkitdirectory` input: the library tells which from the files themselves. */
export async function mountFiles(files: FileList | readonly File[], onProgress?: MountOptions["onProgress"]): Promise<MountedSource> {
  const list = [...files];
  const first = list[0];
  if (first === undefined) throw new Error("no file was chosen");
  const folder = (first.webkitRelativePath ?? "").split("/")[0] ?? "";
  const tree = await mountFileList(list, options(onProgress === undefined ? {} : { onProgress }));
  return { label: folder !== "" ? folder : list.length === 1 ? first.name : `${list.length} files`, tree };
}

/** A drop: the entries are taken here, before the first `await`, as the adapter requires (HOST-255). */
export function mountDrop(transfer: DataTransfer, onProgress?: MountOptions["onProgress"]): Promise<MountedSource> {
  const names = [...transfer.items].map((item) => item.webkitGetAsEntry()?.name).filter((name): name is string => name !== undefined);
  const mounted = mountDataTransfer(transfer.items, options(onProgress === undefined ? {} : { onProgress }));
  return mounted.then((tree) => ({ label: names.length === 1 ? (names[0] as string) : `${names.length} items`, tree }));
}

/** A folder behind a handle, picked with `showDirectoryPicker`. */
export async function mountHandle(handle: FsaDirectoryHandle): Promise<MountedSource> {
  const tree = await mountDirectory(handle, { maxBytes: PACKAGE_BUDGET });
  return { label: handle.name, tree };
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
