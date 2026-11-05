import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import type { Engine } from "../engines.js";
import type { ReferencesToUnknownPackages } from "./export-context.js";
import type { Case, ExportCases } from "./replay-cases.js";

/**
 * What the replays of the recorded export cases share: the disk replays (`run-replay.test.ts`, `run-replay-1435.test.ts`) and the
 * replays on the in-memory file system (`src/browser/vfs-replay.*.test.ts`, HOST-218). Everything here is pure and reads only the
 * recording of a case, never the folder a run writes to, so the same comparison holds whichever file system the run used. These were
 * private to the two disk tests and moved here unchanged.
 */

export const read = (cases: ExportCases, name: string, file: string): string => readFileSync(join(cases.dir, name, file), "utf8");

/** The header line `Label: value` of the recorded log, which holds the host's settings. */
export const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

/** The date-times of the log: invariant (`MM/dd/yyyy`) and, in the 12.0 engine's, en-IN (`dd-MM-yyyy`) at the head of a package. */
export const CLOCK = /\d\d[/-]\d\d[/-]\d{4} \d\d:\d\d:\d\d/g;

/** The settings the oracle host gave a case: the 14.0.7 log header names them, and 12.0 has no header, so the case's options do. */
export function settings(cases: ExportCases, name: string, input: Case, recordedLog: string): Record<string, unknown> {
  if (cases.engine !== "12.0") {
    return {
      url: headerValue(recordedLog, "URL"),
      dataBase: headerValue(recordedLog, "Database"),
      userName: headerValue(recordedLog, "User"),
      level: headerValue(recordedLog, "Export level"),
      exportReferencedItems: headerValue(recordedLog, "Export referenced items") === "True",
      useImport: headerValue(recordedLog, "Export using import structure") === "True",
      refToUnknownPacks: headerValue(recordedLog, "Export unknown packages action") as ReferencesToUnknownPackages,
    };
  }
  const params = (JSON.parse(read(cases, name, "run.json")) as { params: { Url: string; Database: string; User: string } }).params;
  return {
    url: params.Url,
    dataBase: params.Database,
    userName: params.User,
    level: input.options.level ?? "1",
    exportReferencedItems: input.options.exportReferencedItems ?? false,
    useImport: (input.options as { useImport?: boolean }).useImport ?? false,
    refToUnknownPacks: (input.options.refToUnknownPacks ?? "DoNotRemove") as ReferencesToUnknownPackages,
  };
}

/** The log with what is the run's own replaced: the two paths of the header and every date-time. */
export const comparable = (log: string, logPath: string, workingDirectory: string): string =>
  log
    .replace(/^(Log file: ).*(\r)$/m, `$1<log>$2`)
    .replace(/^(Working directory: ).*(\r)$/m, `$1<working>$2`)
    .replace(CLOCK, "<time>")
    .split(logPath).join("<log>")
    .split(workingDirectory).join("<working>");

/** The 12.0 cases that remove references to unknown packages wait for the 12.0 variants of `EXP-600` to `EXP-699`. */
export const needsRemoval = (engine: Engine, input: Case): boolean =>
  engine !== "14.0.7" && (input.options.refToUnknownPacks === "RemoveSilently" || input.options.refToUnknownPacks === "RemoveWithWarning");

// ------------------------------------------------------------------------------------------------------------------ 14.35

export interface Case1435 {
  id: string;
  packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }>;
  options: { level?: string; exportReferencedItems?: boolean; refToUnknownPacks?: string; languages?: string[]; engineAction?: string; cancelAfterStatus?: number };
  expectsError: boolean;
  result: { error: string | null };
}

/** The calls of the host's login (ValidateUser, the user record and the probe) in a recorded 14.35 export transcript. */
export const LOGIN_CALLS_1435 = 6;

/** Answers each request with a recorded call that has the same text and was not used yet. */
export class RecordedConnection implements ServerConnection {
  private readonly used: boolean[];

  constructor(private readonly calls: TranscriptCall[]) {
    this.used = calls.map((_, index) => index < LOGIN_CALLS_1435);
  }

