import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_CASES, type FixtureOperation } from "../src/browser/fixture-set.js";
import { BROWSER_REPLAY_ENGINES } from "../src/browser/replay-engines.js";
import { COMPLETE_ENGINES } from "../src/engines.js";
import { repoRoot } from "./browser-bundle.js";

/**
 * The browser's readiness checklist (HOST-263): an engine in `COMPLETE_ENGINES` must run in the browsers too. Its recorded runs are in
 * the curated set the browser replays read, one family for each operation the engine has fixtures of, and it is in
 * `BROWSER_REPLAY_ENGINES`, the engines the replays (HOST-265, HOST-266) and the parity script's browser dry run (HOST-279) run. So a
 * fourth engine cannot be completed without its browser replays: `npm test` fails here first, and names what is missing.
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

describe("HOST-263: every complete engine runs in the browsers", () => {
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

  it("BROWSER_REPLAY_ENGINES holds every complete engine", () => {
    expect(BROWSER_REPLAY_ENGINES, "add the engine to BROWSER_REPLAY_ENGINES (src/browser/replay-engines.ts)").toEqual(expect.arrayContaining([...COMPLETE_ENGINES]));
  });
});
