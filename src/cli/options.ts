import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_ENGINE, ENGINES, type Engine, isEngine } from "../engines.js";
import { EngineNotSupportedError } from "../client/engine-support.js";
import type { CliIo } from "./io.js";
import { UsageError } from "./usage.js";

export type OptionSpec = Record<string, { type: "string" | "boolean"; multiple?: boolean; short?: string }>;
export type OptionValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

/** The options every command that talks to a server takes. */
export const CONNECTION_OPTIONS = {
  url: { type: "string" },
  database: { type: "string" },
  user: { type: "string" },
  "password-stdin": { type: "boolean" },
  engine: { type: "string" },
  log: { type: "string" },
  timeout: { type: "string" },
  "time-zone": { type: "string" },
  "skip-version-check": { type: "boolean" },
  verbose: { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies OptionSpec;

/** The options of the commands that run an import (`import` and `import-language-pack`). */
export const IMPORT_OPTIONS = {
  release: { type: "string" },
  description: { type: "string" },
  merge: { type: "boolean" },
  "no-merge": { type: "boolean" },
  "os-user": { type: "string" },
} as const satisfies OptionSpec;

/** `parseArgs` in strict mode, with its refusals as usage errors. */
export function parseOptions(args: readonly string[], spec: OptionSpec): { values: OptionValues; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({ args: [...args], options: spec, allowPositionals: true, strict: true });
    return { values: values as OptionValues, positionals };
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export function stringOf(values: OptionValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

export function flagOf(values: OptionValues, name: string): boolean {
  return values[name] === true;
}

export function listOf(values: OptionValues, name: string): string[] {
  const value = values[name];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** `--engine`, else `ARAS_PKG_ENGINE`, else the default (round 3, Q2). */
export function resolveEngine(values: OptionValues, io: CliIo): Engine {
  const given = stringOf(values, "engine") ?? io.env.ARAS_PKG_ENGINE;
  if (given === undefined || given === "") return DEFAULT_ENGINE;
  if (!isEngine(given)) throw new UsageError(`unknown engine '${given}'; the engines are ${ENGINES.join(", ")}`);
  return given;
}

/** An engine that a command has no variant slice for yet reports so (exit 1); one it never has is the command's own usage error. */
export function requireEngine(engine: Engine, supported: readonly Engine[]): void {
  if (!supported.includes(engine)) throw new EngineNotSupportedError(engine);
}

export interface ConnectionOptions {
  url: string;
  database: string;
  user: string;
  password: string;
  /** The context timeout in milliseconds (WIRE-031). */
  timeout: number;
  /** The `TIMEZONE_NAME` of the connection: a Windows time zone id. This machine's own when absent (WIRE-005). */
  timeZoneName: string | undefined;
  skipVersionCheck: boolean;
}

/** `--timeout`: a whole number of milliseconds, 0 or more, or -1 for no limit. */
function parseTimeout(text: string | undefined): number {
  if (text === undefined) return 0;
  if (!/^-?\d+$/.test(text) || Number(text) < -1) {
    throw new UsageError(`--timeout needs a whole number of milliseconds (0 or more, or -1 for no limit), not '${text}'`);
  }
  return Number(text);
}

/** The password from standard input: all of it, less one final line end. */
async function passwordFromStdin(io: CliIo): Promise<string> {
  return (await io.readStdin()).replace(/\r?\n$/, "");
}

/**
 * The connection settings of a run, all checked before any request is made. The password is read from `ARAS_PASSWORD`, or from
 * standard input with `--password-stdin`, and never from a flag.
 *
 * @spec WIRE-002
 */
export async function resolveConnection(values: OptionValues, io: CliIo): Promise<ConnectionOptions> {
  const url = stringOf(values, "url") ?? io.env.ARAS_URL;
  const database = stringOf(values, "database") ?? io.env.ARAS_DATABASE;
  const user = stringOf(values, "user") ?? io.env.ARAS_USER;
  const stdin = flagOf(values, "password-stdin");
  const missing = [
    [url, "--url (or ARAS_URL)"],
    [database, "--database (or ARAS_DATABASE)"],
    [user, "--user (or ARAS_USER)"],
    [stdin ? "stdin" : io.env.ARAS_PASSWORD, "the password (ARAS_PASSWORD, or --password-stdin)"],
  ]
    .filter(([value]) => value === undefined || value === "")
    .map(([, name]) => name);
  if (missing.length > 0) throw new UsageError(`missing ${missing.join(", ")}`);
  const password = stdin ? await passwordFromStdin(io) : (io.env.ARAS_PASSWORD as string);
  if (password === "") throw new UsageError("the password on standard input is empty");
  return {
    url: url as string,
    database: database as string,
    user: user as string,
    password,
    timeout: parseTimeout(stringOf(values, "timeout")),
    timeZoneName: stringOf(values, "time-zone"),
    skipVersionCheck: flagOf(values, "skip-version-check"),
  };
}

/** The date-time in the default log name: `yyyyMMdd-HHmmss`, local time. */
function stamp(date: Date): string {
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

/**
 * The log file of a run: `--log`, or `aras-pkg-<command>-<date>.log` in the current directory. Its folder is made when it is
 * missing, as the engine's console host does, so a path that cannot be made is refused here and not after the login.
 */
export function resolveLogPath(values: OptionValues, command: string, io: CliIo): string {
  const given = stringOf(values, "log");
  if (given === "") throw new UsageError("--log needs a path");
  const path = given ?? join(io.cwd(), `aras-pkg-${command}-${stamp(io.now())}.log`);
  const absolute = isAbsolute(path) ? path : resolve(io.cwd(), path);
  try {
    mkdirSync(dirname(absolute), { recursive: true });
  } catch (error) {
    throw new UsageError(`the log folder cannot be made: ${(error as Error).message}`);
  }
  return path;
}
