import { defineConfig } from "tsup";
import { BROWSER_ENTRY, BUFFER_SHIM, BUNDLED_PACKAGES, licenseBanner, replaceDefaultHost } from "./tools/browser-bundle.js";

// The browser entry (HOST-260): one self-contained ES module, `dist/browser.js`, with its declarations. It is built after the Node
// build (`npm run build`), which owns `clean`, so that the two never race for the output folder. `tools/browser-bundle.ts` holds
// what the guard test builds with, the same plugin and the same injection.
export default defineConfig({
  entry: { browser: BROWSER_ENTRY },
  format: ["esm"],
  target: "es2022",
  platform: "browser",
  dts: { entry: { browser: BROWSER_ENTRY } },
  clean: false,
  sourcemap: true,
  splitting: false,
  // One file that imports nothing: the two dependencies are inlined with the `buffer` shim and its own two, and their licences
  // are the banner.
  noExternal: [...BUNDLED_PACKAGES],
  inject: [BUFFER_SHIM],
  esbuildPlugins: [replaceDefaultHost()],
  banner: { js: licenseBanner() },
});
