import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ENGINES, type Engine } from "../../src/engines.js";
import { casesDir } from "./case-engine.js";
import { FIXTURES_DIR, loadXslFixture, type XslFixture, type XslOutcome } from "./xsl-fixtures.js";

/**
 * Ticket 64: what the three engines do differently to the same dev items.
 *
 * The comparison reads recorded export cases (`fixtures/<engine>/export/<case>/`,
 * or a live run in the same layout) and says, per pair of engines, where the
 * output folders, the messages, the engine log and the requests differ. It
 * proves nothing about the cases that come out equal: two engines that agree on
 * these items can still disagree on others (round 5 correction).
 */

/** The pairs the ticket compares: each engine with the next one. */
export const PAIRS: readonly (readonly [Engine, Engine])[] = [
  ["12.0", "14.0.7"],
  ["14.0.7", "14.35"],
];

/** Where each engine's recorded cases are: a folder of `<case>/` folders. */
export type ExportRoots = Record<Engine, string>;

/** Where the pinned comparisons are committed. */
export const SNAPSHOT_DIR = join(FIXTURES_DIR, "engine-diffs");

/** The XSL sets recorded for all three engines (`oracle/xsl-cases/` inputs, `fixtures/<engine>/xsl/<set>/`). */
export const XSL_SETS = ["export", "export-items", "export-fix"] as const;

/** Where the committed fixtures of each engine are. */
export const committedRoots = (): ExportRoots => Object.fromEntries(ENGINES.map((e) => [e, casesDir(e, "export")])) as ExportRoots;

/** The recorded cases of a folder: those with a run record. */
export const recordedCases = (root: string): string[] => (existsSync(root) ? readdirSync(root).filter((f) => existsSync(join(root, f, "run.json"))).sort() : []);

/** A 32-digit hexadecimal Aras id. */
const ID = /[0-9A-F]{32}/g;

/** How one output file differs between the left and the right folder. */
export interface FileDiff {
  /** Relative to the case's `output/`. */
  path: string;
  kind: "changed" | "only-left" | "only-right";
  /** The two files are equal once every 32-digit id is replaced: the ids are the server's own (a scratch item seeded again gets new ones). */
  idsOnly: boolean;
  /** Lines only in the left file, and only in the right one, counted as multisets (so a moved line is not counted). */
  linesOnlyLeft: number;
  linesOnlyRight: number;
}

/** A text and how often each side has it. */
export interface CountDiff {
  text: string;
  left: number;
  right: number;
}

export interface PairDiff {
  left: string;
  right: string;
  /** Cases compared. */
  cases: number;
  /** Cases whose output folders are byte-identical. */
  identical: string[];
  /** The other cases, with the files that differ. */
  output: Record<string, FileDiff[]>;
  /** Cases whose host exit code differs, as `[left, right]`. */
  hostExit: Record<string, [number, number]>;
  /** The engines' requests, summed over the cases: total calls and the request shapes that occur a different number of times. */
  calls: { left: number; right: number };
  requests: CountDiff[];
  /** `channel: text` of the messages, summed over the cases, where the counts differ. */
  messages: CountDiff[];
  /** The lines of `engine.log` with the time and paths replaced, summed over the cases, where the counts differ. */
  log: CountDiff[];
}

export interface Snapshot {
  pairs: PairDiff[];
}

/** Every file under `dir` by path relative to it, with `/` as the separator. */
function readTree(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = rel === "" ? name : `${rel}/${name}`;
      if (statSync(join(dir, path)).isDirectory()) walk(path);
      else files.set(path, readFileSync(join(dir, path)));
    }
  };
  if (existsSync(dir)) walk("");
  return files;
}

/** The multiset of lines. */
function lineCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/** How many lines `a` has that `b` lacks, counted with multiplicity. */
const surplus = (a: Map<string, number>, b: Map<string, number>): number => [...a].reduce((n, [line, count]) => n + Math.max(0, count - (b.get(line) ?? 0)), 0);

