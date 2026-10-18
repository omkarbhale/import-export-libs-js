import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import type { XmlDocument } from "../xml/dom.js";
import { documentElementOf } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { ImportLookups } from "./import-lookups.js";
import { getItemsFromPackageDom } from "./items.js";
import { loadPackage } from "./load-package-dom.js";
import { ReferenceChecker, type DelayedResolution, type UnresolvedReference } from "./reference-checks.js";
import { BLOBS, CASES, Replay, packageFolder, prepare, readLog, stepOptions, type LogItem } from "./transcript-replay.js";

/**
 * Replays the import of every item of the recorded 14.0.7 import runs (ticket 25) against the port: the skip test of an item
 * that exists (IMP-350, IMP-351), the reference checks that come before the import, and `doImport` (IMP-300 to IMP-340) with
 * the step's merge option. Each case step is one run of the real engine on dev. The port gets the item document the engine
 * made from the step's own `input/` and the recorded answers, and must send the requests the engine recorded, in that order and
 * with the same final document, reach the outcome the engine's log reports (skipped, applied, or the failure's message), and
 * leave the document the engine sent. The server is the recording: the first request of an item is looked up in what the
 * engine sent after the previous item, the rest must follow it without a gap.
 *
 * An item with a reference to an item that does not exist yet is not replayed past its checks: the delayed resolution edits
 * its document before the import, and that is another rule area (IMP-2xx).
 */
interface Step {
  name: string;
  dir: string;
  merge: boolean;
  fast: boolean;
}

const caseNames = readdirSync(CASES).filter((name) => existsSync(join(CASES, name, "case.json")));

const steps: Step[] = caseNames.flatMap((name) => {
  const definition = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as { steps: unknown[] };
  return definition.steps.map((_step, index) => ({
    name: `${name}/step-${index + 1}`,
    dir: join(CASES, name, `step-${index + 1}`),
    ...stepOptions(join(CASES, name), index),
  }));
});

/** The part of `DelayedResolutionManager` that the import of an item needs here: it only notes what was unresolved. */
class Noting implements DelayedResolution {
  unresolved: UnresolvedReference[] = [];

  processForDelayedResolution(unresolved: readonly UnresolvedReference[]): void {
    this.unresolved.push(...unresolved);
  }
}

type Outcome = { kind: "skipped" } | { kind: "applied" } | { kind: "delayed" } | { kind: "failed"; failure: Error };

/** What the replay saw across all steps, to show that the cases reached the paths they are meant for. */
const seen = {
  skipped: 0,
  applied: 0,
  delayed: 0,
  failed: 0,
  merged: 0,
  idlist: 0,
  unlocked: 0,
  edited: 0,
  versionable: 0,
  relationships: 0,
};

const silent = { writeLine: () => undefined };

