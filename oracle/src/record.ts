import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { Engine } from "../../src/engines.js";
import { listFiles, readManifest, toolsetDigest } from "./manifest.js";
import { findSecrets, scrub, secretForms } from "./scrub.js";
import { stageHost, stageToolset, oracleWindowsRoot } from "./stage.js";
import { runPowerShellFile, toWslPath, winJoin } from "./windows.js";

/** The dev instance as Windows reaches it (WSL reaches the same host as 172.19.0.1). AGENTS.md: dev only. */
export const DEV_SERVER = { url: "http://localhost/12sp9", database: "12sp9" } as const;
const DEV_URLS = new Set(["http://localhost/12sp9", "http://172.19.0.1/12sp9"]);

export type HostValue = string | number | boolean | readonly string[];

export interface RecordRequest {
  engine: Engine;
  command: "export" | "import" | "lpimport";
  url: string;
  database: string;
  user: string;
  password: string;
  /** Where the scrubbed fixture folder is written; must not exist yet or be empty. */
  out: string;
  /** Per-engine host parameters (engine options and host switches), by PowerShell name. */
  params: Record<string, HostValue>;
  /** import/lpimport: the package folder holding the manifest. */
  inputDir?: string;
  /** import: manifest file name inside `inputDir`. */
  manifestName?: string;
  /** lpimport: the language pack folder and its config file inside it. */
  lpDir?: string;
  lpConfig?: string;
  log?: (text: string) => void;
}

export interface ItemRef {
  type: string;
  id: string;
  /** Its call failed in transport, so the item may never have been committed. */
  unconfirmed?: true;
}

/** What an import's cleanup did (host.json `cleanup`): every item the run created, and which it deleted or kept. */
export interface CleanupReport {
  created: ItemRef[];
  deleted: ItemRef[];
  kept: (ItemRef & { reason: string })[];
  /** Unconfirmed items not found at cleanup: the server may still commit them, so they need a re-check later. */
  unverified: ItemRef[];
}

export interface RecordResult {
  out: string;
  hostExit: number;
  calls: number | null;
  error: string | null;
  /** import/lpimport: null when the host did not report a cleanup. */
  cleanup: CleanupReport | null;
  remainingSecrets: string[];
}

/** A PowerShell single-quoted literal. Tabs and newlines stay literal; each quote character (' and U+2018–U+201B) is doubled. */
export function psLiteral(value: HostValue): string {
  if (typeof value === "boolean") return value ? "$true" : "$false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replace(/['\u2018-\u201b]/g, "$&$&")}'`;
  return `@(${value.map((v) => psLiteral(v)).join(", ")})`;
}

/**
 * The launcher splats every parameter, so no value crosses a Windows command
 * line. It starts with a BOM, because Windows PowerShell 5.1 reads a BOM-less
 * script in the ANSI code page.
 */
