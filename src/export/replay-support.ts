import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Case, ExportCases } from "./replay-cases.js";
import { settingsFrom } from "./replay-compare.js";

/**
 * What the replays of the recorded export cases share: the disk replays (`run-replay.test.ts`, `run-replay-1435.test.ts`) and the
 * replays on the in-memory file system (`src/browser/vfs-replay.*.test.ts`, HOST-218). The comparisons are pure and are in
 * `replay-compare.ts` (HOST-265), so that a browser can import them; they are re-exported here, so every importer of this file is as
 * it was, and this file adds what reads the disk.
 */

export * from "./replay-compare.js";

export const read = (cases: ExportCases, name: string, file: string): string => readFileSync(join(cases.dir, name, file), "utf8");

/** The settings the oracle host gave a case: the 14.0.7 log header names them, and 12.0 has no header, so the case's options do. */
export function settings(cases: ExportCases, name: string, input: Case, recordedLog: string): Record<string, unknown> {
  return settingsFrom(cases.engine, input, recordedLog, cases.engine === "12.0" ? read(cases, name, "run.json") : undefined);
}
