export { DEFAULT_ENGINE, ENGINE_ASSEMBLY_VERSIONS, ENGINES, isEngine } from "./engines.js";
export type { Engine } from "./engines.js";
export * from "./client/index.js";
// The Node implementation of the HTTP seam is not part of the portable client (HOST-230); the Node entry exports it.
export { nodeTransport } from "./host/node-transport.js";
export * from "./manifest/index.js";
export * from "./export/index.js";
export * from "./import/index.js";
export * from "./language-pack/index.js";
export * from "./db-patches/index.js";
// The XML core's entry points: load an item file's text into the DOM the engine's code works on, and write that DOM back as the
// engine writes an item file. Loading, then encoding, tells whether a file is one the engine would write byte for byte.
export { decodeXmlFile, encodeItemFile, loadXml, readAllText } from "./xml/index.js";
export type { LoadOptions, XmlDocument } from "./xml/index.js";
