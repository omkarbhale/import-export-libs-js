import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import { type Difference, cut, diffFiles, diffNormalized } from "./diff.js";
import { type NormalizedOutcome, normalizeOutcome } from "./normalize.js";
import type { CallRecord, RunOutcome } from "./outcome.js";

/**
 * How two exports of the same items by 14.35 are compared (EXP-558). The engine runs the items of a package in parallel, so the
 * oracle's run and the port's agree in the parts below and in no others; every other part of the run is not compared. A run with only
 * one item per package has nothing racing, and is compared in full by {@link diffNormalized}.
 *
 * - **Fixed**: the login calls in order, the log header, every package header, the `currentPackage` messages, the other messages
 *   except the item statuses, how the run ended, the console text.
 * - **A set**: the requests after the login (a request may be sent twice when two workers miss a cache together), the success lines
 *   of a package, the lines between its `start of execution` and `end of execution`, and the item statuses (a text may be missing
 *   or repeated: EXP-552, EXP-553).
 * - **Files**: exactly equal when nothing stopped the run; otherwise the manifest, and the bytes of every file both sides wrote
 *   (the items in flight when a failure or a cancel came are not fixed: EXP-572).
 *
 * @spec EXP-558
 */

/** The calls of the login and the version probe that every 14.35 run starts with, which nothing races. */
export const LOGIN_CALLS = 6;

const SUCCESS = /^Item id :.*successfully exported$/;
const PACKAGE_HEADER = /^ {9}\*\*\*\*Export .*\*\*\*\*$/;
const ITEM_STATUS = /^Item \d+ of \d+: (.*)$/;

interface LogParts {
  header: string;
  /** One entry per package: its header line, its success lines (sorted), and the other lines with a repeated cancel pair collapsed. */
  packages: Array<{ header: string; successes: string[]; rest: string[] }>;
}

/** The log as EXP-558 compares it: the header, and per package the success lines as a multiset and the other lines in order. */
export function logParts(lines: readonly string[]): LogParts {
  const body = lines.map((line) => line.replace(/\r$/, ""));
  const end = body.indexOf("");
  const header = body.slice(0, end < 0 ? body.length : end).join("\n");
  const packages: LogParts["packages"] = [];
  for (const line of body.slice(end < 0 ? body.length : end + 1)) {
    if (PACKAGE_HEADER.test(line)) packages.push({ header: line, successes: [], rest: [] });
    else if (SUCCESS.test(line)) packages[packages.length - 1]?.successes.push(line);
    else if (line !== "") packages[packages.length - 1]?.rest.push(line);
  }
  for (const pkg of packages) {
    pkg.successes.sort();
    // the cancel text and `end of execution` may come more than once (EXP-557)
    const collapsed: string[] = [];
    for (let i = 0; i < pkg.rest.length; i += 1) {
      const pair = pkg.rest.slice(i, i + 2);
      const last = collapsed.slice(-2);
      if (pair[0] === "Export was canceled by user" && pair.length === 2 && last.length === 2 && last[0] === pair[0] && last[1] === pair[1]) {
        i += 1;
        continue;
      }
      collapsed.push(pkg.rest[i] as string);
    }
    pkg.rest = collapsed;
  }
  return { header, packages };
}

interface MessageParts {
  currentPackage: string[];
  other: string[];
  /** The item statuses without their numbers. */
  items: Set<string>;
  otherStatus: string[];
}

