import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createOutputDir } from "./output-folder.js";
import { CASES, caseNames, replayCase } from "./replay-cases.js";
import type { Case } from "./replay-cases.js";

/**
 * The recorded 14.0.7 export cases, exported by the port through the whole of `CExportItems.export` and written to disk: the
 * folder it leaves is compared with the folder the engine left (`output/` of the case), file by file and byte for byte. The
 * manifest `imports.mf` belongs to the export run (`export-run.md`). The removal of references to unknown packages needs the run's
 * table and log, so the cases that ask for a removal mode are replayed by `run-replay.test.ts`.
 */
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * Every file below a folder as a path with `/`, in sorted order, and every folder that holds a file with a trailing `/`. A folder
 * with nothing below it is left out, because git does not keep one: a recorded `output/` has none.
 */
function tree(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${prefix}${entry.name}`;
      if (!entry.isDirectory()) return [path];
      const below = tree(root, `${path}/`);
      return below.length > 0 ? [`${path}/`, ...below] : [];
    })
    .filter((path) => path !== "imports.mf")
    .sort();
}

const readsFromTheRun = (name: string): Case => JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as Case;

describe("the recorded 14.0.7 export cases, written to disk (EXP-400 to EXP-428)", () => {
  let compared = 0;
  let files = 0;

  it.each(caseNames)("%s", async (name) => {
    const input = readsFromTheRun(name);
    const mode = input.options.refToUnknownPacks;
    if (mode === "RemoveSilently" || mode === "RemoveWithWarning") return;
    const working = mkdtempSync(join(tmpdir(), "libsjs-export-"));
    roots.push(working);
    const environment = { cwd: working };
    await replayCase(name, {
      environment,
      beginPackage: (packageName, helper) => {
        helper.folder = createOutputDir(working, packageName, environment);
      },
      exportItem: async (exporter, item, level) => {
        await exporter.export(item, level);
        return undefined;
      },
    });

    const expected = join(CASES, name, "output");
    const made = tree(working);
    expect(made, `${name}: the folders and files`).toEqual(tree(expected));
    for (const path of made.filter((entry) => !entry.endsWith("/"))) {
      expect(readFileSync(join(working, path)).equals(readFileSync(join(expected, path))), `${name}: ${path} byte for byte`).toBe(true);
      files += 1;
    }
    compared += 1;
  });

  it("compared the cases that ask for no removal, and many files", () => {
    expect(compared).toBeGreaterThan(70);
    expect(files).toBeGreaterThan(100);
  });
});
