import { closeSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { ENGINE_ASSEMBLY_VERSIONS, type Engine } from "../engines.js";
import type { ArasVersion } from "../client/version.js";
import { ArgumentException, ArgumentNullException, IOException } from "../io/errors.js";
import { getFullPath, toHostPath, translateFileError } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import type { SUExportContext } from "./export-context.js";

/**
 * `DateTime.Now.ToString(CultureInfo.InvariantCulture)`: the local time as `MM/dd/yyyy HH:mm:ss` (EXP-505).
 *
 * @spec EXP-505
 */
export function invariantDateTime(date: Date): string {
  const two = (value: number): string => String(value).padStart(2, "0");
  const day = `${two(date.getMonth() + 1)}/${two(date.getDate())}/${String(date.getFullYear()).padStart(4, "0")}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/** The host paths of the log files a run holds open. A second writer on one of them fails (EXP-505, EXP-541). */
const held = new Set<string>();

/**
 * The log: the engine's `StreamWriter` on `LogFilePath`, opened for append (EXP-505). The file is created when it does not exist,
 * the text is UTF-8 without a BOM with CRLF line ends, and the bytes reach the file when the writer is disposed. While one is open,
 * a second writer on the same path fails with the `IOException` of a sharing violation, which is bug EXP-541.
 *
 * @spec EXP-505 EXP-541
 */
export class RunLog {
  private pending: string[] = [];
  private closed = false;

  private constructor(
    private readonly descriptor: number,
    private readonly key: string,
  ) {}

  /**
   * `IOWrapper.NewStreamWriter(path, append: true)`. A null path throws `ArgumentNullException`, an empty one `ArgumentException`,
   * a missing folder `DirectoryNotFoundException`. The engine normalises the path first in the export's own writer and not in
   * `GetSolutions2Xml`'s second one; the host path is the same either way.
   */
  static open(path: string | null, environment: PathEnvironment = {}): RunLog {
    if (path === null) throw new ArgumentNullException("path");
    if (path.length === 0) throw new ArgumentException("Empty path name is not legal.");
    const host = toHostPath(path, environment);
    if (host === null) throw new ArgumentNullException("path");
    const key = resolve(host);
    if (held.has(key)) {
      const full = (environment.platform ?? process.platform) === "win32" ? getFullPath(path, environment.cwd ?? process.cwd()) : key;
      throw new IOException(`The process cannot access the file '${full}' because it is being used by another process.`);
    }
    let descriptor: number;
    try {
      descriptor = openSync(host, "a");
    } catch (error) {
      throw translateFileError(error, host, true);
    }
    held.add(key);
    return new RunLog(descriptor, key);
  }

  /** `WriteLine(text)`: the text and a CRLF. */
  writeLine(text = ""): void {
    this.pending.push(text, "\r\n");
  }

  /** Writes what is buffered and closes the file, which other writers may then open. Disposing twice does nothing. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    held.delete(this.key);
    try {
      if (this.pending.length > 0) writeSync(this.descriptor, Buffer.from(this.pending.join(""), "utf8"));
    } finally {
      this.pending = [];
      closeSync(this.descriptor);
    }
  }
}

/**
 * `string.Format` with the invariant culture, as the engine's `FormatWithArgs` extension does it: a bool is `True` or `False`, an
 * enum its name, and null or undefined nothing.
 *
 * @spec EXP-506
 */
export function formatWithArgs(template: string, ...args: (string | boolean | null | undefined)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index: string) => {
    const value = args[Number(index)];
    if (typeof value === "boolean") return value ? "True" : "False";
    return value ?? "";
  });
}

/**
 * `LogInputParameters` for an export: the block `ExportSolutions` writes at the top of the log, one line per setting (EXP-506). The
 * block ends with the CRLF of its last line, and `WriteLine` adds one more, so the log shows an empty line after it. The `Innovator
 * version` line reads the version of the login, and a helper that never logged in has none: a `NullReferenceException`, thrown by
 * the caller before anything is written.
 *
 * @spec EXP-506
 */
export function logInputParameters(context: SUExportContext, innovatorVersion: ArasVersion, engine: Engine): string {
  const lines = [
    formatWithArgs("Tool version: {0}", ENGINE_ASSEMBLY_VERSIONS[engine]),
    formatWithArgs("Action: {0}", context.action),
    formatWithArgs("Manifest file: {0}", context.manifestFile),
    formatWithArgs("Log file: {0}", context.logFilePath),
    formatWithArgs("Working directory: {0}", context.workingDirectory),
    formatWithArgs("URL: {0}", context.url),
    formatWithArgs("Database: {0}", context.dataBase),
    formatWithArgs("User: {0}", context.userName),
    formatWithArgs("Innovator version: {0}", innovatorVersion.fullString),
    formatWithArgs("Language pack: {0}", context.lpPath),
    formatWithArgs("Language pack name: {0}", context.lpPackage),
    formatWithArgs("Export referenced items: {0}", context.exportReferencedItems),
    formatWithArgs("Export unknown packages action: {0}", context.refToUnknownPacks),
    formatWithArgs("Export level: {0}", context.level),
    formatWithArgs("Export using import structure: {0}", context.useImport),
  ];
  return lines.map((line) => `${line}\r\n`).join("");
}