export function launcherScript(hostScript: string, params: Record<string, HostValue>): string {
  const lines = Object.entries(params).map(([k, v]) => `    ${k} = ${psLiteral(v)}`);
  return "\ufeff" + [
    "$ErrorActionPreference = 'Stop'",
    "$p = @{",
    ...lines,
    "}",
    `& ${psLiteral(hostScript)} @p`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n");
}

export function assertDevUrl(url: string): void {
  if (!DEV_URLS.has(url.replace(/\/+$/, ""))) {
    throw new Error(`refusing ${url}: the oracle talks to the dev instance only (${[...DEV_URLS].join(", ")})`);
  }
}

/**
 * Import fixtures touch only LIBSJS-SCRATCH-* packages (AGENTS.md). This is
 * the early check; the host checks the packages and item files the engine
 * actually gets, right before ImportSolutions.
 */
export function assertScratchPackages(packages: readonly string[]): void {
  if (packages.length === 0) throw new Error("refusing to import: no package names found");
  const bad = packages.filter((p) => !p.startsWith("LIBSJS-SCRATCH-"));
  if (bad.length > 0) throw new Error(`refusing to import non-scratch packages: ${bad.join(", ")}`);
}

/** Package names listed in an imports.mf, read loosely (the engine's own reader is the spec's job). */
export function manifestPackageNames(manifestText: string): string[] {
  return [...manifestText.matchAll(/<package\b[^>]*?\bname\s*=\s*(["'])(.*?)\1/g)].map((m) => m[2]!);
}

/** The packages a run hands the engine: lpimport's --lp-package, else --packages, else every package in the manifest. */
export function importedPackageNames(req: Pick<RecordRequest, "command" | "params" | "inputDir" | "manifestName">): string[] {
  const { LPPackage, Packages } = req.params;
  if (req.command === "lpimport") return typeof LPPackage === "string" ? [LPPackage] : [];
  if (Array.isArray(Packages)) return [...Packages];
  return manifestPackageNames(readFileSync(join(req.inputDir!, req.manifestName ?? "imports.mf"), "utf8"));
}

function runId(engine: Engine, command: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  return `${stamp}-${engine}-${command}-${randomBytes(3).toString("hex")}`;
}

/**
 * Scrubs one file in place. Files are handled as latin1, which maps bytes to
 * characters one to one, so a file with nothing to scrub keeps its exact
 * bytes (BOM, CRLF, any encoding) and the ASCII patterns still match.
 */
function scrubFile(path: string, secrets: readonly string[]): Record<string, number> {
  const original = readFileSync(path).toString("latin1");
  const { text, counts } = scrub(original, secrets);
  if (text !== original) writeFileSync(path, Buffer.from(text, "latin1"));
  return counts;
}

export async function record(req: RecordRequest): Promise<RecordResult> {
  const log = req.log ?? ((t: string) => process.stderr.write(t));
  assertDevUrl(req.url);
  if (existsSync(req.out) && readdirSync(req.out).length > 0) throw new Error(`${req.out} already exists and is not empty`);
  if (req.command !== "export") {
    if (req.inputDir === undefined) throw new Error(`${req.command} needs a package folder`);
    assertScratchPackages(importedPackageNames(req));
  }

  // The hash check: the vendored folder, then the staged copy, before anything is loaded.
  const manifest = readManifest();
  const entry = manifest.engines[req.engine];
  const toolset = stageToolset(req.engine, manifest);
  const host = stageHost();

  const id = runId(req.engine, req.command);
  const winRun = winJoin(oracleWindowsRoot(), "runs", id);
  const wslRun = toWslPath(winRun);
  mkdirSync(wslRun, { recursive: true });

  const params: Record<string, HostValue> = {
    Command: req.command,
    ToolsetDir: toolset.windows,
    OutDir: winRun,
    Url: req.url,
    Database: req.database,
    User: req.user,
    ExpectedLibsSha256: entry.files.find((f) => f.path === "Libs.dll")!.sha256,
    ExpectedLibsMvid: entry.libs.mvid,
    ExpectedLibsVersion: entry.libs.version,
    ExpectedIomSha256: entry.files.find((f) => f.path === "IOM.dll")!.sha256,
    ExpectedIomMvid: entry.iom.mvid,
    ExpectedIomVersion: entry.iom.version,
    ...req.params,
  };
  if (req.command === "export") {
    mkdirSync(join(wslRun, "output"));
    params.WorkDir = winJoin(winRun, "output");
  } else {
    cpSync(req.inputDir!, join(wslRun, "input"), { recursive: true });
    params.WorkDir = winJoin(winRun, "input");
    if (req.command === "import") params.ImportManifest = winJoin(winRun, "input", req.manifestName ?? "imports.mf");
    if (req.command === "lpimport") {
      if (req.lpDir === undefined) throw new Error("lpimport needs a language pack folder");
      cpSync(req.lpDir, join(wslRun, "lp"), { recursive: true });
      params.LPPath = winJoin(winRun, "lp", ...(req.lpConfig ?? "ImportConfig.xml").split("/"));
    }
  }
  writeFileSync(join(wslRun, "launcher.ps1"), launcherScript(winJoin(host.windows, `engine-${req.engine}.ps1`), params));

  const secrets = [...secretForms(req.password)];
  const startedAt = new Date().toISOString();
  const result = await runPowerShellFile(winJoin(winRun, "launcher.ps1"), { ARAS_PASSWORD: req.password }, (chunk) =>
    log(scrub(chunk, [req.password, ...secrets], { literalSecrets: true }).text),
  );
  const finishedAt = new Date().toISOString();
  writeFileSync(join(wslRun, "host.log"), scrub(result.stdout + result.stderr, [req.password, ...secrets], { literalSecrets: true }).text);

  // Collect: everything but the launcher, then scrub every file.
  mkdirSync(req.out, { recursive: true });
  for (const name of readdirSync(wslRun)) {
    if (name === "launcher.ps1") continue;
    cpSync(join(wslRun, name), join(req.out, name), { recursive: true });
  }
  const scrubbed: Record<string, Record<string, number>> = {};
  for (const path of listFiles(req.out)) {
    const counts = scrubFile(join(req.out, path), secrets);
    if (Object.keys(counts).length > 0) scrubbed[path] = counts;
  }

  const hostInfo = existsSync(join(req.out, "host.json"))
    ? (JSON.parse(readFileSync(join(req.out, "host.json"), "utf8")) as Record<string, unknown>)
    : null;
  if (hostInfo !== null) rmSync(join(req.out, "host.json"));
  const cleanup = (hostInfo?.cleanup as CleanupReport | undefined) ?? null;
  if (hostInfo !== null) delete hostInfo.cleanup;
  const recordedParams = Object.fromEntries(
    Object.entries(params).filter(([k]) => !/^(ToolsetDir|OutDir|WorkDir|ImportManifest|LPPath)$|^Expected/.test(k)),
  );
  const run = {
    engine: req.engine,
    command: req.command,
    toolset: { digest: toolsetDigest(entry), source: entry.source, libs: entry.libs, iom: entry.iom },
    server: { url: req.url, database: req.database, user: req.user },
    params: recordedParams,
    recorder: "RecordingHttpServerConnection (IOM HttpServerConnection subclass, CallAction override)",
    startedAt,
    finishedAt,
    hostExit: result.code,
    host: hostInfo,
    ...(req.command === "export" ? {} : { cleanup }),
    scrubbed,
  };
  writeFileSync(join(req.out, "run.json"), `${JSON.stringify(run, null, 2)}\n`);

  const remainingSecrets: string[] = [];
  for (const path of listFiles(req.out)) {
    for (const hit of findSecrets(readFileSync(join(req.out, path)).toString("latin1"))) {
      remainingSecrets.push(`${path}@${hit.index}: ${hit.pattern}`);
    }
  }
  rmSync(wslRun, { recursive: true, force: true });
  log(`recorded ${relative(process.cwd(), req.out) || basename(req.out)} (${dirname(req.out)})\n`);
  return {
    out: req.out,
    hostExit: result.code,
    calls: typeof hostInfo?.calls === "number" ? hostInfo.calls : null,
    error: typeof hostInfo?.error === "string" ? hostInfo.error : null,
    cleanup,
    remainingSecrets,
  };
}
