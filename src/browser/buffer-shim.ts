/**
 * The `Buffer` of the browser bundle: the `buffer` package (feross, MIT), re-exported so that the bundler can inject it as the
 * global `Buffer` the core's code is written against (roadmap/browser-host.md, D5; the injection itself is the `inject` of `tsup.browser.config.ts`).
 * Node keeps its own `Buffer`: nothing under `src/` imports this module, only that config and the conformance
 * suite, which compares the two.
 *
 * The specifier is `buffer/index.js`, not `buffer`: the bare name is the Node built-in, which Node (and vitest) resolve first,
 * so only the explicit file reaches the package from a test, and esbuild resolves it the same way for the bundle.
 * @spec HOST-262
 */
export { Buffer } from "buffer/index.js";
