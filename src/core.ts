/**
 * The portable surface of the library: everything the engine's code offers that runs without Node, and so the part that both entry
 * points share (HOST-260). `src/index.ts` is this plus the Node implementations of the host seam, and `src/browser.ts` is this plus
 * the browser's. Nothing here names `node:*`: the one module that decides which host a `PathEnvironment` without an `fs` falls
 * back to is `src/host/default-host.ts`, which a browser build replaces with `default-host.browser.ts` (HOST-200).
 *
 * @spec HOST-260
 */
export { DEFAULT_ENGINE, ENGINE_ASSEMBLY_VERSIONS, ENGINES, isEngine } from "./engines.js";
export type { Engine } from "./engines.js";
export * from "./client/index.js";
export * from "./manifest/index.js";
export * from "./export/index.js";
export * from "./import/index.js";
export * from "./language-pack/index.js";
export * from "./db-patches/index.js";
// The XML core's entry points: load an item file's text into the DOM the engine's code works on, and write that DOM back as the
// engine writes an item file. Loading, then encoding, tells whether a file is one the engine would write byte for byte.
export { decodeXmlFile, encodeItemFile, loadXml, readAllText } from "./xml/index.js";
export type { LoadOptions, XmlDocument } from "./xml/index.js";
// The host seam's types (HOST-200), so that a caller can write a file system or an environment of its own and pass it in a
// `PathEnvironment`.
export type { AppendHandle, Host, HostDirent, HostEnv, HostFs, HostFsError, HostStat } from "./host/types.js";
export type { PathEnvironment } from "./io/host-path.js";
