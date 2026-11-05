import type { Engine } from "../engines.js";
import { Message } from "../export/messages.js";
import type { MessageChannel, MessagesFactory, OnItemError } from "../export/messages.js";
import type { ConsoleWriter } from "../import/import-run.js";
import { MemoryVfs } from "../host/memory-fs.js";
import type { HostFs } from "../host/types.js";
import { posix } from "../io/path.js";

/**
 * What the browser's operations share (HOST-272, HOST-273): the options every one takes, the messages and progress events a run
 * produces, the reporter that makes them from the engine's messages and console, and the result and summary shapes.
 *
 * @spec HOST-272 HOST-273
 */

/** The four operations of the facade. */
export type Operation = "export" | "import" | "language-pack" | "db-patches";

/** Where a message came from: the engine's five channels, the engine's console text, or the library itself. */
export type MessageSource = "engine" | "console" | "host";

/** How a caller shows a message: `info` for progress, `warning` for a warning, `error` for an error. */
export type MessageLevel = "info" | "warning" | "error";

/** A message of a run (HOST-273). */
export interface ApiMessage {
  source: MessageSource;
  /** The channel of an engine message; absent for console text and the library's own notes. */
  channel?: MessageChannel;
  level: MessageLevel;
  text: string;
}

/** The stage a progress event marks (HOST-273). */
export type ProgressPhase = "package" | "item" | "post-actions" | "references" | "completed";

/** A stage of a run, derived from the engine's messages and console (HOST-273). */
export interface ProgressEvent {
  operation: Operation;
  phase: ProgressPhase;
  /** The package the run is in, absent before the first. */
  package: string | undefined;
  /** For `item`: the type and the keyed name of the item the engine says it is on. */
  item?: { type: string; name: string };
  /** For `item`: the engine's `i` of `Item i of n`. */
  index?: number;
  /** For `item`: the engine's `n`. */
  total?: number;
}

/** The options every operation takes. */
export interface RunOptions {
  /** Called for every message and console line of the engine, in order (HOST-273). */
  onMessage?: (message: ApiMessage) => void;
  /** Called for the stages of a run (HOST-273). */
  onProgress?: (event: ProgressEvent) => void;
  /** An abort before the start rejects the call; during an export or an import it cancels the run (HOST-272). */
  signal?: AbortSignal;
  /** The tree the run reads and writes. Default: a new one for an export, the source for an import (HOST-272). */
  vfs?: MemoryVfs;
  /** The engine's `Verbose` setting: more text in the log and on the console (IMP-421). */
  verbose?: boolean;
  /** Where the run log is written in the tree; default `/aras-pkg-logs/<operation>.log` (HOST-272). */
  logPath?: string;
  /** The `os_user` of the audit row of an import and of a DB patch run (IMP-452); default the login name (HOST-270). */
  osUser?: string;
  /** The clock of the log's date-times; a hook for tests. */
  now?: () => Date;
}

/** The messages by channel, counted as the CLI counts them. */
export interface MessageCounts {
  info: number;
  warnings: number;
  errors: number;
  packages: number;
}

/** How a run ended, as the CLI's summary says it (HOST-272). */
export type RunResult = "success" | "completed with engine errors" | "failed" | "cancelled";

/** The facts of a finished run. */
export interface RunSummary {
  operation: Operation;
  engine: Engine;
  /** The server version as the engine writes it (`14.0.9.36073`). */
  server: string | undefined;
  result: RunResult;
  /** The engine's return code: 0 for an export and for a run that went through (IMP-408). */
  returnCode: number;
  /** True when the abort signal was raised during the run. */
  aborted: boolean;
  messages: MessageCounts;
  /** The packages the run covered, with the number of items of each where the run says (an export). */
  packages: Array<{ name: string; items?: number }>;
}

/** What an operation resolves with (HOST-272). */
export interface OperationResult {
  /** The tree the run used: the caller's, or the one the run made. */
  vfs: MemoryVfs;
  /** The text of the run log. */
  log: string;
  /** The messages and console lines, in order. */
  messages: ApiMessage[];
  summary: RunSummary;
}

/** An option the operation cannot take: an unknown value, a combination, or an engine that lacks the feature (HOST-272). */
export class OptionError extends Error {
  override name = "OptionError";
}

/** The answer to the engine's error question (EXP-516), or a function that gives it from the question's text. */
export type OnItemErrorOption = OnItemError | ((question: { text: string }) => OnItemError | Promise<OnItemError>);

class ReportedMessage extends Message {
  constructor(
    private readonly channel: MessageChannel,
    private readonly reporter: RunReporter,
  ) {
    super();
  }

  override execute(): Promise<boolean | null> {
    return this.reporter.executed(this.channel, this.text);
  }
}

const ITEM = /^Item (\d+) of (\d+): (\S+) - ([\s\S]*)$/;
const EXPORT_PACKAGE = /^Exporting package ([\s\S]+)$/;
const IMPORT_BANNER = /^\s*\*{4}Import(?: with merge option)?\s+(.*?)\*{4}\s*$/;

/**
 * The host side of a run's messages (HOST-273): the engine's `MessagesFactory`, and a `ConsoleWriter` that cuts the console text
 * into lines. It keeps the messages and their counts, and calls `onMessage` and `onProgress` where the engine sends.
 */
export class RunReporter {
  readonly messages: ApiMessage[] = [];
  readonly counts: MessageCounts = { info: 0, warnings: 0, errors: 0, packages: 0 };
  /** The packages the run reported, in order, for the summary. */
  readonly packages: string[] = [];
  readonly factory: MessagesFactory;
  readonly console: ConsoleWriter;

