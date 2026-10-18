import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import type { XmlDocument } from "../xml/dom.js";
import { documentElementOf } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { getItemsFromPackageDom } from "./items.js";
import { loadPackage } from "./load-package-dom.js";
import { ReferenceChecker, type DelayedResolution, type UnresolvedReference } from "./reference-checks.js";
import { BLOBS, CASES, END, Replay, START, packageFolder, prepare, readLog } from "./transcript-replay.js";

/**
 * Replays the reference checks of the recorded 14.0.7 import cases (ticket 25) against the port. Each case step is one
 * run of the real engine on dev. For every item it checked, the port gets the item document the engine made from the
 * step's own `input/` and the recorded answers, and must write the engine's log lines between the start and the end of the
 * reference checking, send the requests the engine recorded in that order, and fail with the engine's message when the
 * engine's run failed there. The server is the recording: the first request of a check is looked up in what the engine
 * sent after the previous check, the rest must follow it without a gap.
 */
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

const WARNING = "WARNING: The following portion of the AML \n{0}\ncontains unresolved reference that will be tried to resolve at the end of the package import";

/** The part of `DelayedResolutionManager` that writes the log (IMP-202); the edits are the manager's own ticket. */
class WarningOnly implements DelayedResolution {
  unresolved: UnresolvedReference[] = [];

  processForDelayedResolution(unresolved: readonly UnresolvedReference[], log: { writeLine(text: string): void }): void {
    this.unresolved.push(...unresolved);
    for (const reference of unresolved) log.writeLine(WARNING.replace("{0}", outerXml(reference.problemNode)));
  }
}

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
