import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Step } from "./replay-compare.js";

/**
 * What the replays of the recorded import runs share: the disk replay (`import-run.replay.test.ts`) and the replay on the in-memory
 * file system (`src/browser/vfs-replay.*.test.ts`, HOST-218). Everything here reads only the recording of a case, never the folder a run
 * works in. These were private to the disk test and moved here unchanged. What reads no file moved on to `replay-compare.ts`, which a
 * browser page can import (HOST-266), and is exported again from here under its old names.
 */

export type { Step } from "./replay-compare.js";
export { CLOCK, TIME_SPAN, comparable, headerValue, recordedConsole } from "./replay-compare.js";

/**
 * The steps of a recorded case folder. `skip` names the cases that exercise what another slice builds.
 */
export function stepsOf(casesDir: string, skip: (name: string) => boolean = () => false): Step[] {
  return readdirSync(casesDir)
    .filter((name) => existsSync(join(casesDir, name, "case.json")) && !skip(name))
    .flatMap((name) => {
      const definition = JSON.parse(readFileSync(join(casesDir, name, "case.json"), "utf8")) as { steps: Omit<Step, "name" | "dir">[] };
      return definition.steps.map((step, index) => ({
        name: `${name}/step-${index + 1}`,
        dir: join(casesDir, name, `step-${index + 1}`),
        options: step.options ?? {},
        ...(step.only === undefined ? {} : { only: step.only }),
      }));
    });
}
