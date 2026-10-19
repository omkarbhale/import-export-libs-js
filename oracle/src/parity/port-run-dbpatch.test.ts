import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTransport } from "../../../src/client/fake-transport.js";
import { RecordedDbPatchServer } from "../../../src/cli/replay-db-patch-transport.js";
import { packageCaches } from "../../../src/client/package-lookups.js";
import { readTranscript } from "../transcript.js";
import { describeDifferences, diffOutcomes } from "./diff.js";
import { dbPatchIds } from "./normalize.js";
import { readOracleOutcome } from "./outcome.js";
import { dbPatchCreated, osUserOf, runPortDbPatch, type PortServer } from "./port-run.js";

/**
 * The port's DB patch runner (the live parity of wayfinder ticket 76, part B) against the recorded runs of ticket 72's fixture, served
 * by a fake server. What the runner leaves behind is compared with the recording by the comparison the live script uses, so a
 * recorded step that this does not find equal would be a false difference on dev. The ids the run makes up are numbered, not compared.
 */

vi.setConfig({ testTimeout: 60_000 });

const FIXTURES = new URL("../../../fixtures/14.35/dbpatch/", import.meta.url).pathname;
const LOGIN_CALLS = 6;

beforeEach(() => packageCaches.dependsOn.clear());

const STEPS = [
  ["apply", 1],
  ["apply", 2],
  ["non-root", 1],
] as const;

describe("the port's DB patch runner against recorded 14.35 DB patch steps", () => {
  it.for(STEPS.map((entry) => [...entry] as [string, number]))("%s step %i", async ([name, stepNumber]) => {
    const dir = join(FIXTURES, name, `step-${stepNumber}`);
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { params: { Url: string; Database: string; User: string } };
    const recorded = new RecordedDbPatchServer(readTranscript(join(dir, "transcript.jsonl"), join(FIXTURES, "_blobs")));
    const server: PortServer = {
      engine: "14.35",
      url: "http://dev.example/12sp9",
      logUrl: run.params.Url,
      database: run.params.Database,
      userName: run.params.User,
      password: "not-a-real-password",
      transport: new FakeTransport(recorded.handler),
    };
    const oracle = readOracleOutcome(dir);
    // a live server takes the id the engine asks for; the recorded one answers with the oracle's, so the port asks for the same
    const asked = oracle.calls.flatMap((call) => (call.action === "ApplyItem" && /\baction="add"/.test(call.request) ? [/\bid="([0-9A-F]{32})"/.exec(call.request)![1]!] : []));
    const { outcome, created } = await runPortDbPatch(server, { preconditions: false, newId: () => asked.shift()! }, osUserOf(oracle.calls));

    expect(recorded.mismatches, "the requests the recording does not hold").toEqual([]);
    expect(
      describeDifferences(diffOutcomes(oracle, outcome, { skipCalls: LOGIN_CALLS, madeBefore: { oracle: dbPatchIds(oracle.calls), port: dbPatchIds(outcome.calls) } })),
    ).toEqual([]);
    // the cleanup deletes what the port made: three items in the first run of the patch, in the order it made them, none in a refused run
    expect(created.map((item) => item.type)).toEqual(name === "apply" && stepNumber === 1 ? ["DatabaseUpgrade", "Applied Updates", "DatabaseUpgradePatch"] : []);
    expect(dbPatchCreated(oracle.calls).map((item) => item.type)).toEqual(created.map((item) => item.type));
  });
});