/** The messages as `channel: text` lines, split into the parts EXP-558 names. */
function messageParts(messages: readonly string[]): MessageParts {
  const text = (channel: string) => messages.filter((m) => m.startsWith(`${channel}: `)).map((m) => m.slice(channel.length + 2));
  const statuses = text("status");
  return {
    currentPackage: text("currentPackage"),
    other: messages.filter((m) => !m.startsWith("status: ") && !m.startsWith("currentPackage: ")),
    items: new Set(statuses.flatMap((s) => ITEM_STATUS.exec(s)?.[1] ?? [])),
    otherStatus: statuses.filter((s) => !ITEM_STATUS.test(s)),
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Which of a case's items the server refused, from either side's transcript: their request has a fault for an answer. */
export function failingItems(packages: readonly ExportCasePackage[], calls: readonly CallRecord[]): Array<{ id: string; keyedName: string }> {
  return packages
    .flatMap((p) => p.items)
    .filter((item) => calls.some((call) => call.request.includes(`<id>${item.id}</id>`) && call.response.includes("<SOAP-ENV:Fault")));
}

/** Two failures in one package are reported for whichever item the workers reached first (EXP-572), so a text that names one is compared with the item replaced. */
const maskItems = (text: string, failing: ReadonlyArray<{ id: string; keyedName: string }>): string =>
  failing.reduce((masked, item) => masked.split(item.id).join("<failing id>").split(item.keyedName).join("<failing name>"), text);

export interface ParallelCase {
  packages: readonly ExportCasePackage[];
  options: ExportCaseOptions;
  /** The packages are not listed (a console mode builds the table), so the items race whatever the list says. */
  racing?: true;
}

/**
 * Whether a run has nothing racing: one item at a time in every package. The pass over the referenced items (EXP-543) exports the
 * items the first pass found, several at a time in each package, whatever the case lists.
 */
export const isSequential = (packages: readonly ExportCasePackage[], options: ExportCaseOptions = {}): boolean =>
  options.exportReferencedItems !== true && packages.every((p) => p.items.length <= 1);

const showList = (items: readonly string[]): string => cut(JSON.stringify(items.slice(0, 6)), 500);

/** The differences between the oracle's and the port's 14.35 export of a case, by the comparison of EXP-558. */
export function diffExportRuns1435(oracle: RunOutcome, port: RunOutcome, c: ParallelCase, options: { skipCalls?: number } = {}): Difference[] {
  const skipCalls = options.skipCalls ?? 0;
  const o = normalizeOutcome(oracle, { skipCalls });
  const p = normalizeOutcome(port, { skipCalls });
  if (c.racing !== true && isSequential(c.packages, c.options) && c.options.cancelAfterStatus === undefined) return diffNormalized(o, p);

  const out: Difference[] = [];
  const failing = failingItems(c.packages, [...oracle.calls, ...port.calls]);
  const mask = (text: string): string => maskItems(text, failing);
  const mo = messageParts(o.messages);
  const mp = messageParts(p.messages);
  const stopped =
    c.options.cancelAfterStatus !== undefined ||
    [mo, mp].some((m) => m.other.some((line) => /^(errorQuestion|warning|error): /.test(line))) ||
    oracle.termination.kind === "exception" ||
    port.termination.kind === "exception";

  // requests: the login in order, the rest as a set
  out.push(...diffCalls(o, p, stopped, Math.max(0, LOGIN_CALLS - skipCalls)));

  // the files
  if (!stopped) out.push(...diffFiles(o.files, p.files));
  else out.push(...diffStoppedFiles(o.files, p.files));

  // the log
  out.push(...diffLogs(o, p, stopped, mask));

  // the messages
  if (!sameList(mo.currentPackage, mp.currentPackage)) {
    out.push({ area: "messages", summary: "the currentPackage messages differ", oracle: showList(mo.currentPackage), port: showList(mp.currentPackage) });
  }
  if (!sameList(mo.other.map(mask), mp.other.map(mask)) && !(stopped && warningsAgree(mo.other, mp.other, mask))) {
    out.push({ area: "messages", summary: "the error, warning and question messages differ", oracle: showList(mo.other.map(mask)), port: showList(mp.other.map(mask)) });
  }
  const statusOf = (m: MessageParts) => (stopped ? [...new Set(m.otherStatus.map(mask))] : m.otherStatus.map(mask));
  if (!sameList(statusOf(mo), statusOf(mp))) {
    out.push({ area: "messages", summary: "the status texts that name no item differ", oracle: showList(statusOf(mo)), port: showList(statusOf(mp)) });
  }
  // the port sends each worker's own text; the engine may repeat one and drop another, so its names are among the port's
  const missing = [...mo.items].filter((name) => !mp.items.has(name) && !failing.some((f) => name.includes(f.keyedName)));
  if (!stopped && missing.length > 0) {
    out.push({ area: "messages", summary: `the oracle names items the port's status texts do not: ${missing.length}`, oracle: showList(missing), port: showList([...mp.items]) });
  }
  if (!stopped && c.packages.length > 0) {
    const absent = [...mp.items].filter((name) => !c.packages.flatMap((pk) => pk.items).some((item) => name.includes(item.keyedName)) && !mo.items.has(name));
    if (absent.length > 0) out.push({ area: "messages", summary: "the port names items no case item or oracle text names", port: showList(absent) });
  }

  if (o.console !== p.console) {
    out.push({ area: "console", summary: "the console text differs", oracle: o.console === null ? "(none)" : cut(o.console), port: p.console === null ? "(none)" : cut(p.console) });
  }
  if (mask(o.termination) !== mask(p.termination) || o.exitCode !== p.exitCode) {
    out.push({ area: "termination", summary: "the run ended differently", oracle: `${mask(o.termination)} (exit ${o.exitCode})`, port: `${mask(p.termination)} (exit ${p.exitCode})` });
  }
  return out;
}

/** The warning of the engine names every worker that failed, the port's the first (EXP-556): the port's block is inside the engine's. */
function warningsAgree(oracle: readonly string[], port: readonly string[], mask: (text: string) => string): boolean {
  const split = (lines: readonly string[]) => ({
    warning: lines.filter((l) => l.startsWith("warning: ")),
    rest: lines.filter((l) => !l.startsWith("warning: ")).map(mask),
  });
  const a = split(oracle);
  const b = split(port);
  if (!sameList(a.rest, b.rest)) return false;
  if (a.warning.length !== b.warning.length) return false;
  return a.warning.every((w, i) => {
    const mine = mask(b.warning[i] as string);
    const first = mine.split("\r\n").slice(1).join("\r\n");
    return mask(w).includes(first);
  });
}

function diffCalls(o: NormalizedOutcome, p: NormalizedOutcome, stopped: boolean, login: number): Difference[] {
  const out: Difference[] = [];
  for (let i = 0; i < login; i += 1) {
    if (o.calls[i] !== p.calls[i]) {
      out.push({ area: "calls", summary: `login request ${i + 1} differs`, oracle: cut(o.calls[i] ?? "(none)"), port: cut(p.calls[i] ?? "(none)") });
      break;
    }
  }
  if (stopped) return out;
  const oracleSet = new Set(o.calls.slice(login));
  const portSet = new Set(p.calls.slice(login));
  const onlyOracle = [...oracleSet].filter((r) => !portSet.has(r));
  const onlyPort = [...portSet].filter((r) => !oracleSet.has(r));
  if (onlyOracle.length > 0) out.push({ area: "calls", summary: `${onlyOracle.length} distinct request(s) only the oracle sent`, oracle: showList(onlyOracle.map((r) => cut(r, 300))) });
  if (onlyPort.length > 0) out.push({ area: "calls", summary: `${onlyPort.length} distinct request(s) only the port sent`, port: showList(onlyPort.map((r) => cut(r, 300))) });
  return out;
}

/** A stopped run: the manifest, and the bytes of every file both wrote (the files of items in flight are not fixed: EXP-572). */
function diffStoppedFiles(oracle: Map<string, Buffer> | null, port: Map<string, Buffer> | null): Difference[] {
  if (oracle === null || port === null) return diffFiles(oracle, port);
  const out: Difference[] = [];
  if (oracle.has("imports.mf") !== port.has("imports.mf")) out.push({ area: "files", summary: "only one side wrote imports.mf" });
  const different = [...oracle.keys()].filter((name) => port.has(name) && !name.endsWith("/") && !oracle.get(name)!.equals(port.get(name)!));
  if (different.length > 0) out.push({ area: "files", summary: `${different.length} file(s) both wrote differ byte for byte`, oracle: showList(different) });
  return out;
}

function diffLogs(o: NormalizedOutcome, p: NormalizedOutcome, stopped: boolean, mask: (text: string) => string): Difference[] {
  const out: Difference[] = [];
  const a = logParts(o.log);
  const b = logParts(p.log);
  if (a.header !== b.header) out.push({ area: "log", summary: "the log header differs", oracle: cut(a.header), port: cut(b.header) });
  const headersA = a.packages.map((x) => x.header);
  const headersB = b.packages.map((x) => x.header);
  if (!sameList(headersA, headersB)) {
    out.push({ area: "log", summary: "the packages the log visits differ", oracle: showList(headersA), port: showList(headersB) });
    return out;
  }
  for (const [index, pkg] of b.packages.entries()) {
    const theirs = a.packages[index]!;
    const rest = (lines: readonly string[]) => (stopped ? [...new Set(lines.map(mask))].sort() : lines.map(mask));
    const sameRest = sameList(rest(theirs.rest), rest(pkg.rest));
    // a warning block that lists every failed worker contains the port's first
    if (!sameRest && !(stopped && theirs.rest.map(mask).join("\n").includes(pkg.rest.map(mask).join("\n")))) {
      out.push({ area: "log", summary: `the lines of ${pkg.header.trim()} other than the success lines differ`, oracle: showList(rest(theirs.rest)), port: showList(rest(pkg.rest)) });
    }
    if (!stopped && !sameList(theirs.successes, pkg.successes)) {
      out.push({ area: "log", summary: `the success lines of ${pkg.header.trim()} differ (${theirs.successes.length} against ${pkg.successes.length})`, oracle: showList(theirs.successes), port: showList(pkg.successes) });
    }
  }
  return out;
}
