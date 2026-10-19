import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readTranscript } from "../transcript.js";

/** One call the engine (or the port) made: the SOAP action, the request AML as the connection loaded it, and the answer. */
export interface CallRecord {
  action: string;
  request: string;
  response: string;
}

/** How a run ended: the value `ImportSolutions` returned, `ExportSolutions` returning, or the exception that ended the host. */
export type Termination =
  | { kind: "exported" }
  | { kind: "returned"; value: number }
  | { kind: "exception"; summary: string };

export interface RecordedMessage {
  channel: string;
  text: string;
}

/**
 * Everything one run left behind that parity compares: the requests in order, the output folder, the engine log, the messages,
 * the console text, and how the run ended. Both the oracle's recorded folder and the port's live run are read into this.
 */
export interface RunOutcome {
  side: "oracle" | "port";
  calls: CallRecord[];
  /** Export (and `lpdebug`'s kept package): relative path with `/` to bytes; an empty folder is `name/`. Null when the run has none. */
  files: Map<string, Buffer> | null;
  log: string;
  messages: RecordedMessage[];
  /** The text the host wrote to the console between the engine banner and the exit line; null when the run has none. */
  console: string | null;
  termination: Termination;
  /** The host's exit code: 0, or 2 when an exception ended the run. */
  exitCode: number;
}

/** The first line of an exception's text, where .NET's `ToString` starts the stack trace after it. */
export function exceptionSummary(text: string): string {
  const stack = text.search(/\r?\n\s+at /);
  return (stack < 0 ? text : text.slice(0, stack)).trim();
}

/** Every file below `root` as `relative/path` and every empty folder as `relative/path/`, with the bytes of each file. */
export function readTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    const names = readdirSync(dir);
    if (names.length === 0 && dir !== root) files.set(`${relative(root, dir).split(sep).join("/")}/`, Buffer.alloc(0));
    for (const name of names) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(root, full).split(sep).join("/"), readFileSync(full));
    }
  };
  if (existsSync(root)) walk(root);
  return files;
}

interface RunFile {
  hostExit: number;
  host: { result?: string | null; error?: string | null } | null;
}

/** The text a host wrote to the console: the lines of `host.log` between the engine banner and `HOST_EXIT`. */
export function recordedConsole(hostLog: string): string {
  const afterBanner = hostLog.slice(hostLog.indexOf("\r\n") + 2);
  return afterBanner.slice(0, afterBanner.lastIndexOf("HOST_EXIT"));
}

/** How a recorded run ended, from the host's `result` and `error`. */
export function oracleTermination(host: RunFile["host"]): Termination {
  if (host?.error !== undefined && host.error !== null) return { kind: "exception", summary: exceptionSummary(host.error) };
  const result = host?.result ?? "";
  if (result === "exported") return { kind: "exported" };
  const returned = /^ImportSolutions returned (-?\d+)$/.exec(result);
  if (returned) return { kind: "returned", value: Number(returned[1]) };
  throw new Error(`the run ended with neither a result the parity script knows nor an error: ${JSON.stringify(result)}`);
}

/**
 * Reads a folder the oracle recorded (`run.json`, `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log`) into an outcome.
 * `filesFrom` names the folder whose tree is the run's output: `output` for an export, `temp-package` for a kept language pack.
 */
export function readOracleOutcome(dir: string, options: { filesFrom?: string; blobs?: string } = {}): RunOutcome {
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunFile;
  const termination = oracleTermination(run.host);
  const messages = readFileSync(join(dir, "messages.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const { channel, text } = JSON.parse(line) as RecordedMessage;
      return { channel, text };
    });
  const transcript = readTranscript(join(dir, "transcript.jsonl"), options.blobs ?? join(dir, "_blobs"));
  const hostLog = readFileSync(join(dir, "host.log"), "utf8");
  return {
    side: "oracle",
    calls: transcript.map((call) => ({ action: call.action, request: call.request, response: call.response ?? "" })),
    files: options.filesFrom === undefined ? null : readTree(join(dir, options.filesFrom)),
    log: existsSync(join(dir, "engine.log")) ? readFileSync(join(dir, "engine.log"), "utf8") : "",
    messages,
    console: hostLog.includes("HOST_EXIT") ? recordedConsole(hostLog) : null,
    termination,
    exitCode: run.hostExit,
  };
}
