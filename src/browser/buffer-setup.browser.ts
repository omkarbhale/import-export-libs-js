import { Buffer as ShimBuffer } from "./buffer-shim.js";

/**
 * Defines the global `Buffer` of a browser test page as the `buffer` package (HOST-262, HOST-263), before any test file is
 * loaded: the page has no `Buffer`, and the core is written against one. The bundle gets the same global from esbuild's `inject`
 * of `buffer-shim.ts`; a per-file transform cannot inject, so the browser project's `setupFiles` runs this module instead.
 *
 * @spec HOST-262 HOST-263
 */
(globalThis as { Buffer?: unknown }).Buffer = ShimBuffer;