export function diffFiles(left: Map<string, Buffer>, right: Map<string, Buffer>): FileDiff[] {
  const diffs: FileDiff[] = [];
  for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(path);
    const b = right.get(path);
    if (a !== undefined && b !== undefined && a.equals(b)) continue;
    const textA = a?.toString("utf8") ?? "";
    const textB = b?.toString("utf8") ?? "";
    const linesA = lineCounts(textA);
    const linesB = lineCounts(textB);
    diffs.push({
      path,
      kind: a === undefined ? "only-right" : b === undefined ? "only-left" : "changed",
      idsOnly: a !== undefined && b !== undefined && textA.replace(ID, "<ID>") === textB.replace(ID, "<ID>"),
      linesOnlyLeft: surplus(linesA, linesB),
      linesOnlyRight: surplus(linesB, linesA),
    });
  }
  return diffs;
}

/** A request without its ids, text values and the indentation between elements: what its shape is. */
export function requestShape(action: string, request: string): string {
  return `${action} ${request.replace(ID, "<ID>").replace(/>\s+</g, "><").replace(/>[^<>]+</g, "><").trim()}`;
}

interface Run {
  hostExit: number;
  calls: number;
  shapes: Map<string, number>;
  messages: Map<string, number>;
  log: Map<string, number>;
  output: Map<string, Buffer>;
}

const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/** A log line without what differs between runs for no reason: the time stamps and the run's folders. */
export function normalizeLogLine(line: string): string {
  return line
    .replace(/\r$/, "")
    .replace(/\d{1,2}[-/.]\d{1,2}[-/.]\d{4} \d{1,2}:\d\d:\d\d(?: [AP]M)?/g, "<time>")
    .replace(/^(Log file|Working directory): .*$/, "$1: <path>");
}

function readRun(dir: string): Run {
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { hostExit: number };
  const shapes = new Map<string, number>();
  let calls = 0;
  for (const line of readFileSync(join(dir, "transcript.jsonl"), "utf8").split("\n")) {
    if (line === "") continue;
    const call = JSON.parse(line) as { action: string; request: string };
    calls += 1;
    bump(shapes, requestShape(call.action, call.request));
  }
  const messages = new Map<string, number>();
  for (const line of readFileSync(join(dir, "messages.jsonl"), "utf8").split("\n")) {
    if (line === "") continue;
    const message = JSON.parse(line) as { channel: string; text: string };
    bump(messages, `${message.channel}: ${message.text}`);
  }
  const log = new Map<string, number>();
  for (const line of readFileSync(join(dir, "engine.log"), "utf8").split("\n")) bump(log, normalizeLogLine(line));
  return { hostExit: run.hostExit, calls, shapes, messages, log, output: readTree(join(dir, "output")) };
}

/** Adds a run's multiset to the running sums of both sides, then lists the keys whose sums differ. */
function addCounts(sums: Map<string, [number, number]>, left: Map<string, number>, right: Map<string, number>): void {
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const sum = sums.get(key) ?? [0, 0];
    sums.set(key, [sum[0] + (left.get(key) ?? 0), sum[1] + (right.get(key) ?? 0)]);
  }
}

const differing = (sums: Map<string, [number, number]>): CountDiff[] =>
  [...sums]
    .filter(([, [l, r]]) => l !== r)
    .map(([text, [left, right]]) => ({ text, left, right }))
    .sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

/** Compares two folders of recorded export cases, case by case. */
export function compareRoots(leftLabel: string, left: string, rightLabel: string, right: string, cases: readonly string[]): PairDiff {
  const pair: PairDiff = { left: leftLabel, right: rightLabel, cases: cases.length, identical: [], output: {}, hostExit: {}, calls: { left: 0, right: 0 }, requests: [], messages: [], log: [] };
  const requests = new Map<string, [number, number]>();
  const messages = new Map<string, [number, number]>();
  const log = new Map<string, [number, number]>();
  for (const id of cases) {
    const a = readRun(join(left, id));
    const b = readRun(join(right, id));
    const files = diffFiles(a.output, b.output);
    if (files.length === 0) pair.identical.push(id);
    else pair.output[id] = files;
    if (a.hostExit !== b.hostExit) pair.hostExit[id] = [a.hostExit, b.hostExit];
    pair.calls.left += a.calls;
    pair.calls.right += b.calls;
    addCounts(requests, a.shapes, b.shapes);
    addCounts(messages, a.messages, b.messages);
    addCounts(log, a.log, b.log);
  }
  pair.requests = differing(requests);
  pair.messages = differing(messages);
  pair.log = differing(log);
  return pair;
}