  private pending = "";
  private currentPackage: string | undefined;

  constructor(
    private readonly operation: Operation,
    private readonly options: Pick<RunOptions, "onMessage" | "onProgress"> & { onItemError?: OnItemErrorOption },
  ) {
    this.factory = {
      getCurrentPackageMessage: () => this.channel("currentPackage"),
      getStatusMessage: () => this.channel("status"),
      getErrorMessageQuestion: () => this.channel("errorQuestion"),
      getWarningMessage: () => this.channel("warning"),
      getErrorMessage: () => this.channel("error"),
    };
    this.console = {
      write: (text) => this.consoleText(text),
      writeLine: (text = "") => this.consoleText(`${text}\n`),
    };
  }

  private channel(channel: MessageChannel): Message {
    return new ReportedMessage(channel, this);
  }

  /** Called by a message when the engine executes it: counts it, delivers it, derives the progress, and answers the question. */
  async executed(channel: MessageChannel, text: string): Promise<boolean | null> {
    this.engineMessage(channel, text);
    if (channel !== "errorQuestion") return null;
    const answer = this.options.onItemError;
    const given = typeof answer === "function" ? await answer({ text }) : (answer ?? "continue");
    return given === "abort-package";
  }

  /** A message of the library's own, such as a refused server let through (HOST-273). */
  note(level: MessageLevel, text: string): void {
    if (level === "warning") this.counts.warnings += 1;
    else if (level === "error") this.counts.errors += 1;
    else this.counts.info += 1;
    this.deliver({ source: "host", level, text });
  }

  private engineMessage(channel: MessageChannel, text: string): void {
    if (channel === "status") this.counts.info += 1;
    else if (channel === "warning") this.counts.warnings += 1;
    else if (channel === "currentPackage") this.counts.packages += 1;
    else this.counts.errors += 1;
    if (text === "") return;
    const level: MessageLevel = channel === "warning" ? "warning" : channel === "error" || channel === "errorQuestion" ? "error" : "info";
    this.deliver({ source: "engine", channel, level, text });
    this.progressOfMessage(channel, text);
  }

  private deliver(message: ApiMessage): void {
    this.messages.push(message);
    this.options.onMessage?.(message);
  }

  private progress(phase: ProgressPhase, rest: Omit<ProgressEvent, "operation" | "phase" | "package"> = {}): void {
    this.options.onProgress?.({ operation: this.operation, phase, package: this.currentPackage, ...rest });
  }

  private startPackage(name: string): void {
    this.currentPackage = name;
    this.packages.push(name);
    this.progress("package");
  }

  private progressOfMessage(channel: MessageChannel, text: string): void {
    if (channel === "currentPackage") {
      const named = EXPORT_PACKAGE.exec(text);
      if (named !== null) this.startPackage(named[1] as string);
      return;
    }
    if (channel !== "status") return;
    const item = ITEM.exec(text);
    if (item !== null) {
      this.progress("item", { item: { type: item[3] as string, name: item[4] as string }, index: Number(item[1]), total: Number(item[2]) });
    } else if (text === "Post actions") this.progress("post-actions");
    else if (text === "Delayed resolution of unresolved references ...") this.progress("references");
    else if (text === "completed") this.progress("completed");
  }

  private consoleText(text: string): void {
    this.pending += text;
    for (let end = this.pending.indexOf("\n"); end >= 0; end = this.pending.indexOf("\n")) {
      const line = this.pending.slice(0, end).replace(/\r$/, "");
      this.pending = this.pending.slice(end + 1);
      this.consoleLine(line);
    }
  }

  private consoleLine(line: string): void {
    if (line.trim() === "") return;
    this.deliver({ source: "console", level: "info", text: line });
    const banner = IMPORT_BANNER.exec(line);
    if (banner !== null) this.startPackage(banner[1] as string);
  }

  /** The text of the last console line, which the engine ended with no line break (the progress dots), is delivered. */
  flush(): void {
    const rest = this.pending.replace(/\r$/, "");
    this.pending = "";
    this.consoleLine(rest);
  }
}

/** The text a failure shows: the message, the engines that would take a refused server, the inner messages of an aggregate (HOST-270). */
export function describeFailure(error: unknown): string {
  const hint = (error as { hint?: unknown } | null)?.hint;
  const inner = (error as { innerExceptions?: unknown } | null)?.innerExceptions;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof hint === "string") return `${message}\n${hint}`;
  if (Array.isArray(inner)) return [message, ...inner.map(describeFailure)].join("\n");
  return message;
}

/** Makes a folder and its missing parents (the engine's own `Directory.CreateDirectory`, which a `HostFs` has only one level of). */
export function ensureFolder(fs: HostFs, path: string): void {
  if (path === "" || path === "/" || fs.exists(path)) return;
  ensureFolder(fs, posix.dirname(path));
  fs.mkdir(path);
}

/** The text of a file of the tree, or an empty string where the run wrote none. */
export function readLog(fs: HostFs, path: string): string {
  return fs.exists(path) ? new TextDecoder().decode(fs.readFile(path)) : "";
}

/** The CLI's verdict on a run: the return code and the number of `error` messages decide (HOST-272). */
export function resultOf(returnCode: number, errors: number, aborted: boolean): RunResult {
  if (aborted) return "cancelled";
  if (returnCode !== 0) return "failed";
  return errors > 0 ? "completed with engine errors" : "success";
}
