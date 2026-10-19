import { createMessagesFactory, type MessageChannel, type MessagesFactory, type SentMessage } from "../export/messages.js";
import type { ConsoleWriter } from "../import/import-run.js";
import type { CliIo } from "./io.js";

const TAGS: Readonly<Record<MessageChannel, string>> = {
  currentPackage: "PKG",
  status: "INFO",
  warning: "WARN",
  errorQuestion: "ERROR",
  error: "ERROR",
};

export interface MessageCounts {
  info: number;
  warnings: number;
  errors: number;
  packages: number;
}

/**
 * Where the engine's messages and console text go: standard error, one `[TAG] text` line per message (round 2, Q4). It counts
 * the messages by channel, which decides between exit 0 and exit 2.
 */
export class Reporter {
  readonly counts: MessageCounts = { info: 0, warnings: 0, errors: 0, packages: 0 };
  readonly messages: MessagesFactory;
  /** The engine host's standard output, which the CLI sends to standard error with the messages. */
  readonly console: ConsoleWriter;

  /** False while the console has written a partial line (the progress dots), which a message must not run on from. */
  private atLineStart = true;

  constructor(private readonly io: CliIo) {
    this.messages = createMessagesFactory({ onItemError: "continue", onMessage: (message) => this.message(message) });
    this.console = {
      write: (text) => this.consoleText(text),
      writeLine: (text = "") => this.consoleText(`${text}\n`),
    };
  }

  private consoleText(text: string): void {
    if (text === "") return;
    this.io.stderr.write(text);
    this.atLineStart = text.endsWith("\n");
  }

  private message({ channel, text }: SentMessage): void {
    if (channel === "status") this.counts.info += 1;
    else if (channel === "warning") this.counts.warnings += 1;
    else if (channel === "currentPackage") this.counts.packages += 1;
    else this.counts.errors += 1;
    if (text !== "") this.line(TAGS[channel], text);
  }

  /** A line of the CLI's own, in the same shape as the engine's. */
  line(tag: string, text: string): void {
    this.io.stderr.write(`${this.atLineStart ? "" : "\n"}[${tag}] ${text}\n`);
    this.atLineStart = true;
  }

  warn(text: string): void {
    this.counts.warnings += 1;
    this.line("WARN", text);
  }

  error(text: string): void {
    this.counts.errors += 1;
    this.line("ERROR", text);
  }
}