  /**
   * The recorded requests the port did not send. A repeat of an `is_versionable` lookup that the port did send is not counted: the engine's
   * workers that start together each ask before the first answer is cached (3 requests for 3 items in `lang-only-de-instances`, 1 in
   * `lang-only-en-de-instances`), and the port, which runs the items one after the other, asks once.
   */
  get leftover(): string[] {
    const sent = new Set(this.calls.filter((_, index) => this.used[index]).map((call) => call.request));
    return this.calls
      .filter((call, index) => !this.used[index] && !(call.request.includes('select="is_versionable"') && sent.has(call.request)))
      .map((call) => call.request.slice(0, 200));
  }

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    const index = this.calls.findIndex((call, i) => !this.used[i] && call.action === action && call.request === wire);
    if (index < 0) throw new Error(`the port sent a request the engine did not record: ${action} ${wire.slice(0, 400)}`);
    this.used[index] = true;
    return ResponseDocument.parse(this.calls[index]?.response ?? "");
  }
}

const CLOCK_1435 = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

/** The log with what is the run's own replaced: the two paths of the header and every date-time. */
export const comparable1435 = (log: string, logPath: string, workingDirectory: string): string =>
  log
    .replace(/^(Log file: ).*(\r)$/m, `$1<log>$2`)
    .replace(/^(Working directory: ).*(\r)$/m, `$1<working>$2`)
    .replace(CLOCK_1435, "<time>")
    .split(logPath)
    .join("<log>")
    .split(workingDirectory)
    .join("<working>");

const SUCCESS = /^Item id :.*successfully exported$/;
const PACKAGE_HEADER = /^ {9}\*\*\*\*Export .*\*\*\*\*$/;

export interface LogParts {
  header: string;
  /** One entry per package: its header line, its success lines (sorted), and the other lines with a repeated cancel pair collapsed. */
  packages: Array<{ header: string; successes: string[]; rest: string[] }>;
}

/** The log as EXP-558 compares it: the header, and per package the success lines as a set and the other lines in order. */
export function logParts(log: string): LogParts {
  const end = log.indexOf("\r\n\r\n") + 4;
  const lines = log.slice(end).split("\r\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const packages: LogParts["packages"] = [];
  for (const line of lines) {
    if (PACKAGE_HEADER.test(line)) packages.push({ header: line, successes: [], rest: [] });
    else if (SUCCESS.test(line)) packages[packages.length - 1]?.successes.push(line);
    else packages[packages.length - 1]?.rest.push(line);
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
  return { header: log.slice(0, end), packages };
}

const ITEM_STATUS = /^Item \d+ of \d+: (.*)$/;

/** The messages of a run by channel, the status texts of items as a set without their numbers. */
export function messageParts(messages: Array<{ channel: string; text: string }>) {
  const bychannel = (channel: string) => messages.filter((message) => message.channel === channel).map((message) => message.text);
  const statuses = bychannel("status");
  return {
    currentPackage: bychannel("currentPackage"),
    warning: bychannel("warning"),
    error: bychannel("error"),
    errorQuestion: bychannel("errorQuestion"),
    items: new Set(statuses.flatMap((text) => ITEM_STATUS.exec(text)?.[1] ?? [])),
    otherStatus: statuses.filter((text) => !ITEM_STATUS.test(text)),
  };
}

/**
 * The ids and keyed names of the items of a case that the server refused (their request has a fault for an answer). Two failures
 * in one package are reported for whichever item the engine's workers reached first (EXP-572), so a text that names a failing item is
 * compared with the item replaced.
 */
export function failingItems(input: Case1435, calls: TranscriptCall[]): Array<{ id: string; keyedName: string }> {
  const items = input.packages.flatMap((entry) => entry.items);
  return items.filter((item) =>
    calls.some((call) => call.request.includes(`<id>${item.id}</id>`) && (call.response ?? "").includes("<SOAP-ENV:Fault")),
  );
}

export const maskItems = (text: string, failing: Array<{ id: string; keyedName: string }>): string =>
  failing.reduce((masked, item) => masked.split(item.id).join("<failing id>").split(item.keyedName).join("<failing name>"), text);

/** The modes that remove references to unknown packages wait for the rules `EXP-600` to `EXP-699`. */
export const needsRemoval1435 = (input: Case1435): boolean =>
  input.options.refToUnknownPacks === "RemoveSilently" || input.options.refToUnknownPacks === "RemoveWithWarning";

/** A case whose language list the engine's constructor refused: the run never started, so it left no log, no messages and no files. */
export const failsInConstructor = (input: Case1435): boolean =>
  input.expectsError && (input.options.engineAction !== undefined || input.options.languages !== undefined);