describe("the import of the recorded 14.0.7 import runs (IMP-300 to IMP-352)", () => {
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
    const lookups = new ImportLookups(helper);

    /** `ImportProc`'s body for one item, from the skip test to the import (IMP-422 to IMP-427 are another ticket's). */
    const importItem = async (doc: XmlDocument, action: string): Promise<Outcome> => {
      const root = documentElementOf(doc)!;
      const flag2 = !step.fast && action !== "delete";
      try {
        if (await lookups.skipsExistingAdd(root, step.merge)) return { kind: "skipped" };
        replay.strict = false;
        replay.rank = 0;
        const noting = new Noting();
        await checker.doChecking(noting, doc, silent, flag2);
        if (noting.unresolved.length > 0) return { kind: "delayed" };
        replay.strict = false;
        try {
          await lookups.doImport(doc, step.merge);
        } catch (error) {
          if (flag2 || !(error instanceof CItemException)) throw error;
          replay.strict = false;
          await checker.doChecking(noting, doc, silent, true);
          if (noting.unresolved.length > 0) return { kind: "delayed" };
          replay.strict = false;
          await lookups.doImport(doc, step.merge);
        }
        return { kind: "applied" };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("the port sent a request the engine did not record")) throw error;
        return { kind: "failed", failure: error as Error };
      }
    };

    const matchesLog = (outcome: Outcome, logged: LogItem): string | undefined => {
      // what the delayed resolution makes of the document, and so of the import, is another rule area (IMP-2xx)
      if (outcome.kind === "delayed") return undefined;
      if (outcome.kind === "failed") {
        if (logged.outcome !== "none") return `the port failed (${outcome.failure.message.slice(0, 300)}) where the engine reports ${logged.outcome}`;
        const message = outcome.failure.message.replace(/\r\n/g, "\n");
        return message === run.failure ? undefined : `the port failed with ${message.slice(0, 300)}, the engine with ${run.failure?.slice(0, 300)}`;
      }
      return outcome.kind === logged.outcome ? undefined : `the port ${outcome.kind} the item, the engine's log says ${logged.outcome}`;
    };

    let items = 0;
    for (const pkg of run.packages) {
      // a package the engine could not load or had no item of has nothing to replay
      if (pkg.items.length === 0) continue;
      const loaded = loadPackage(packageFolder(step.dir, pkg.name), { writeLine: () => undefined });
      const prepared = getItemsFromPackageDom(loaded.document).map((doc) => ({ doc, ...prepare(doc) }));
      // items can read the same in the log (the deletes of a type), so the n-th logged is the n-th such item of the package
      const taken = new Map<string, number>();
      for (const [position, logged] of pkg.items.entries()) {
        const key = `${logged.action}|${logged.descriptor}`;
        const nth = taken.get(key) ?? 0;
        taken.set(key, nth + 1);
        const found = prepared.filter((candidate) => `${candidate.action}|${candidate.descriptor}` === key)[nth];
        expect(found, `the package ${pkg.name} holds the item the engine logged: ${logged.descriptor}`).toBeDefined();
        const { doc, action } = found!;

        const before = { cursor: replay.cursor, cache: new Map(helper.lookups.requestedItems), item: outerXml(documentElementOf(doc)!) };
        let accepted: { outcome: Outcome; document: XmlDocument; calls: number } | undefined;
        let firstProblem: string | undefined;
        for (let rank = 0; ; rank += 1) {
          replay.cursor = before.cursor;
          replay.strict = false;
          replay.rank = rank;
          replay.candidates = 0;
          helper.lookups.requestedItems.clear();
          for (const [key, value] of before.cache) helper.lookups.requestedItems.set(key, value);
          const attempt = loadXml(before.item, { preserveWhitespace: false });
          const candidates = () => Math.max(replay.candidates, 1);
          let problem: string | undefined;
          let outcome: Outcome | undefined;
          try {
            outcome = await importItem(attempt, action);
            problem = matchesLog(outcome, logged);
          } catch (error) {
            problem = (error as Error).message;
          }
          firstProblem ??= problem;
          if (problem === undefined && outcome !== undefined) {
            accepted = { outcome, document: attempt, calls: replay.cursor - before.cursor };
            break;
          }
          if (rank + 1 >= candidates()) break;
        }
        const where = `${step.name}: ${pkg.name} item ${position + 1} (${logged.descriptor.trim()})`;
        expect(firstProblem === undefined || accepted !== undefined ? undefined : firstProblem, where).toBeUndefined();
        const { outcome, document } = accepted!;
        seen[outcome.kind] += 1;
        if (outcome.kind === "applied") {
          // the last request of an applied item is the send of the document the engine's rules left (IMP-340)
          expect(replay.lastRequest, where).toBe(documentOuterXml(parseXml(outerXml(document))));
          if (step.merge) seen.merged += 1;
          if (outerXml(document).includes(' action="edit"')) seen.edited += 1;
          if (outerXml(document).includes(`where="source_id='`)) seen.relationships += 1;
        }
        items += 1;
      }
    }
    expect(items).toBe(run.packages.reduce((sum, pkg) => sum + pkg.items.length, 0));
    seen.idlist += calls.filter((call) => call.request.includes("idlist=")).length;
    seen.unlocked += calls.filter((call) => call.request.includes('action="unlock"')).length;
    seen.versionable += calls.filter((call) => call.request.includes("is_versionable") && call.response?.includes("<is_versionable>1<")).length;
  });

  it("reached the skip path, the merge and the versionable paths", () => {
    expect(seen.skipped).toBeGreaterThan(10);
    expect(seen.applied).toBeGreaterThan(100);
    expect(seen.failed).toBeGreaterThan(0);
    expect(seen.merged).toBeGreaterThan(100);
    expect(seen.idlist).toBeGreaterThan(10);
    expect(seen.edited).toBeGreaterThan(0);
    expect(seen.versionable).toBeGreaterThan(0);
    expect(seen.relationships).toBeGreaterThan(0);
  });
});
