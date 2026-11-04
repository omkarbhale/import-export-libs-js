import type { HttpTransport } from "../client/transport.js";
import { createBrowserHost } from "../browser/host.js";
import type { Host, HostEnv } from "./types.js";

/**
 * The browser's replacement of `default-host.ts` (HOST-200, HOST-243): the browser bundle and the browser test configuration map
 * `src/host/default-host.ts` to this module, so the host a `PathEnvironment` without an `fs` or a `host` falls back to is
 * {@link createBrowserHost}'s, with no `node:*` anywhere in the graph. It exports the same three functions.
 *
 * The host is made on first use, not when the module loads, so that importing the library reads no global.
 *
 * @spec HOST-200 HOST-243
 */
let browserDefaultHost: Host | undefined;

/** The host of the running platform: the browser's, with no file system mounted (a caller passes `fs` in the environment). */
export function defaultHost(): Host {
  return (browserDefaultHost ??= createBrowserHost());
}

/** The environment half of {@link defaultHost}. */
export function defaultHostEnv(): HostEnv {
  return defaultHost().env;
}

/** The transport member of the default host (HOST-230): the fetch transport in a browser. */
export function defaultTransport(): HttpTransport | undefined {
  return defaultHost().transport;
}
