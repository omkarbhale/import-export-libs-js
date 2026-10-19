import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTransport } from "../../../src/client/fake-transport.js";
import { packageCaches } from "../../../src/client/package-lookups.js";
import { RecordedServer } from "../../../src/cli/replay-transport.js";
import type { ImportOptions } from "../import-cases.js";
import { readTranscript } from "../transcript.js";
import { describeDifferences, diffOutcomes } from "./diff.js";
import { readOracleOutcome } from "./outcome.js";
import { osUserOf, runPortImport, runPortLanguagePack, type PortServer } from "./port-run.js";

/**
 * The port's import runner for 14.35 (the live parity of wayfinder ticket 76, part B) against the recorded 14.35 import steps of
 * ticket 75: the AML batch mode, the collected errors and the language selection, with the constructor that scans the packages. A
 * fake server serves the recording; what the runner leaves behind is compared with it by the comparison the live script uses.
 */

vi.setConfig({ testTimeout: 180_000 });

const LOGIN_CALLS = 6;
const FIXTURES = new URL("../../../fixtures/14.35/", import.meta.url).pathname;

beforeEach(() => packageCaches.dependsOn.clear());

interface CaseFile {
  steps: Array<{ options: ImportOptions; only?: string[] }>;
}

const STEPS: ReadonlyArray<readonly [string, number]> = [
  ["s0-mini-defaults", 1],
  ["batch-size-3", 1],
  ["batch-server-failure", 1],
  ["collect-two-errors-max3", 1],
  ["collect-cancel", 1],
  ["lang-select-en", 1],
  ["lang-not-installed", 1],
  ["lang-star-not-installed", 1],
  ["lang-apostrophe", 1],
  ["lang-scan-stray-file", 1],
];

describe("the port's import runner against recorded 14.35 import steps", () => {
  it.for(STEPS.map((entry) => [...entry] as [string, number]))("%s step %i", async ([name, stepNumber]) => {
    const caseDir = join(FIXTURES, "import", name);
    const dir = join(caseDir, `step-${stepNumber}`);
    const blobs = join(FIXTURES, "import", "_blobs");
    const definition = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as CaseFile;
    const step = definition.steps[stepNumber - 1]!;
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { params: { Url: string; Database: string; User: string } };
    const recorded = new RecordedServer(readTranscript(join(dir, "transcript.jsonl"), blobs));
    const server: PortServer = {
      engine: "14.35",
      url: "http://dev.example/12sp9",
      logUrl: run.params.Url,
      database: run.params.Database,
      userName: run.params.User,
      password: "not-a-real-password",
      transport: new FakeTransport(recorded.handler),
    };
    const oracle = readOracleOutcome(dir, { blobs });
    const { outcome } = await runPortImport(
      server,
      { inputDir: join(dir, "input"), options: step.options, ...(step.only === undefined ? {} : { only: step.only }) },
      osUserOf(oracle.calls),
    );

    expect(recorded.mismatches, "the requests the recording does not hold").toEqual([]);
    expect(describeDifferences(diffOutcomes(oracle, outcome, { skipCalls: LOGIN_CALLS }))).toEqual([]);
  });
});

// lp04 runs with LPDebug and keeps its temp package, which the committed fixture holds no copy of (the live run compares it)
describe("the port's language-pack runner against recorded 14.35 lpimport runs", () => {
  it.for([["lp01"], ["lp05"], ["lp06"], ["lp07"], ["lp08"]] as const)("%s", async ([name]) => {
    const dir = join(FIXTURES, "language-pack", name);
    const blobs = join(FIXTURES, "language-pack", "_blobs");
    const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { lpPackage: string; lpDebug: boolean; languages?: string[] };
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { params: { Url: string; Database: string; User: string } };
    const recorded = new RecordedServer(readTranscript(join(dir, "transcript.jsonl"), blobs));
    const server: PortServer = {
      engine: "14.35",
      url: "http://dev.example/12sp9",
      logUrl: run.params.Url,
      database: run.params.Database,
      userName: run.params.User,
      password: "not-a-real-password",
      transport: new FakeTransport(recorded.handler),
    };
    const oracle = readOracleOutcome(dir, { blobs, ...(definition.lpDebug ? { filesFrom: "temp-package" } : {}) });
    const { outcome } = await runPortLanguagePack(
      server,
      { lpDir: join(dir, "lp"), lpPackage: definition.lpPackage, lpDebug: definition.lpDebug, ...(definition.languages === undefined ? {} : { languages: definition.languages }) },
      osUserOf(oracle.calls),
    );

    expect(recorded.mismatches, "the requests the recording does not hold").toEqual([]);
    expect(describeDifferences(diffOutcomes(oracle, outcome, { skipCalls: LOGIN_CALLS }))).toEqual([]);
  });
});
