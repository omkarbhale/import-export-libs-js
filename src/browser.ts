/**
 * The browser entry point: the portable core (`core.ts`) and the browser's implementations of the host seam. It has no Node API:
 * nothing it reaches imports `node:*` or reads `process`, which `tools/browser-bundle.test.ts` and `tsconfig.browser.json` hold
 * (HOST-260). A caller builds a host with {@link createBrowserHost}, mounts a file system in it, and passes both in the
 * `PathEnvironment` of a run.
 *
 * @spec HOST-260 HOST-250 HOST-251
 */
export * from "./core.js";
export { createBrowserHost } from "./browser/host.js";
export type {
  BrowserEnv,
  BrowserGlobals,
  BrowserHostOptions,
  CryptoLike,
  MessageChannelConstructorLike,
  MessagePortLike,
  NavigatorLike,
  PerformanceLike,
  SetTimeoutLike,
} from "./browser/host.js";
export { createFetchTransport } from "./browser/fetch-transport.js";
export type { FetchCredentials, FetchTransportOptions } from "./browser/fetch-transport.js";
export { MemoryVfs } from "./host/memory-fs.js";
export type { MemoryVfsOptions, MountFiles } from "./host/memory-fs.js";
export { mountDataTransfer, mountFileList } from "./browser/file-list.js";
export type {
  DataTransferItemLike,
  DataTransferItemsLike,
  DirectoryReaderLike,
  EntryLike,
  FileLike,
} from "./browser/file-list.js";
export { CommitError, commitToDirectory, isFileSystemAccessSupported, mountDirectory } from "./browser/fsa.js";
export type {
  CommitFailure,
  CommitResult,
  CommitToDirectoryOptions,
  FsaDirectoryHandle,
  FsaFile,
  FsaFileHandle,
  FsaHandle,
  FsaProgress,
  FsaWritable,
  MountDirectoryOptions,
} from "./browser/fsa.js";
export { STUB_THRESHOLD, defaultInclude, stubsOf } from "./browser/mount-options.js";
export type { MountDecision, MountInclude, MountKind, MountOptions, MountProgress, MountUnzip } from "./browser/mount-options.js";
export { ZipError, vfsFromZip, vfsToZip } from "./browser/zip.js";
export type { VfsFromZipOptions, VfsToZipOptions, ZipErrorCode } from "./browser/zip.js";
export { LIBRARY_VERSION } from "./version.js";
