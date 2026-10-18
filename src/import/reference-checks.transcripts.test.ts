import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { CItemException, ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import type { XmlDocument } from "../xml/dom.js";
import { documentElementOf } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { getItemsFromPackageDom } from "./items.js";
import { loadPackage } from "./load-package-dom.js";
import { ReferenceChecker, type DelayedResolution, type UnresolvedReference } from "./reference-checks.js";

/**
 * Replays the reference checks of the recorded 14.0.7 import cases (ticket 25) against the port. Each case step is one
 * run of the real engine on dev. For every item it checked, the port gets the item document the engine made from the
 * step's own `input/` and the recorded answers, and must write the engine's log lines between the start and the end of the
 * reference checking, send the requests the engine recorded in that order, and fail with the engine's message when the
 * engine's run failed there. The server is the recording: the first request of a check is looked up in what the engine
 * sent after the previous check, the rest must follow it without a gap.
 */
const CASES = new URL("../../fixtures/14.0.7/import/", import.meta.url).pathname;
const BLOBS = join(CASES, "_blobs");

const START = "********** Start of reference checking ************";
const END = "************* End of reference checking ************";
const WARNING = "WARNING: The following portion of the AML \n{0}\ncontains unresolved reference that will be tried to resolve at the end of the package import";

interface Step {
  name: string;
  dir: string;
}

const caseNames = readdirSync(CASES).filter((name) => existsSync(join(CASES, name, "case.json")));

const hasChecks = (dir: string): boolean => readFileSync(join(dir, "engine.log"), "utf8").includes(START);

const steps: Step[] = caseNames.flatMap((name) => {
  const definition = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as { steps: unknown[] };
  return definition.steps
    .map((_step, index) => ({
      name: `${name}/step-${index + 1}`,
      dir: join(CASES, name, `step-${index + 1}`),
    }))
    .filter((step) => hasChecks(step.dir));
});

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
class Replay implements ServerConnection {
  cursor = -1;
  /** True inside a check, after its first request: the request must be the very next call the engine made. */
  strict = false;
  /** Which of the calls equal to the first request starts the check. */
  rank = 0;
  /** How many calls were equal to the first request of the last check. */
  candidates = 0;

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
    return ResponseDocument.parse(this.calls[index]?.response ?? "");
  }
}

/** The part of `DelayedResolutionManager` that writes the log (IMP-202); the edits are the manager's own ticket. */
class WarningOnly implements DelayedResolution {
  unresolved: UnresolvedReference[] = [];

  processForDelayedResolution(unresolved: readonly UnresolvedReference[], log: { writeLine(text: string): void }): void {
    this.unresolved.push(...unresolved);
    for (const reference of unresolved) log.writeLine(WARNING.replace("{0}", outerXml(reference.problemNode)));
  }
}

interface LogItem {
  action: string;
  descriptor: string;
  /** The log lines of each pass of the reference checking of this item, in order. */
  blocks: string[][];
}

interface Run {
  /** The package the items belong to, in the order the engine imported them. */
  packages: { name: string; items: LogItem[] }[];
  /** The text the failed run reports, when it fails. */
  failure?: string;
}

/** Cuts an engine log into the packages, the items and their blocks of reference checking. */
function readLog(text: string): Run {
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
      item = { action: processing[1] ?? "", descriptor: processing[2] ?? "", blocks: [] };
      run.packages[run.packages.length - 1]?.items.push(item);
      continue;
    }
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
function prepare(doc: XmlDocument): { action: string; descriptor: string } {
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

const packageFolder = (dir: string, name: string): string => {
  const mf = readFileSync(join(dir, "input", "imports.mf"), "utf8");
  const path = new RegExp(`<package name="${name}" path="([^"]*)"`).exec(mf)?.[1];
  if (path === undefined) throw new Error(`${name} is not in the manifest of ${dir}`);
  return join(dir, "input", ...path.split("\\"));
};

describe("the reference checks of the recorded 14.0.7 import runs (IMP-100 to IMP-170)", () => {
  it("has import steps to replay", () => {
    expect(steps.length).toBeGreaterThan(40);
  });

  it.each(steps.map((step) => [step.name, step] as const))("%s", async (_name, step) => {
    const calls = readTranscript(join(step.dir, "transcript.jsonl"), BLOBS);
    const run = readLog(readFileSync(join(step.dir, "engine.log"), "utf8"));
    const replay = new Replay(calls);
    const helper = new CItemHelper(replay);
    helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
    const checker = new ReferenceChecker(helper);

    let checked = 0;
    for (const pkg of run.packages) {
      const loaded = loadPackage(packageFolder(step.dir, pkg.name), { writeLine: () => undefined });
      const prepared = getItemsFromPackageDom(loaded.document).map((doc) => ({ doc, ...prepare(doc) }));
      for (const [position, logged] of pkg.items.entries()) {
        const found = prepared.find((candidate) => `${candidate.action}|${candidate.descriptor}` === `${logged.action}|${logged.descriptor}`);
        expect(found, `the package ${pkg.name} holds the item the engine logged: ${logged.descriptor}`).toBeDefined();
        const { doc, action } = found!;

        let current = doc;
        for (const [pass, expected] of logged.blocks.entries()) {
          // a delete is checked only for its data sources, and fully when the retry of IMP-427 runs
          const full = action !== "delete" || pass > 0;
          const before = { cursor: replay.cursor, cache: new Map(helper.lookups.requestedItems), item: outerXml(documentElementOf(current)!) };
          let outcome: { written: string[]; failure?: Error; item: XmlDocument } | undefined;
          let firstOutcome: typeof outcome;
          for (let rank = 0; ; rank += 1) {
            replay.cursor = before.cursor;
            replay.strict = false;
            replay.rank = rank;
            helper.lookups.requestedItems.clear();
            for (const [key, value] of before.cache) helper.lookups.requestedItems.set(key, value);
            const attempt = loadXml(before.item, { preserveWhitespace: false });
            const written: string[] = [];
            let failure: Error | undefined;
            try {
              await checker.doChecking(new WarningOnly(), attempt, { writeLine: (text) => written.push(text) }, full);
            } catch (error) {
              failure = error as Error;
            }
            outcome = { written, item: attempt, ...(failure ? { failure } : {}) };
            firstOutcome ??= outcome;
            const passed = outcome.written.join("\n").split(/\r?\n/).join("\n") === expected.join("\n") && (outcome.failure === undefined) === (expected[expected.length - 1] === END);
            if (passed || rank + 1 >= Math.max(replay.candidates, 1)) {
              if (!passed) outcome = firstOutcome;
              break;
            }
          }
          const { written, failure } = outcome!;
          expect(written.join("\n").split(/\r?\n/), `${step.name}: ${pkg.name} item ${position + 1} (${failure?.message.slice(0, 300) ?? "no failure"})`).toEqual(expected);
          if (expected[expected.length - 1] === END) {
            expect(failure, `${step.name}: the checks of item ${position + 1} do not fail`).toBeUndefined();
          } else {
            expect(failure).toBeInstanceOf(CItemException);
            expect((failure as CItemException).faultcode).toBe(-1);
            expect(failure!.message.replace(/\r\n/g, "\n")).toBe(run.failure);
          }
          current = outcome!.item;
          checked += 1;
        }
      }
    }
    expect(checked).toBe(run.packages.reduce((sum, pkg) => sum + pkg.items.reduce((n, logged) => n + logged.blocks.length, 0), 0));
  });
});
