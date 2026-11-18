import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_CASES, type FixtureOperation } from "../src/browser/fixture-set.js";
import { COMPLETE_ENGINES, ENGINES } from "../src/engines.js";
import { repoRoot } from "./browser-bundle.js";

/**
 * The browser's readiness checklist (HOST-263): an engine in `COMPLETE_ENGINES` must run in the browsers too. Its recorded runs are in
 * the curated set the browser replays read, one family for each operation the engine has fixtures of, and the files that replay them
 * (HOST-265, HOST-266) and the parity script's browser dry run (HOST-279) list it. So a fourth engine cannot be completed without its
 * browser replays: `npm test` fails here first, and names what is missing.
 *
 * The replay files are not edited by this test; their engine lists are read from their text, as arrays of engine names.
 *
 * @spec HOST-263 HOST-265 HOST-266 HOST-279
 */

/** The operations an engine has recorded runs of, by the folders of `fixtures/<engine>/`. */
function recordedOperations(engine: string): FixtureOperation[] {
  const operations: FixtureOperation[] = ["export", "import", "language-pack", "dbpatch"];
  return operations.filter((operation) => {
    const dir = path.join(repoRoot, "fixtures", engine, operation);
    return existsSync(dir) && readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && !entry.name.startsWith("_"));
  });
}

/** The files whose engine lists decide which engines the browser runs, with what each one replays. */
const REPLAY_FILES: ReadonlyArray<{ file: string; what: string }> = [
  { file: "src/browser/export-replay.browser.test.ts", what: "the recorded export runs (HOST-265)" },
  { file: "src/browser/import-replay.browser.test.ts", what: "the recorded import runs (HOST-266)" },
  { file: "oracle/src/parity/browser-runner.browser.test.ts", what: "the parity script's browser dry run (HOST-279)" },
];

const ENGINE_NAME = String.raw`"\d+(?:\.\d+)+"`;
const ENGINE_LIST = new RegExp(String.raw`\[\s*${ENGINE_NAME}(?:\s*,\s*${ENGINE_NAME})*\s*,?\s*\]`, "g");

/** Every array literal of engine names in a file's text. */
function engineListsOf(text: string): string[][] {
  return [...text.matchAll(ENGINE_LIST)].map((match) => [...match[0].matchAll(/"([^"]+)"/g)].map((name) => name[1] as string));
}

describe("HOST-263: every complete engine runs in the browsers", () => {
  it("reads the engine lists of a file", () => {
    expect(engineListsOf(`const A = ["12.0", "14.0.7"];\nfor (const e of [\n  "14.35",\n] as const) {}\nconst B = ["x"];`)).toEqual([["12.0", "14.0.7"], ["14.35"]]);
  });

  it.each(COMPLETE_ENGINES)("%s: the curated set has a recorded run of each operation the engine has fixtures of", (engine) => {
    const operations = recordedOperations(engine);
    expect(operations, `${engine} has recorded export and import runs`).toEqual(expect.arrayContaining(["export", "import"]));
    for (const operation of operations) {
      expect(
        FIXTURE_CASES.filter((fixture) => fixture.engine === engine && fixture.operation === operation).length,
        `${engine} ${operation}: add its cases to FIXTURE_CASES (src/browser/fixture-set.ts)`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(REPLAY_FILES)("$what list every complete engine ($file)", ({ file }) => {
    const lists = engineListsOf(readFileSync(path.join(repoRoot, file), "utf8"));
    const covering = lists.filter((list) => COMPLETE_ENGINES.every((engine) => list.includes(engine)));
    expect(covering.length, `${file}: no list of engines holds ${COMPLETE_ENGINES.join(", ")}`).toBeGreaterThan(0);
    for (const list of lists) for (const engine of list) expect(ENGINES, `${file}: an engine name the library does not have`).toContain(engine);
  });
});
