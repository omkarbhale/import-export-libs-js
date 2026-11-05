import type { FsaDirectoryHandle, FsaFileHandle } from "./fsa.js";

/**
 * A compile-time check, compiled by `fsa-dom.test.ts` with the browser's options and the DOM types (the Node project has none and
 * excludes this file). `tsconfig.browser.json` compiles the adapter through `src/browser.ts` but nothing there assigns a DOM handle to
 * its types, so this file holds that check: the real handles of the DOM are assignable to the structural handle types of the adapter (`fsa.ts`), so a caller passes
 * `await navigator.storage.getDirectory()` or the result of `showDirectoryPicker()` as it is. It emits nothing and is imported by nothing.
 *
 * @spec HOST-252 HOST-253
 */
export const directoryHandleIsAccepted: (handle: FileSystemDirectoryHandle) => FsaDirectoryHandle = (handle) => handle;
export const fileHandleIsAccepted: (handle: FileSystemFileHandle) => FsaFileHandle = (handle) => handle;
