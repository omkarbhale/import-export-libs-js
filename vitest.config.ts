import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { fixtureCommands, replaceDefaultHostForVite } from "./tools/browser-vitest.js";

/**
 * Two projects (HOST-263). `node` is the suite as it always was; `npm test` runs it alone. `browser` runs the `*.browser.test.ts`
 * files in headless Chromium, Firefox and WebKit;
 * `npm run test:browser` runs it alone, and a browser failure names the browser.
 */

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
      {
        plugins: [replaceDefaultHostForVite()],
        // The page's `Buffer` is the `buffer` package; its CommonJS source is bundled once up front so that the first run does not reload the page.
        optimizeDeps: { include: ["buffer/index.js"] },
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
          setupFiles: ["src/browser/buffer-setup.browser.ts"],
          // A recorded run is an export or an import over a case of tens of megabytes in a page: slower than on Node.
          testTimeout: 120_000,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
            commands: fixtureCommands,
          },
        },
      },
    ],
  },
});
