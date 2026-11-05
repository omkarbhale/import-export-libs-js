import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * What the replays of the recorded DB patch runs share: the disk replay (`replay.test.ts`) and the replay on the in-memory file
 * system (`src/browser/vfs-replay.*.test.ts`, HOST-218). These were private to the disk test and moved here unchanged.
 */
export const CASES = new URL("../../fixtures/14.35/dbpatch/", import.meta.url).pathname;

export { LOGIN_CALLS, RecordedConnection, field, masked } from "./recorded-connection.js";

/** The recorded steps of a case: the folders that hold a transcript. */
export const steps = (caseName: string): string[] => readdirSync(join(CASES, caseName)).filter((name) => existsSync(join(CASES, caseName, name, "transcript.jsonl")));
