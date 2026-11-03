import { nodeFs } from "./node-fs.js";
import { nodeHost } from "./node.js";
import type { Host, HostEnv } from "./types.js";

/**
 * The host of the running platform, which a `PathEnvironment` without an `fs` or a `host` falls back to (HOST-200, HOST-203,
 * HOST-210): on Node, `node:fs` and the process. This is the one module of the core that names the Node implementations, so it is
 * the one a browser build replaces with its own.
 *
 * @spec HOST-200 HOST-203 HOST-210
 */
export function defaultHost(): Host {
  return nodeDefaultHost;
}

const nodeDefaultHost: Host = { fs: nodeFs, env: nodeHost };

/**
 * The environment half of {@link defaultHost}.
 *
 * @spec HOST-203
 */
export function defaultHostEnv(): HostEnv {
  return nodeHost;
}
