import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTransport, bodyText, devServer, header, respond, type FakeHandler } from "../../../src/client/fake-transport.js";
import { documentOuterXml, parseXml } from "../../../src/client/mini-xml.js";
import { packageCaches } from "../../../src/client/package-lookups.js";
import { LOGIN_CALLS } from "../../../src/import/transcript-replay.js";
import { type TranscriptCall, readTranscript } from "../transcript.js";
import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import { describeDifferences } from "./diff.js";
import { diffExportRuns1435 } from "./diff-1435.js";
import { readOracleOutcome } from "./outcome.js";
import { runPortExport, selectionOf, type PortServer } from "./port-run.js";

/**
 * The port's export runner for 14.35 (the live parity of wayfinder ticket 76, part A) against the recorded 14.35 export cases, served
 * by a fake server that answers a request with the recorded answer of the same text in any order: 14.35 sends the requests of a
 * package's items in parallel. What the runner leaves behind is compared with the recording by the comparison the live script uses
 * (EXP-558), so a recorded case this does not find equal would be a false difference on dev.
 */

vi.setConfig({ testTimeout: 180_000 });

const FIXTURES = new URL("../../../fixtures/14.35/export/", import.meta.url).pathname;
const LOGIN_REQUEST = /^<Item type="User" action="get" select="default_vault"|<name>Version(Major|Minor|ServicePack|Build|ServiceUpdate)<\/name>/;
const DECLARATION = /^<\?xml[^>]*\?>/;

beforeEach(() => packageCaches.dependsOn.clear());

/** Answers every request after the login with an unused recorded call of the same action and text. */
class UnorderedServer {
  readonly mismatches: string[] = [];
  private readonly used: boolean[];
  private readonly login = devServer();

  constructor(private readonly calls: readonly TranscriptCall[]) {
    this.used = calls.map((_, index) => index < LOGIN_CALLS);
  }

  readonly handler: FakeHandler = (request, index) => {
    const action = header(request, "SOAPAction");
    if (action === undefined || !["ApplyAML", "ApplyItem", "ApplySQL"].includes(action)) return this.login(request, index);
    const wire = documentOuterXml(parseXml(bodyText(request).replace(DECLARATION, "")));
    if (LOGIN_REQUEST.test(wire)) return this.login(request, index);
    // a repeat of a request the port sent is answered again: two workers that miss a cache together ask twice
    const at = this.calls.findIndex((call, i) => !this.used[i] && call.action === action && call.request === wire);
    const again = at >= 0 ? at : this.calls.findIndex((call) => call.action === action && call.request === wire);
    if (again < 0) {
      this.mismatches.push(`${action} ${wire.slice(0, 300)}`);
      return this.login(request, index);
    }
    this.used[again] = true;
    return respond(this.calls[again]?.response ?? "");
  };
}

interface CaseFile {
  packages: ExportCasePackage[];
  options: ExportCaseOptions;
}

const CASES = [
  "e24-grid",
  "e14-list",
  "p1-order-admin-core-cui",
  "x-par-18-lists-run1",
  "x-par-two-packages-run2",
  "x-abort-middle-no",
  "x-abort-two-failures",
  "x-cancel-after-5-run1",
  "l1-only-star",
  "l1-meta-star",
  "lang-only-de-instances",
  "lang-both-packages-only-star",
  "opt-verbose",
];

describe("the port's export runner against recorded 14.35 export cases", () => {
  it.for(CASES.map((name) => [name] as const))("%s", async ([name]) => {
    const dir = join(FIXTURES, name);
    const blobs = join(FIXTURES, "_blobs");
    const input = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as CaseFile;
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { params: { Url: string; Database: string; User: string } };
    const calls = readTranscript(join(dir, "transcript.jsonl"), blobs);
    const recorded = new UnorderedServer(calls);
    const server: PortServer = {
      engine: "14.35",
      url: "http://dev.example/12sp9",
      logUrl: run.params.Url,
      database: run.params.Database,
      userName: run.params.User,
      password: "not-a-real-password",
      transport: new FakeTransport(recorded.handler),
    };
    const oracle = readOracleOutcome(dir, { filesFrom: "output", blobs });
    const made = await runPortExport(server, { selection: selectionOf(input.packages), options: input.options });
    // git keeps no empty folder, so a committed fixture cannot hold the empty ones the live run leaves
    const port = { ...made, files: made.files === null ? null : new Map([...made.files].filter(([path]) => !path.endsWith("/"))) };

    expect(recorded.mismatches, "the requests the recording does not hold").toEqual([]);
    expect(describeDifferences(diffExportRuns1435(oracle, port, input, { skipCalls: LOGIN_CALLS }))).toEqual([]);
  });
});
