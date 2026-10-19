import type { CliIo } from "./io.js";

export type SummaryValue = string | number | boolean | null | undefined | readonly SummaryValue[] | { readonly [key: string]: SummaryValue };

/** The facts of a finished run, in the order they are shown. `undefined` entries are left out. */
export type Summary = Record<string, SummaryValue>;

function inline(value: SummaryValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(inline).join(", ");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => `${inline(entry as SummaryValue)} ${key}`)
      .join(", ");
  }
  return String(value);
}

/** The summary as `key: value` lines. */
export function summaryText(summary: Summary): string {
  return Object.entries(summary)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${inline(value)}\n`)
    .join("");
}

/** Writes the summary to standard output, as text or as JSON (round 2, Q4). */
export function printSummary(io: CliIo, json: boolean, summary: Summary, text: string = summaryText(summary)): void {
  io.stdout.write(json ? `${JSON.stringify(summary, null, 2)}\n` : text);
}
