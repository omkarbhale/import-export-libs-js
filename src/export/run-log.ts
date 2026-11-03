import { closeSync, openSync, writeSync } from "node:fs";
import { ENGINE_ASSEMBLY_VERSIONS, type Engine } from "../engines.js";
import type { ArasVersion } from "../client/version.js";
import { ArgumentException, ArgumentNullException, IOException } from "../io/errors.js";
import { defaultHostEnv } from "../host/default-host.js";
import type { HostEnv } from "../host/types.js";
import { envOf, getFullPath, toHostPath, translateFileError } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { flavourOf } from "../io/path.js";
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

/**
 * The general date and time pattern (short date, long time) of the cultures whose pattern was probed with .NET Framework 4.8
 * (EXP-505). Any other culture gets the invariant pattern, which is not what the engine writes there.
 */
const GENERAL_PATTERNS: Readonly<Record<string, string>> = {
  "en-US": "M/d/yyyy h:mm:ss tt",
  "en-GB": "dd/MM/yyyy HH:mm:ss",
  "fr-FR": "dd/MM/yyyy HH:mm:ss",
  "en-IN": "dd-MM-yyyy HH:mm:ss",
  "de-DE": "dd.MM.yyyy HH:mm:ss",
};

/**
 * The culture of this process, as `Intl` names it (`en-US`), which the 12.0 engine's date-times follow by default: the host's
 * locale (HOST-203).
 * @spec HOST-203
 */
export function processCulture(host: HostEnv = defaultHostEnv()): string {
  return host.locale();
}

/**
 * `DateTime.Now.ToString()` of the current culture: the culture's general date and time pattern (EXP-505, `[12.0]`). The names
 * of the cultures are matched without regard to case, with `_` read as `-`. The invariant culture is the empty name.
 *
 * @spec EXP-505
 */
export function currentCultureDateTime(date: Date, culture: string = processCulture()): string {
  const name = culture.replace(/_/g, "-").toLowerCase();
  const pattern = Object.entries(GENERAL_PATTERNS).find(([known]) => known.toLowerCase() === name)?.[1];
  if (pattern === undefined) return invariantDateTime(date);
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  const hour12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
  const fields: Record<string, string> = {
    yyyy: pad(date.getFullYear(), 4),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    dd: pad(date.getDate()),
    d: String(date.getDate()),
    HH: pad(date.getHours()),
    h: String(hour12),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    tt: date.getHours() < 12 ? "AM" : "PM",
  };
  return pattern.replace(/yyyy|MM|M|dd|d|HH|h|mm|ss|tt/g, (field) => fields[field] as string);
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
    const env = envOf(environment);
    const key = flavourOf(env.platform).resolveFrom(env.cwd, host);
    if (held.has(key)) {
      const full = env.platform === "win32" ? getFullPath(path, env.cwd) : key;
      throw new IOException(`The process cannot access the file '${full}' because it is being used by another process.`);
    }
    let descriptor: number;
    try {
      descriptor = openSync(host, "a");
    } catch (error) {
      throw translateFileError(error, host, true, environment);
    }
    held.add(key);
    return new RunLog(descriptor, key);
  }

  /** `Write(text)`: the text as it is, with no line end. */
  write(text: string): void {
    this.pending.push(text);
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
