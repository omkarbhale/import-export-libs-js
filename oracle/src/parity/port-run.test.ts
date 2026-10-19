import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTransport } from "../../../src/client/fake-transport.js";
import { packageCaches } from "../../../src/client/package-lookups.js";
import { RecordedServer } from "../../../src/cli/replay-transport.js";
import { readTranscript } from "../transcript.js";
import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import type { ImportOptions } from "../import-cases.js";
import { diffOutcomes, describeDifferences } from "./diff.js";
import { osUserOf, runPortExport, runPortImport, runPortLanguagePack, selectionOf, type PortServer } from "./port-run.js";
import { readOracleOutcome } from "./outcome.js";

/**
 * The port's live runners, run against a fake server that serves a recorded fixture. The parity script runs the same code against
 * dev, so a recorded case that the runner and the diff do not find equal here would be a false difference there. The fixture's
 * login calls (six on 14.0.7) are the fake server's own, so they are left out of the comparison.
 */

vi.setConfig({ testTimeout: 180_000 });

const LOGIN_CALLS = 6;
const FIXTURES = new URL("../../../fixtures/14.0.7/", import.meta.url).pathname;

beforeEach(() => packageCaches.dependsOn.clear());

interface RunFile {
  params: { Url: string; Database: string; User: string };
}

function serverFor(dir: string, blobs: string): { server: PortServer; recorded: RecordedServer } {
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunFile;
  const recorded = new RecordedServer(readTranscript(join(dir, "transcript.jsonl"), blobs));
  const transport = new FakeTransport(recorded.handler);
  return {
    recorded,
    server: {
      engine: "14.0.7",
      url: "http://dev.example/12sp9",
      logUrl: run.params.Url,
      database: run.params.Database,
      userName: run.params.User,
      password: "not-a-real-password",
      transport,
    },
  };
}

interface ExportCaseFile {
  packages: ExportCasePackage[];
  options: ExportCaseOptions;
}

const EXPORTS = [
  "e24-grid",
  "e14-list",
  "p3-absent-package",
  "e40-workflow-promotion-error-yes",
  "e40-workflow-promotion-error-no",
  "e06-scopecachedependency-removewithwarning",
  "p1-order-admin-core-cui",
  "opt-verbose",
];

describe("the port's export runner against recorded 14.0.7 export cases", () => {
  it.for(EXPORTS.map((name) => [name] as const))("%s", async ([name]) => {
    const dir = join(FIXTURES, "export", name);
    const blobs = join(FIXTURES, "export", "_blobs");
    const input = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as ExportCaseFile;
    const { server, recorded } = serverFor(dir, blobs);
    const oracle = readOracleOutcome(dir, { filesFrom: "output", blobs });
    const run = await runPortExport(server, { selection: selectionOf(input.packages), options: input.options });
    // git keeps no empty folder, so a committed fixture cannot hold the empty ones the live run leaves
    const port = { ...run, files: new Map([...run.files!].filter(([path]) => !path.endsWith("/"))) };

    expect(recorded.mismatches, "the requests the recording does not hold").toEqual([]);
    expect(describeDifferences(diffOutcomes(oracle, port, { skipCalls: LOGIN_CALLS }))).toEqual([]);
    expect(port.calls.length).toBe(oracle.calls.length);
  });
});

interface ImportCaseFile {
  steps: Array<{ options: ImportOptions; only?: string[] }>;
}

const IMPORTS: ReadonlyArray<readonly [string, number]> = [
  ["s0-mini-defaults", 1],
  ["s0-mini-cancel", 1],
  ["s0-mini-merge", 1],
  ["s0-mini-verbose", 1],
  ["s4-del-refused", 1],
  ["s3-unres-delayed", 1],
];

describe("the port's import runner against recorded 14.0.7 import steps", () => {
  it.for(IMPORTS.map((entry) => [...entry] as [string, number]))("%s step %i", async ([name, stepNumber]) => {
    const caseDir = join(FIXTURES, "import", name);
    const dir = join(caseDir, `step-${stepNumber}`);
    const blobs = join(FIXTURES, "import", "_blobs");
    const definition = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as ImportCaseFile;
    const step = definition.steps[stepNumber - 1]!;
    const { server, recorded } = serverFor(dir, blobs);
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

describe("the port's language-pack runner against recorded 14.0.7 lpimport runs", () => {
  it.for([["lp01"], ["lp04"], ["lp05"]] as const)("%s", async ([name]) => {
    const dir = join(FIXTURES, "language-pack", name);
    const blobs = join(FIXTURES, "language-pack", "_blobs");
    const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { lpPackage: string; lpDebug: boolean };
    const { server, recorded } = serverFor(dir, blobs);
    const oracle = readOracleOutcome(dir, { blobs, ...(definition.lpDebug ? { filesFrom: "temp-package" } : {}) });
    const { outcome } = await runPortLanguagePack(server, { lpDir: join(dir, "lp"), lpPackage: definition.lpPackage, lpDebug: definition.lpDebug }, osUserOf(oracle.calls));

    expect(recorded.mismatches, "the requests the recording does not hold").toEqual([]);
    expect(describeDifferences(diffOutcomes(oracle, outcome, { skipCalls: LOGIN_CALLS }))).toEqual([]);
  });
});
