/**
 * The browser entry point: the portable core (`core.ts`) and the browser's implementations of the host seam. It has no Node API:
 * nothing it reaches imports `node:*` or reads `process`, which `tools/browser-bundle.test.ts` and `tsconfig.browser.json` hold
 * (HOST-260). A caller builds a host with {@link createBrowserHost}, mounts a file system in it, and passes both in the
 * `PathEnvironment` of a run.
 *
 * @spec HOST-260
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
export { LIBRARY_VERSION } from "./version.js";
