import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { fixtureCommands, adapterCommands, replaceDefaultHostForVite, workerCommands } from "./tools/browser-vitest.js";
import { readSelectionFile } from "./tools/browser-test-selection.js";
import { ISOLATION_HEADERS, serveSynthPackages, sizeCommands } from "./tools/browser-size.js";

/**
 * Four projects (HOST-263, HOST-268, HOST-278). `node` is the suite as it always was; `npm test` runs it alone. `browser` runs the `*.browser.test.ts`
 * files and the unit tests of `src/browser/pure-tests.json` in headless Chromium, Firefox and WebKit, `browser-webkit-opfs` runs
 * the OPFS adapter test in WebKit in a persistent profile, and `browser-size` runs the size budget (`npm run test:browser:size`).
 * `npm run test:browser` runs the browser projects (`browser*`), and a browser failure names the browser.
 */

type Instance = { browser: "chromium" | "firefox" | "webkit" };

type ProjectOptions = {
  env?: Record<string, string>;
  globalSetup?: string[];
  exclude?: string[];
  testTimeout?: number;
  hookTimeout?: number;
  plugins?: Plugin[];
  server?: { headers: Record<string, string> };
  commands?: Partial<typeof sizeCommands>;
};

/** A project of the real browsers: the same page, setup and commands for each (HOST-263); `provider`, `include` and the options are what differ. */
function browserProject(name: string, instances: Instance[], provider: ReturnType<typeof playwright>, include: string[], { plugins = [], server, commands = {}, ...test }: ProjectOptions = {}) {
  return {
    plugins: [replaceDefaultHostForVite(), ...plugins],
    // The page's `Buffer` is the `buffer` package; its CommonJS source is bundled once up front so that the first run does not reload the page.
    optimizeDeps: { include: ["buffer/index.js"] },
    ...(server ? { server } : {}),
    test: {
      name,
      include,
      setupFiles: ["src/browser/buffer-setup.browser.ts"],
      // A recorded run is an export or an import over a case of tens of megabytes in a page: slower than on Node.
      testTimeout: 120_000,
      ...test,
      browser: {
        enabled: true,
        provider,
        headless: true,
        instances,
        commands: { ...fixtureCommands, ...workerCommands, ...adapterCommands, ...commands },
      },
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts", "spec/**/*.test.ts", "tools/**/*.test.ts", "oracle/**/*.test.ts"],
          // A browser test needs a page; it belongs to the project below.
          exclude: [...configDefaults.exclude, "**/*.browser.test.ts"],
          // The replay and coverage tests parse large recorded documents; under a full parallel run they outlast the 5 s default.
          testTimeout: 60_000,
        },
      },
      browserProject("browser", [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }], playwright(), [
        "src/**/*.browser.test.ts",
        // The unit tests whose import closure reaches no Node API run here too, unedited (HOST-264; `npx tsx tools/browser-test-selection.ts --write` writes the list).
        ...readSelectionFile().files,
        // The global setup is the HTTP server that the wire tests talk to, in another origin (HOST-234).
      ], {
        globalSetup: ["tools/browser-wire-setup.ts"],
        // the size budget has a project of its own (below): its packages are generated and its runs take minutes to hours
        exclude: [...configDefaults.exclude, "src/browser/size.browser.test.ts"],
      }),
      // WebKit as Playwright drives it has no origin private file system in the context it makes for a page (`navigator.storage.getDirectory()` rejects with
      // an `UnknownError`, as in a private window), but has one in a persistent context. The OPFS adapter test (HOST-252, HOST-253) therefore also runs in
      // WebKit here, in a profile folder of its own under `node_modules/.cache` (HOST-268).
      browserProject("browser-webkit-opfs", [{ browser: "webkit" }], playwright({ persistentContext: "./node_modules/.cache/vitest-playwright-webkit-profile" }), [
        "src/browser/opfs-adapter.browser.test.ts",
      ], { env: { LIBSJS_PERSISTENT_PROFILE: "1" } }),
      browserProject("browser-size", [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }], playwright(), ["src/browser/size.browser.test.ts"], {
        plugins: [serveSynthPackages()],
        // cross-origin isolation, so that `performance.measureUserAgentSpecificMemory()` is allowed (HOST-278)
        server: { headers: { ...ISOLATION_HEADERS } },
        globalSetup: ["tools/browser-size-setup.ts"],
        // a package of 500 MB takes the engine tens of minutes in a page (HOST-278)
        testTimeout: 4 * 60 * 60_000,
        hookTimeout: 4 * 60 * 60_000,
        commands: sizeCommands,
      }),
    ],
  },
});
