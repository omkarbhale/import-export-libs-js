import { nodeHost } from "./node.js";
import type { HostEnv } from "./types.js";

/**
 * The environment of the running platform, which a `PathEnvironment` without a `host` falls back to (HOST-203). This is the one
 * module of the core that names the Node implementation, so it is the one a browser build replaces with its own.
 *
 * The file system half of the default host (`defaultHost()`) arrives with the file seam.
 *
 * @spec HOST-203
 */
export function defaultHostEnv(): HostEnv {
  return nodeHost;
}
