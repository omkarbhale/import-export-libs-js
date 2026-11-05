/**
 * The parts of the recorded-import replays that read nothing from the disk (HOST-266): the shape of a case step, and the
 * comparisons of the engine's log and console. They are in a module of their own so that the replays in a browser page, which has
 * no `node:fs`, import them; the disk replays read them through `replay-support.ts`, where they were first written and moved here
 * unchanged.
 *
 * @spec HOST-266
 */

export interface Step {
  name: string;
  dir: string;
  options: {
    merge?: boolean;
    release?: string;
    description?: string;
    verbose?: boolean;
    cancelAfterStatus?: number;
    amlBatch?: { maxSize?: number };
    collectErrors?: { maxCount?: number };
    languages?: string[];
  };
  only?: string[];
}

/** The header line `Label: value` of the recorded log, which holds the host's settings. */
export const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

/** A date-time of the log, or the date alone where 12.0's cut of a package's log falls inside it (IMP-412). */
export const CLOCK = /\d\d\/\d\d\/\d{2,4}(?: \d\d:\d\d:\d\d)?/g;
/** The time spans of a batch (`TimeSpan.ToString()`), which differ from run to run (IMP-514). */
export const TIME_SPAN = /(\r\n   (?:AML batch|Resolve dependencies) time: )(?:\d+\.)?\d\d:\d\d:\d\d(?:\.\d+)?/g;

/** The log with what is the run's own replaced: the paths of the header, the item files and every date-time. */
export function comparable(log: string, recordedInput: string, input: string, logPath: string): string {
  const inputRelative = (path: string): string => {
    const rest = path.startsWith(input) ? path.slice(input.length) : path.startsWith(recordedInput) ? path.slice(recordedInput.length) : path;
    return `<input>${rest.replace(/\\/g, "/")}`;
  };
  return log
    .replace(/^(Manifest file: ).*(\r)$/m, "$1<manifest>$2")
    .replace(/^(Log file: ).*(\r)$/m, "$1<log>$2")
    .replace(/^(Working directory: ).*(\r)$/m, "$1<working>$2")
    .replace(/^(File full name )'(.*)'(\r?)$/gm, (_, label: string, path: string, end: string) => `${label}'${inputRelative(path)}'${end}`)
    .replace(/^(WARNING: File )'(.*)'( doesn't have )/gm, (_, label: string, path: string, rest: string) => `${label}'${inputRelative(path)}'${rest}`)
    .replace(CLOCK, "<time>")
    // 12.0 cuts a package's log mid-line (IMP-412): a date-time that the cut leaves incomplete still depends on the day of the run
    .replace(/(of execution : )\d[\d/: -]*$/, "$1<time>")
    .replace(TIME_SPAN, "$1<span>")
    .split(logPath === "" ? "\u0000" : logPath)
    .join("<log>");
}

/** What the oracle host wrote to the console: the lines of `host.log` between the engine banner and `HOST_EXIT`. */
export function recordedConsole(hostLog: string): string {
  const afterBanner = hostLog.slice(hostLog.indexOf("\r\n") + 2);
  return afterBanner.slice(0, afterBanner.lastIndexOf("HOST_EXIT"));
}
