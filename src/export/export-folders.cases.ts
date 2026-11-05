import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Engine } from "../engines.js";
import { exportCases } from "./replay-cases.js";
import type { Case } from "./replay-cases.js";

/**
 * The case table of `export-folders.test.ts` (EXP-400 to EXP-428), kept here as data so that `fs-matrix.test.ts` runs the same
 * cases on both file systems (HOST-217). `export-folders.test.ts` imports it.
 * @spec HOST-217
 */

/** The modes of unknown references that remove them: they need the run's table and log, so `run-replay.test.ts` replays those cases. */
export const REMOVAL_MODES: readonly string[] = ["RemoveSilently", "RemoveWithWarning"];

/** The names of the recorded export cases of an engine that the folder replay runs: those that ask for no removal mode. */
export function exportFolderCaseNames(engine: Engine): string[] {
  const cases = exportCases(engine);
  return cases.names.filter((name) => {
    const mode = (JSON.parse(readFileSync(join(cases.dir, name, "case.json"), "utf8")) as Case).options.refToUnknownPacks;
    return mode === undefined || !REMOVAL_MODES.includes(mode);
  });
}
