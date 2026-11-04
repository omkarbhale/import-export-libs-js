import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import { browserBundleOptions, repoRoot } from "./browser-bundle.js";

/**
 * The size the browser bundle may not exceed: the bytes of its output as esbuild writes it (not minified, no banner), which were
 * 1 087 776 when the entry was added (all of the engine's code, the Windows and NLS collation tables, `@xmldom/xmldom`, `xpath`
 * and the `buffer` shim), plus 20 %. Raise it in a pull request that adds code on purpose, and say so there.
 *
 * @spec HOST-260
 */
const BUNDLE_BUDGET_BYTES = 1_305_000;

/**
 * Free identifiers that name Node and have no meaning in a browser. esbuild's `define` replaces a reference to a name that nothing
 * in the bundle declares, and only that (not a string, a comment or a property), so a replaced name left in the output is a call
 * into Node that the bundle still makes. `require` is not in the list: esbuild itself turns the `require` of a CommonJS package
 * into a bundled module.
 */
const NODE_GLOBALS = ["process", "__dirname", "__filename", "setImmediate", "global"];
const FORBIDDEN = (name: string): string => `__NODE_GLOBAL_${name}__`;

const bundleOptions = {
  ...browserBundleOptions(),
  write: false,
  metafile: true,
  outfile: "browser.js",
  define: Object.fromEntries(NODE_GLOBALS.map((name) => [name, FORBIDDEN(name)])),
} as const;

const scratch = mkdtempSync(path.join(tmpdir(), "libsjs-browser-bundle-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The browser bundle's rules (HOST-260): it is built from the entry with the browser's plugin and injection, as `npm run build`
// builds it, and nothing of Node may be in it.
describe("the browser bundle", () => {
  const built = build(bundleOptions);

  it("contains no module of Node", async () => {
    const { metafile } = await built;
    const inputs = Object.keys(metafile.inputs);
    expect(inputs.filter((input) => input.startsWith("node:"))).toEqual([]);
    expect(inputs).toContain("src/host/default-host.browser.ts");
    expect(inputs).not.toContain("src/host/default-host.ts");
    expect(inputs).not.toContain("src/host/node-fs.ts");
    expect(inputs).not.toContain("src/host/node-transport.ts");
  });

  it("refers to no free Node global", async () => {
    const { outputFiles } = await built;
    const text = outputFiles[0]!.text;
    const found = NODE_GLOBALS.filter((name) => text.includes(FORBIDDEN(name)));
    expect(found, `The bundle uses these Node globals, which have no meaning in a browser: ${found.join(", ")}`).toEqual([]);
  });

  it("imports nothing: every package it needs is inlined", async () => {
    const { metafile } = await built;
    const imports = Object.values(metafile.outputs).flatMap((output) => output.imports);
    expect(imports).toEqual([]);
  });

  it("stays within its size budget", async () => {
    const { outputFiles } = await built;
    const size = outputFiles[0]!.contents.length;
    console.info(`browser bundle: ${size} bytes (budget ${BUNDLE_BUDGET_BYTES})`);
    expect(size, `The browser bundle is ${size} bytes; the budget is ${BUNDLE_BUDGET_BYTES}. See BUNDLE_BUDGET_BYTES in tools/browser-bundle.test.ts.`).toBeLessThanOrEqual(BUNDLE_BUDGET_BYTES);
  });

  it("needs the plugin: without it the entry reaches node:fs and does not build for a browser", async () => {
    await expect(build({ ...bundleOptions, plugins: [] })).rejects.toThrow(/node:/);
  });

  it("loads in Node, and createBrowserHost works with fakes (smoke)", async () => {
    const outfile = path.join(scratch, "browser.mjs");
    await build({ ...browserBundleOptions(), outfile });
    const browser = (await import(pathToFileURL(outfile).href)) as typeof import("../src/browser.js");
    const host = browser.createBrowserHost({
      cwd: "/work",
      osUser: "tester",
      globals: { performance: { now: () => 1.5 }, crypto: { getRandomValues: (array) => array } },
    });
    expect(host.env.platform).toBe("browser");
    expect(host.env.cwd()).toBe("/work");
    expect(host.env.monotonicNs()).toBe(1_500_000n);
    expect(host.env.randomBytes(4).length).toBe(4);
    // No file system is mounted: a file call says so, and the library is otherwise loaded.
    expect(() => host.fs.exists("/x")).toThrow(/fs/);
    expect(browser.ENGINES).toContain("14.0.7");
    expect(typeof browser.ImportExportManager).toBe("function");
    expect(browser.LIBRARY_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// The aliasing is the browser build's alone (HOST-260): the Node entry's bundle, built as the Node build builds it and not through
// the plugin, still names the Node modules.
describe("the Node bundle", () => {
  it("still contains node:http, node:fs and node:crypto", async () => {
    const result = await build({
      entryPoints: [path.join(repoRoot, "src/index.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
      logLevel: "silent",
    });
    const text = result.outputFiles[0]!.text;
    for (const name of ["node:http", "node:https", "node:fs", "node:crypto"]) expect(text, name).toContain(`"${name}"`);
  });
});
