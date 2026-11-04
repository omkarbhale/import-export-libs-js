import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";

/**
 * What the replays of the recorded DB patch runs share: the disk replay (`replay.test.ts`) and the replay on the in-memory file
 * system (`src/browser/vfs-replay.test.ts`, HOST-217). These were private to the disk test and moved here unchanged.
 */
export const CASES = new URL("../../fixtures/14.35/dbpatch/", import.meta.url).pathname;
/** The calls of the host's login (WIRE-002), which the helper made before the recording of the run began. */
export const LOGIN_CALLS = 6;

/** Serves the calls after the login, in order, and notes every request that is not the next recorded one. */
export class RecordedConnection implements ServerConnection {
  private next = LOGIN_CALLS;
  readonly mismatches: string[] = [];

  constructor(private readonly calls: TranscriptCall[]) {}

  get consumed(): number {
    return this.next - LOGIN_CALLS;
  }

  get total(): number {
    return this.calls.length - LOGIN_CALLS;
  }

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    const call = this.calls[this.next];
    if (call?.action !== action || call.request !== wire) {
      this.mismatches.push(`call ${this.consumed + 1}: sent ${action} ${wire.slice(0, 300)}\n  recorded ${call?.action} ${call?.request.slice(0, 300)}`);
      throw new Error("the port sent a request the engine did not record");
    }
    this.next += 1;
    return ResponseDocument.parse(call.response ?? "");
  }
}

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

/** A log or a message with the parts of the recording machine and the clock replaced. */
export const masked = (text: string): string =>
  text
    .replace(CLOCK, "<time>")
    .replace(/^(Log file: ).*$/m, "$1<log>")
    .replace(/^(Working directory: ).*$/m, "$1<work>")
    .replace(/^(DB updated nanifest file path: ).*$/m, "$1<manifest>")
    .replace(/^(DB pathes folder path: ).*$/m, "$1<folder>")
    .replace(/^(Loaded \[).*(\] for upgrade to release)/m, "$1<manifest>$2");

export const field = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

/** The recorded steps of a case: the folders that hold a transcript. */
export const steps = (caseName: string): string[] => readdirSync(join(CASES, caseName)).filter((name) => existsSync(join(CASES, caseName, name, "transcript.jsonl")));
