import type { CallRecord, RunOutcome, Termination } from "./outcome.js";

/**
 * What parity may normalise, and nothing else: the ids the server assigned during the run (each side's run made its own), the
 * date-times and paths of the log, and the header lines that name the run's own folders. Every other byte must be equal.
 */

const ID = /\b[0-9A-Fa-f]{32}\b/g;

/** A request that can make the server assign ids: any `action` other than `get`. */
const MUTATING = /\baction\s*=\s*["'](?!get["'])[A-Za-z_]+["']/;

/**
 * The ids the server assigned during a run, numbered in the order they first appear in an answer: an id that is in no earlier
 * request or answer and comes back in the answer to a request that adds, versions, locks or edits is the server's. Applying
 * the map to both sides' texts makes two runs of the same work equal, while an id that the input fixes (a package file's) stays.
 */
export function serverIds(calls: readonly Pick<CallRecord, "request" | "response">[], madeBefore: readonly string[] = []): Map<string, string> {
  const seen = new Set<string>();
  const assigned = new Map<string, string>();
  // the new generations a pre-run step made through a connection of its own: no recorded answer shows them
  for (const id of madeBefore) {
    seen.add(id.toUpperCase());
    assigned.set(id.toUpperCase(), `<ID#${assigned.size + 1}>`);
  }
  for (const call of calls) {
    for (const id of call.request.match(ID) ?? []) seen.add(id.toUpperCase());
    const mutating = MUTATING.test(call.request);
    for (const raw of call.response.match(ID) ?? []) {
      const id = raw.toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      if (mutating) assigned.set(id, `<ID#${assigned.size + 1}>`);
    }
  }
  return assigned;
}

/** The text with every assigned id replaced by its number. */
export function replaceIds(text: string, assigned: ReadonlyMap<string, string>): string {
  if (assigned.size === 0) return text;
  return text.replace(ID, (id) => assigned.get(id.toUpperCase()) ?? id);
}

/** The date-times of a log: invariant (`MM/dd/yyyy`) and en-IN (`dd-MM-yyyy`), as 14.0.7 and 12.0 write them. */
const CLOCK = /\d\d[/-]\d\d[/-]\d{4} \d\d:\d\d:\d\d/g;

/** The header lines of a log that name a folder or file of the run itself. */
const OWN_PATH_HEADERS = /^(Log file|Working directory|Manifest file|Language pack): .*(\r?)$/gm;

/** The log's own working directory, from its header line. */
export function workingDirectoryOf(log: string): string {
  return /^Working directory: (.*?)\r?$/m.exec(log)?.[1] ?? "";
}

/** A path with `\` as `/`, so a Windows path and a POSIX one compare. */
const slashed = (path: string): string => path.replace(/\\/g, "/");

/**
 * The log with what is the run's own replaced: the header lines that name its folders, each `File full name` made relative to
 * the working directory, every date-time, and the working directory wherever else it appears.
 */
export function normalizeLog(log: string, assigned: ReadonlyMap<string, string>): string {
  const working = workingDirectoryOf(log);
  const workingSlashed = slashed(working);
  const out = log
    .replace(OWN_PATH_HEADERS, "$1: <path>$2")
    .replace(/^File full name '(.*)'(\r?)$/gm, (_all, path: string, end: string) => {
      const normal = slashed(path);
      const rest =
        working !== "" && normal.startsWith(workingSlashed)
          ? `<working>${normal.slice(workingSlashed.length)}`
          : `<other>/${normal.slice(normal.lastIndexOf("/") + 1)}`;
      return `File full name '${rest}'${end}`;
    })
    .replace(/^(WARNING: File ')(.*)(' doesn't have .*File is skipped\.\r?)$/gm, (_all, head: string, path: string, tail: string) => `${head}<input>/${slashed(path).replace(/^.*?\/input\//, "")}${tail}`)
    .replace(CLOCK, "<time>");
  const replaced = working === "" ? out : out.split(working).join("<working>");
  return replaceIds(replaced, assigned);
}

/** The folders of a run named in a text (an exception's message), replaced by a placeholder. */
function withoutFolders(text: string, folders: readonly string[]): string {
  return folders.filter((folder) => folder !== "").reduce((current, folder) => current.split(folder).join("<working>"), text);
}

export interface NormalizedOutcome {
  /** `ACTION request`, one entry per call, in order. */
  calls: string[];
  files: Map<string, Buffer> | null;
  log: string[];
  messages: string[];
  console: string | null;
  termination: string;
  exitCode: number;
}

function describeTermination(termination: Termination, folders: readonly string[], assigned: ReadonlyMap<string, string>): string {
  if (termination.kind === "exported") return "exported";
  if (termination.kind === "returned") return `returned ${termination.value}`;
  return `exception ${replaceIds(withoutFolders(termination.summary, folders), assigned)}`;
}

/**
 * The outcome as parity compares it. `skipCalls` leaves out that many calls at the start of both sides' transcripts: a replay
 * of a recording whose login the replayed server answered itself has no call to compare there.
 */
export function normalizeOutcome(outcome: RunOutcome, options: { skipCalls?: number; earlier?: readonly CallRecord[]; madeBefore?: readonly string[] } = {}): NormalizedOutcome {
  const calls = outcome.calls.slice(options.skipCalls ?? 0);
  // a later step of a case finds the rows an earlier step made, so the ids of the earlier steps are numbered first
  const assigned = serverIds([...(options.earlier ?? []), ...calls], options.madeBefore);
  const working = workingDirectoryOf(outcome.log);
  return {
    calls: calls.map((call) => `${call.action} ${replaceIds(call.request, assigned)}`),
    files: outcome.files,
    log: normalizeLog(outcome.log, assigned).split("\n"),
    messages: outcome.messages.map((message) => `${message.channel}: ${replaceIds(message.text.replace(CLOCK, "<time>"), assigned)}`),
    console: outcome.console === null ? null : replaceIds(withoutFolders(outcome.console, [working]), assigned),
    termination: describeTermination(outcome.termination, [working], assigned),
    exitCode: outcome.exitCode,
  };
}