/** The ticket's comparison: each pair of `PAIRS` over the same cases. */
export function compareEngines(roots: ExportRoots, cases: readonly string[]): Snapshot {
  return { pairs: PAIRS.map(([l, r]) => compareRoots(l, roots[l], r, roots[r], cases)) };
}

const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, width - 1)}…`);

/** The comparison as text for a person to read. */
export function formatReport(snapshot: Snapshot): string {
  const lines: string[] = [];
  for (const p of snapshot.pairs) {
    lines.push(`# ${p.left} against ${p.right}: ${p.cases} cases`, "");
    lines.push(`Output folders byte-identical: ${p.identical.length} of ${p.cases}. Calls: ${p.calls.left} against ${p.calls.right}.`, "");
    for (const [id, files] of Object.entries(p.output)) {
      lines.push(`- ${id}`);
      for (const f of files) lines.push(`    ${f.kind}${f.idsOnly ? " (ids only)" : ""} ${f.path} (-${f.linesOnlyLeft} +${f.linesOnlyRight} lines)`);
    }
    for (const [id, [l, r]] of Object.entries(p.hostExit)) lines.push(`- host exit differs in ${id}: ${l} against ${r}`);
    for (const [title, diffs] of [["Requests", p.requests], ["Messages", p.messages], ["Log lines", p.log]] as const) {
      lines.push("", `## ${title} whose number differs (${p.left} / ${p.right}): ${diffs.length}`, "");
      for (const d of diffs) lines.push(`${d.left}\t${d.right}\t${clip(d.text, 200)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** How one XSL input came out on two engines. */
export interface XslCaseDiff {
  name: string;
  transform: boolean;
  applied: boolean;
}

export interface XslSetDiff {
  left: string;
  right: string;
  set: string;
  /** Inputs both recordings hold. */
  cases: number;
  /** Inputs only one of them holds (a recorded call of a live export is in the 14.0.7 set only). */
  onlyLeft: string[];
  onlyRight: string[];
  /** The inputs on which the engines' transform or applied document (or exception) differ. */
  differing: XslCaseDiff[];
}

const sameOutcome = (a: XslOutcome, b: XslOutcome): boolean => (a.ok && b.ok ? a.text === b.text : !a.ok && !b.ok && JSON.stringify(a.error) === JSON.stringify(b.error));

/** Compares two recordings of the same inputs, case by case. */
export function compareXsl(left: XslFixture, right: XslFixture, set: string): XslSetDiff {
  const byName = new Map(right.cases.map((c) => [c.name, c]));
  const names = new Set(left.cases.map((c) => c.name));
  const differs: XslCaseDiff[] = [];
  let cases = 0;
  for (const a of left.cases) {
    const b = byName.get(a.name);
    if (b === undefined) continue;
    if (a.input !== b.input) throw new Error(`${set}/${a.name}: the two recordings ran different input documents`);
    cases += 1;
    const transform = !sameOutcome(a.transform, b.transform);
    const applied = !sameOutcome(a.applied, b.applied);
    if (transform || applied) differs.push({ name: a.name, transform, applied });
  }
  return {
    left: left.engine,
    right: right.engine,
    set,
    cases,
    onlyLeft: left.cases.filter((c) => !byName.has(c.name)).map((c) => c.name),
    onlyRight: right.cases.filter((c) => !names.has(c.name)).map((c) => c.name),
    differing: differs,
  };
}

/** The XSL sets recorded for all three engines under `fixtures/`, compared for each pair. */
export function compareXslSets(fixturesDir: string, sets: readonly string[]): XslSetDiff[] {
  return sets.flatMap((set) =>
    PAIRS.map(([l, r]) => compareXsl(loadXslFixture(join(fixturesDir, l, "xsl", set)), loadXslFixture(join(fixturesDir, r, "xsl", set)), set)),
  );
}
