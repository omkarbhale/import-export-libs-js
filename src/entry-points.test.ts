import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as browser from "./browser.js";
import * as core from "./core.js";
import * as node from "./index.js";

/**
 * The number of names the Node entry exported before `core.ts` and `browser.ts` existed: the Node API does not change (HOST-261).
 *
 * @spec HOST-261
 */
const NODE_NAMES_BEFORE = 198;

// The three entry points (HOST-260): the Node entry is the core plus the Node transport, the browser entry is the core plus the
// browser's host and transport, and neither has the other's extras.
describe("entry points", () => {
  const coreNames = Object.keys(core).sort();

  it("is the core plus nodeTransport for Node", () => {
    expect(Object.keys(node).sort()).toEqual([...coreNames, "nodeTransport"].sort());
    expect(Object.keys(node)).toHaveLength(NODE_NAMES_BEFORE);
  });

  it("is the core plus the browser host, the fetch transport and the version for the browser", () => {
    expect(Object.keys(browser).sort()).toEqual([...coreNames, "LIBRARY_VERSION", "createBrowserHost", "createFetchTransport"].sort());
  });

  it("gives the browser entry no Node API", () => {
    expect(Object.keys(browser)).not.toContain("nodeTransport");
    expect(coreNames).not.toContain("nodeTransport");
  });

  it("has an explicit browser condition and subpath in package.json (HOST-261)", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, Record<string, string>>;
      sideEffects: boolean;
      files: string[];
    };
    expect(manifest.exports["."]).toEqual({ types: "./dist/index.d.ts", browser: "./dist/browser.js", import: "./dist/index.js" });
    // `browser` precedes `import`: conditions match in order, so a bundler for browsers takes it and Node never names it.
    expect(Object.keys(manifest.exports["."]!)).toEqual(["types", "browser", "import"]);
    expect(manifest.exports["./browser"]).toEqual({ types: "./dist/browser.d.ts", import: "./dist/browser.js" });
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.files).toEqual(["dist"]);
  });
});
