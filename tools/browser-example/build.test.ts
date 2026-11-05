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
  it("writes the page, its script and the Worker, with no Node API in either", async () => {
    out = mkdtempSync(path.join(os.tmpdir(), "aras-pkg-example-"));
    await buildExample(out);
    expect(readdirSync(out).sort()).toEqual(["browser-worker.js", "browser-worker.js.map", "index.html", "main.js", "main.js.map", "style.css"]);
    for (const file of ["main.js", "browser-worker.js"]) {
      const text = readFileSync(path.join(out, file), "utf8");
      expect(text.length, file).toBeGreaterThan(100_000);
      expect(text, file).not.toMatch(/(?:from|import|require)\s*\(?\s*["']node:/);
    }
  }, 60_000);
});
