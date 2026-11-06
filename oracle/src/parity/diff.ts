import { normalizeOutcome, type NormalizedOutcome } from "./normalize.js";
import type { CallRecord, RunOutcome } from "./outcome.js";

/** What parity compares, in the order the ticket lists it. */
export const AREAS = ["calls", "files", "log", "messages", "console", "termination", "wire"] as const;
export type Area = (typeof AREAS)[number];

export interface Difference {
  area: Area;
  /** One line that says what differs. */
  summary: string;
  /** The first values that differ, each cut to a readable length. */
  oracle?: string;
  port?: string;
  /** What the two sides of a comparison that is not oracle against port are called (HOST-277), for the lines that show `oracle` and `port`. */
  labels?: { oracle: string; port: string };
}

const CUT = 700;

/** Text cut to a readable length, with a mark where it was cut. */
export const cut = (text: string, length = CUT): string => (text.length <= length ? text : `${text.slice(0, length)}… (+${text.length - length} chars)`);

/** The index of the first character where two strings differ, or -1 when they are equal. */
function firstCharDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** A window of `text` around `at`, so a long text shows where it differs. */
function around(text: string, at: number): string {
  const from = Math.max(0, at - 160);
  return `${from > 0 ? "… " : ""}${JSON.stringify(text.slice(from, at + 360))}${at + 360 < text.length ? " …" : ""}`;
}

/** Lists compared entry by entry: how many differ, and the first one with its position. */
function diffLists(area: Area, label: string, oracle: readonly string[], port: readonly string[], limit = 3): Difference[] {
  const out: Difference[] = [];
  if (oracle.length !== port.length) {
    out.push({ area, summary: `the oracle has ${oracle.length} ${label}s, the port ${port.length}` });
  }
  let shown = 0;
  let differing = 0;
  for (let i = 0; i < Math.max(oracle.length, port.length); i++) {
    if (oracle[i] === port[i]) continue;
    differing += 1;
    if (shown >= limit) continue;
    shown += 1;
    const at = firstCharDifference(oracle[i] ?? "", port[i] ?? "");
    out.push({
      area,
      summary: `${label} ${i + 1} differs${at >= 0 ? ` (first at character ${at})` : ""}`,
      oracle: oracle[i] === undefined ? "(none)" : around(oracle[i]!, Math.max(0, at)),
      port: port[i] === undefined ? "(none)" : around(port[i]!, Math.max(0, at)),
    });
  }
  if (differing > shown) out.push({ area, summary: `${differing - shown} more ${label}s differ` });
  return out;
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.equals(b);
}

export function diffFiles(oracle: Map<string, Buffer> | null, port: Map<string, Buffer> | null): Difference[] {
  if (oracle === null && port === null) return [];
  if (oracle === null || port === null) {
    return [{ area: "files", summary: oracle === null ? "the oracle left no folder, the port did" : "the oracle left a folder, the port none" }];
  }
  const out: Difference[] = [];
  const names = [...new Set([...oracle.keys(), ...port.keys()])].sort();
  const onlyOracle = names.filter((name) => !port.has(name));
  const onlyPort = names.filter((name) => !oracle.has(name));
  if (onlyOracle.length > 0) out.push({ area: "files", summary: `only the oracle wrote: ${cut(onlyOracle.join(", "), 400)}` });
  if (onlyPort.length > 0) out.push({ area: "files", summary: `only the port wrote: ${cut(onlyPort.join(", "), 400)}` });
  let shown = 0;
  let differing = 0;
  for (const name of names) {
    const a = oracle.get(name);
    const b = port.get(name);
    if (a === undefined || b === undefined || sameBytes(a, b)) continue;
    differing += 1;
    if (shown >= 3) continue;
    shown += 1;
    const x = a.toString("latin1");
    const y = b.toString("latin1");
    const at = firstCharDifference(x, y);
    out.push({
      area: "files",
      summary: `${name} differs byte for byte (${a.length} against ${b.length} bytes, first at byte ${at})`,
      oracle: around(x, at),
      port: around(y, at),
    });
  }
  if (differing > shown) out.push({ area: "files", summary: `${differing - shown} more files differ` });
  return out;
}

/** The differences between two normalised outcomes. Equal outcomes give none. */
export function diffNormalized(oracle: NormalizedOutcome, port: NormalizedOutcome): Difference[] {
  const out: Difference[] = [];
  out.push(...diffLists("calls", "request", oracle.calls, port.calls));
  out.push(...diffFiles(oracle.files, port.files));
  out.push(...diffLists("log", "log line", oracle.log, port.log));
  out.push(...diffLists("messages", "message", oracle.messages, port.messages));
  if (oracle.console !== port.console) {
    const at = firstCharDifference(oracle.console ?? "", port.console ?? "");
    out.push({
      area: "console",
      summary: `the console text differs (first at character ${at})`,
      oracle: oracle.console === null ? "(none)" : around(oracle.console, Math.max(0, at)),
      port: port.console === null ? "(none)" : around(port.console, Math.max(0, at)),
    });
  }
  if (oracle.termination !== port.termination || oracle.exitCode !== port.exitCode) {
    out.push({
      area: "termination",
      summary: "the run ended differently",
      oracle: `${oracle.termination} (exit ${oracle.exitCode})`,
      port: `${port.termination} (exit ${port.exitCode})`,
    });
  }
  return out;
}

/** The differences between the oracle's run and the port's, after the normalisation of `normalize.ts`. */
export function diffOutcomes(
  oracle: RunOutcome,
  port: RunOutcome,
  options: {
    skipCalls?: number;
    earlier?: { oracle: readonly CallRecord[]; port: readonly CallRecord[] };
    madeBefore?: { oracle: readonly string[]; port: readonly string[] };
  } = {},
): Difference[] {
  const { earlier, madeBefore, ...rest } = options;
  return diffNormalized(
    normalizeOutcome(oracle, { ...rest, ...(earlier === undefined ? {} : { earlier: earlier.oracle }), ...(madeBefore === undefined ? {} : { madeBefore: madeBefore.oracle }) }),
    normalizeOutcome(port, { ...rest, ...(earlier === undefined ? {} : { earlier: earlier.port }), ...(madeBefore === undefined ? {} : { madeBefore: madeBefore.port }) }),
  );
}

/** The differences as the lines the script prints. */
export function describeDifferences(differences: readonly Difference[], indent = "    "): string[] {
  return differences.flatMap((d) => [
    `${indent}[${d.area}] ${d.summary}`,
    ...(d.oracle === undefined ? [] : [`${indent}  ${`${d.labels?.oracle ?? "oracle"}:`.padEnd(7)} ${cut(d.oracle)}`]),
    ...(d.port === undefined ? [] : [`${indent}  ${`${d.labels?.port ?? "port"}:`.padEnd(7)} ${cut(d.port)}`]),
  ]);
}

/**
 * Differences of a comparison that is not oracle against port, named for what was compared (HOST-277): `left` takes the place of "the
 * oracle" in each line and `right` of "the port", and the line says which pair it is about.
 */
export function relabelDifferences(differences: readonly Difference[], left: string, right: string): Difference[] {
  return differences.map((d) => ({
    ...d,
    summary: `${right} against ${left}: ${d.summary.replace(/\bthe oracle\b/g, `the ${left}`).replace(/\bthe port\b/g, `the ${right}`).replace(/\bonly the oracle\b/g, `only the ${left}`)}`,
    labels: { oracle: left, port: right },
  }));
}
