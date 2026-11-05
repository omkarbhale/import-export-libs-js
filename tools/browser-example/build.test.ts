import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExample } from "./build.js";

/**
 * The static folder of the reference page (HOST-280): what the build writes is what a static server serves, the page's script and the
 * engine's Worker beside it, and nothing in either reaches Node (HOST-260).
 *
 * @spec HOST-280
 */

let out: string | undefined;
afterEach(() => {
  if (out !== undefined) rmSync(out, { recursive: true, force: true });
  out = undefined;
});

describe("buildExample", () => {
  it("writes the page, its script and the Worker the script starts, with no Node API in either", async () => {
    out = mkdtempSync(path.join(os.tmpdir(), "aras-pkg-example-"));
    await buildExample(out);
    expect(readdirSync(out).sort()).toEqual(["browser-worker.js", "browser-worker.js.map", "index.html", "main.js", "main.js.map", "style.css"]);
    const html = readFileSync(path.join(out, "index.html"), "utf8");
    expect(html).toContain('src="main.js"');
    for (const file of ["main.js", "browser-worker.js"]) {
      const text = readFileSync(path.join(out, file), "utf8");
      expect(text.length, file).toBeGreaterThan(100_000);
      expect(text, file).not.toMatch(/(?:from|import|require)\s*\(?\s*["']node:/);
    }
    // the script starts the Worker from the file beside it, which is the library's default
    expect(readFileSync(path.join(out, "main.js"), "utf8")).toContain('new URL("./browser-worker.js", import.meta.url)');
  }, 60_000);
});
