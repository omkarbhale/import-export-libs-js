import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { browserBundleOptions, repoRoot } from "../../tools/browser-bundle.js";

/**
 * The harness page of the browser parity run (`oracle/src/parity/browser-page/`, HOST-279) is built from the browser build's graph.
 *
 * @spec HOST-279
 */

const PAGE_DIR = "oracle/src/parity/browser-page";
const NODE_GLOBALS = ["process", "__dirname", "__filename", "setImmediate", "global"];

async function bundle(entry: string) {
  return build({
    ...browserBundleOptions(repoRoot, `${PAGE_DIR}/${entry}`),
    write: false,
    metafile: true,
    outfile: entry.replace(/\.ts$/, ".js"),
    define: Object.fromEntries(NODE_GLOBALS.map((name) => [name, `__NODE_GLOBAL_${name}__`])),
  });
}

describe("the parity harness page's bundles", () => {
  it.each(["page.ts", "worker.ts"])("%s: no module of Node, no free Node global, no import", async (entry) => {
    const { metafile, outputFiles } = await bundle(entry);
    const inputs = Object.keys(metafile.inputs);
    expect(inputs.filter((input) => input.startsWith("node:"))).toEqual([]);
    expect(inputs).not.toContain("src/host/default-host.ts");
    expect(inputs).not.toContain("src/host/node-fs.ts");
    expect(inputs).not.toContain("src/host/node-transport.ts");
    expect(NODE_GLOBALS.filter((name) => outputFiles[0]!.text.includes(`__NODE_GLOBAL_${name}__`))).toEqual([]);
    expect(Object.values(metafile.outputs).flatMap((output) => output.imports)).toEqual([]);
  });

  it("the worker holds the engine and the page holds none of it", async () => {
    const page = Object.keys((await bundle("page.ts")).metafile.inputs);
    const worker = Object.keys((await bundle("worker.ts")).metafile.inputs);
    // the injected `Buffer` shim is all of `src/` that the page has
    expect(page.filter((input) => input.startsWith("src/") && !input.startsWith("src/browser/buffer-shim"))).toEqual([]);
    expect(worker).toContain("src/export/import-export-manager.ts");
    expect(worker).toContain("src/browser/fetch-transport.ts");
    expect(worker).toContain("src/host/memory-fs.ts");
  });
});
