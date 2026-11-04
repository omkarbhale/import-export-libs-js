/**
 * The Node entry point: the portable core (`core.ts`) and the Node implementation of the HTTP seam. The Node implementations of the
 * file system and the environment (`nodeFs`, `nodeHost`) are the default host of the core and need not be passed, so they are not
 * part of the public API (HOST-260).
 *
 * @spec HOST-260 HOST-261
 */
export * from "./core.js";
// The Node implementation of the HTTP seam is not part of the portable client (HOST-230); the Node entry exports it.
export { nodeTransport } from "./host/node-transport.js";
