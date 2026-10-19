import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import type { XmlDocument } from "../xml/dom.js";
import { documentElementOf } from "../xml/dom.js";

/**
 * What the tests that replay the recorded 14.0.7 import runs (`fixtures/14.0.7/import/`, ticket 25) share: the recorded
 * answers served back to the port, and the reading of an engine log and of an item the way `ImportProc` reads it.
 */
export const CASES = new URL("../../fixtures/14.0.7/import/", import.meta.url).pathname;
export const BLOBS = join(CASES, "_blobs");
/** The recorded 14.35 import runs (ticket 75). */
export const CASES_14_35 = new URL("../../fixtures/14.35/import/", import.meta.url).pathname;
export const BLOBS_14_35 = join(CASES_14_35, "_blobs");

export const START = "********** Start of reference checking ************";
export const END = "************* End of reference checking ************";

/**
 * The lookups the import loop made before it checked an item and the cache kept, which the replay does not repeat: the
 * versionable test of a type (IMP-170).
 */
const CACHED_BEFORE_THE_CHECKS = /^<Item type="ItemType" select="is_versionable" action="get"><name>[^<]*<\/name><\/Item>$/;

/**
 * The recorded answers. The first request of a check is looked up after the cursor, where a request of the import loop (which
 * the replay does not repeat) can read the same, so `rank` says which of the equal ones starts the check; the rest of the
 * check must follow it without a gap.
 */
export class Replay implements ServerConnection {
  cursor = -1;
  /** True inside a check, after its first request: the request must be the very next call the engine made. */
  strict = false;
  /** Which of the calls equal to the first request starts the check. */
  rank = 0;
  /** How many calls were equal to the first request of the last check. */
  candidates = 0;
  /** The wire text of the last request the port sent. */
  lastRequest = "";

  constructor(private readonly calls: TranscriptCall[]) {}

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    const from = this.cursor + 1;
    const matches = (call: TranscriptCall | undefined) => call !== undefined && call.action === action && call.request === wire;
    let index = -1;
    if (this.strict) index = matches(this.calls[from]) ? from : -1;
    else {
      const equal = this.calls.flatMap((call, i) => (i >= from && matches(call) ? [i] : []));
      this.candidates = equal.length;
      index = equal[this.rank] ?? -1;
    }
    if (index < 0 && CACHED_BEFORE_THE_CHECKS.test(wire)) {
      const earlier = this.calls.findIndex((call, i) => i <= this.cursor && matches(call));
      if (earlier >= 0) return ResponseDocument.parse(this.calls[earlier]?.response ?? "");
    }
    if (index < 0) {
      throw new Error(`the port sent a request the engine did not record${this.strict ? " next" : ""}: ${action} ${wire.slice(0, 400)}`);
    }
    this.cursor = index;
    this.strict = true;
    this.lastRequest = wire;
    return ResponseDocument.parse(this.calls[index]?.response ?? "");
  }
}

export interface LogItem {
  action: string;
  descriptor: string;
  /** The log lines of each pass of the reference checking of this item, in order. */
  blocks: string[][];
  /** What the log says became of the item: skipped as existing, applied, or neither (the run failed). */
  outcome: "skipped" | "applied" | "none";
}

export interface Run {
  /** The package the items belong to, in the order the engine imported them. */
  packages: { name: string; items: LogItem[] }[];
  /** The text the failed run reports, when it fails. */
  failure?: string;
}

/** Cuts an engine log into the packages, the items and their blocks of reference checking. */
export function readLog(text: string): Run {
  const lines = text.split(/\r?\n/);
  const run: Run = { packages: [] };
  let item: LogItem | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const packageMatch = /^\s*\*{4}Import\s+(.*?)\*{4}\s*$/.exec(line);
    if (packageMatch) {
      run.packages.push({ name: (packageMatch[1] ?? "").trim().split(/\s+/).pop() ?? "", items: [] });
      continue;
    }
    const processing = /^Processing \(([^)]*)\) (.*)$/.exec(line);
    if (processing) {
      item = { action: processing[1] ?? "", descriptor: processing[2] ?? "", blocks: [], outcome: "none" };
      run.packages[run.packages.length - 1]?.items.push(item);
      continue;
    }
    if (item && line.startsWith("Item successfully skipped")) item.outcome = "skipped";
    if (item && line.startsWith("Item successfully applied")) item.outcome = "applied";
    if (line === START && item) {
      const block = [line];
      for (i += 1; i < lines.length; i += 1) {
        const next = lines[i] ?? "";
        if (/^Updating '.*' package to failed release status$/.test(next)) {
          i -= 1;
          break;
        }
        block.push(next);
        if (next === END) break;
      }
      item.blocks.push(block);
      continue;
    }
    const failed = /^Import package '.*' failed with message:$/.exec(line);
    if (failed) {
      const rest = lines.slice(i + 2);
      const stop = rest.findIndex((next) => /^Updating .* to failed release status$/.test(next));
      run.failure = rest.slice(0, stop).join("\n");
    }
  }
  return run;
}

/** `ImportProc`'s reading of an item before it checks it (IMP-422). */
export function prepare(doc: XmlDocument): { action: string; descriptor: string } {
  const item = documentElementOf(doc)!;
  item.setAttribute("doGetItem", "0");
  const read = (name: string) => item.getAttributeNode(name)?.value ?? "";
  const action = read("action");
  const id = read("id");
  const type = read("type");
  const keyedName = read("tempKeyName");
  item.removeAttribute("tempKeyName");
  item.removeAttribute("tempFullName");
  const part = (label: string, value: string) => (value === "" ? " " : `  ${label} : ${value}  `);
  return { action, descriptor: `${part("id", id)}${part("keyed_name", keyedName)}${part("type", type)}` };
}

/** The folder of a package, from the manifest the step's engine read. */
export const packageFolder = (dir: string, name: string): string => {
  const mf = readFileSync(join(dir, "input", "imports.mf"), "utf8");
  const path = new RegExp(`<package name="${name}" path="([^"]*)"`).exec(mf)?.[1];
  if (path === undefined) throw new Error(`${name} is not in the manifest of ${dir}`);
  return join(dir, "input", ...path.split("\\"));
};

/** The options a step of a case ran with. */
export function stepOptions(caseDir: string, index: number): { merge: boolean; fast: boolean } {
  const definition = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as {
    steps: { options?: { merge?: boolean; fast?: boolean } }[];
  };
  const options = definition.steps[index]?.options ?? {};
  return { merge: options.merge === true, fast: options.fast === true };
}

/** The requests of a login, which the replays of a whole run do not send again: `ValidateUser`, the user lookup and the version probe. */
export const LOGIN_CALLS = 6;

/** Answers each request with the next recorded call, which must be the same request. */
export class SequentialConnection implements ServerConnection {
  private next = LOGIN_CALLS;

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
      throw new Error(
        `request ${this.next - LOGIN_CALLS + 1} differs from the recorded one:\nsent:     ${action} ${wire.slice(0, 600)}\nrecorded: ${call?.action} ${call?.request.slice(0, 600)}`,
      );
    }
    this.next += 1;
    return ResponseDocument.parse(call.response ?? "");
  }
}
