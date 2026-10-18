import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { Engine } from "../../src/engines.js";
import { listFiles, readManifest, toolsetDigest } from "./manifest.js";
import { launcherScript, runId, scrubFile, type HostValue } from "./record.js";
import { findSecrets, scrub } from "./scrub.js";
import { oracleWindowsRoot, stageHost, stageToolset } from "./stage.js";
import { runPowerShellFile, toWslPath, winJoin } from "./windows.js";

/** The two stylesheets embedded in every engine's `Libs.dll`. */
export const XSL_NAMES = ["export.xsl", "build.xsl"] as const;
export type XslName = (typeof XSL_NAMES)[number];

export function isXslName(value: string): value is XslName {
  return (XSL_NAMES as readonly string[]).includes(value);
}

/**
 * Whether the source document keeps whitespace-only nodes (ticket 06): the
 * export DOM is IOM's `PreserveWhitespace = true` document, and build.xsl runs
 * on `CItemHelper.CreateNewXmlDocument()`, which is a plain `XmlDocument`.
 */
export function defaultPreserveWhitespace(xsl: XslName): boolean {
  return xsl === "export.xsl";
}

/** One input document: its case name and its exact bytes. */
export interface XslInput {
  name: string;
  bytes: Buffer;
  /** Where it came from, for run.json. */
  source: string;
}

const CASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A case name is a folder name in the fixture, so it stays portable. */
export function assertCaseName(name: string): void {
  if (!CASE_NAME.test(name)) {
    throw new Error(`case name '${name}' must match ${CASE_NAME} (it becomes a folder name)`);
  }
}

/** `*.xml` files of a folder, or the file itself; the case name is the file name without `.xml`. */
export function inputsFromPath(path: string): XslInput[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((f) => f.toLowerCase().endsWith(".xml") && statSync(join(path, f)).isFile())
      .sort()
      .flatMap((f) => inputsFromPath(join(path, f)));
  }
  const name = basename(path).replace(/\.xml$/i, "");
  assertCaseName(name);
  return [{ name, bytes: readFileSync(path), source: basename(path) }];
}

/**
 * The responses of a recorded export (a fixture folder's `transcript.jsonl`)
 * by call `seq`, each named `recorded-<seq>`. The body is the response as the
 * server sent it, before the engine's own rewrites of EXP-100 to EXP-199, so
 * pick calls whose item the engine passes on unchanged.
 */
export function inputsFromTranscript(dir: string, seqs: readonly number[]): XslInput[] {
  const calls = new Map<number, string>();
  for (const line of readFileSync(join(dir, "transcript.jsonl"), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const call = JSON.parse(line) as { event?: string; seq?: number; response?: string };
    if (typeof call.seq === "number" && typeof call.response === "string") calls.set(call.seq, call.response);
  }
  return seqs.map((seq) => {
    const response = calls.get(seq);
    if (response === undefined) throw new Error(`${dir}/transcript.jsonl has no call with seq ${seq} and a response`);
    return { name: `recorded-${seq}`, bytes: Buffer.from(response, "utf8"), source: `${basename(dir)}/transcript.jsonl seq ${seq}` };
  });
}

/** What the host reports for one input: both steps, each a file or an error. */
export interface HostCase {
  name: string;
  inputSha256: string;
  transform?: string;
  transformError?: ErrorInfo;
  applied?: string;
  appliedError?: ErrorInfo;
}

export interface ErrorInfo {
  type: string;
  message: string;
  cause?: { type: string; message: string };
}

export interface HostInfo {
  culture: string;
  clr: string;
  stylesheet: { resource: string; bytes: number; sha256: string };
  cases: HostCase[];
}

export interface XslRequest {
  engine: Engine;
  xsl: XslName;
  inputs: readonly XslInput[];
  out: string;
  preserveWhitespace?: boolean;
  /** CurrentCulture for the transform (xsl:sort uses it); the host's own when absent. */
  culture?: string;
  log?: (text: string) => void;
}

export interface XslResult {
  out: string;
  hostExit: number;
  cases: number;
  remainingSecrets: string[];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Runs one engine's stylesheet on the inputs under Windows PowerShell 5.1 and
 * writes a scrubbed fixture folder: `run.json` and `cases/<name>/` holding
 * `input.xml`, the engine's `transform.xml` and `applied.xml` (or the errors
 * in run.json). No server and no password are involved.
 */
export async function recordXsl(req: XslRequest): Promise<XslResult> {
  const log = req.log ?? ((t: string) => process.stderr.write(t));
  if (existsSync(req.out) && readdirSync(req.out).length > 0) throw new Error(`${req.out} already exists and is not empty`);
  if (req.inputs.length === 0) throw new Error("xsl needs at least one input document");
  const seen = new Set<string>();
  for (const input of req.inputs) {
    assertCaseName(input.name);
    if (seen.has(input.name)) throw new Error(`two inputs are named '${input.name}'`);
    seen.add(input.name);
  }

  // The hash check: the vendored folder, then the staged copy, before anything is loaded.
  const manifest = readManifest();
  const entry = manifest.engines[req.engine];
  const toolset = stageToolset(req.engine, manifest);
  const host = stageHost();

  const id = runId(req.engine, "xsl");
  const winRun = winJoin(oracleWindowsRoot(), "runs", id);
  const wslRun = toWslPath(winRun);
  mkdirSync(join(wslRun, "input"), { recursive: true });
  // Inputs are scrubbed before the engine sees them, so every output derives from the committed input.
  const inputBytes = new Map<string, Buffer>();
  for (const input of req.inputs) {
    const scrubbed = Buffer.from(scrub(input.bytes.toString("latin1")).text, "latin1");
    inputBytes.set(input.name, scrubbed);
    writeFileSync(join(wslRun, "input", `${input.name}.xml`), scrubbed);
  }

  const preserveWhitespace = req.preserveWhitespace ?? defaultPreserveWhitespace(req.xsl);
  const params: Record<string, HostValue> = {
    Engine: req.engine,
    ToolsetDir: toolset.windows,
    InputDir: winJoin(winRun, "input"),
    OutDir: winJoin(winRun, "result"),
    Xsl: req.xsl,
    PreserveWhitespace: preserveWhitespace,
    ...(req.culture === undefined ? {} : { Culture: req.culture }),
    ExpectedLibsSha256: entry.files.find((f) => f.path === "Libs.dll")!.sha256,
    ExpectedLibsMvid: entry.libs.mvid,
    ExpectedLibsVersion: entry.libs.version,
    ExpectedIomSha256: entry.files.find((f) => f.path === "IOM.dll")!.sha256,
    ExpectedIomMvid: entry.iom.mvid,
    ExpectedIomVersion: entry.iom.version,
  };
  mkdirSync(join(wslRun, "result"));
  writeFileSync(join(wslRun, "launcher.ps1"), launcherScript(winJoin(host.windows, "xsl-probe.ps1"), params));

  const startedAt = new Date().toISOString();
  const result = await runPowerShellFile(winJoin(winRun, "launcher.ps1"), {}, log);
  const finishedAt = new Date().toISOString();
  const hostJson = join(wslRun, "result", "host.json");
  if (result.code !== 0 || !existsSync(hostJson)) {
    rmSync(wslRun, { recursive: true, force: true });
    throw new Error(`the XSL host failed (exit ${result.code}):\n${(result.stdout + result.stderr).trim()}`);
  }
  const info = JSON.parse(readFileSync(hostJson, "utf8").replace(/^﻿/, "")) as HostInfo;
  info.cases = [...info.cases].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Collect: the case folders, each with its input beside the results.
  mkdirSync(req.out, { recursive: true });
  for (const c of info.cases) {
    const bytes = inputBytes.get(c.name);
    if (bytes === undefined) throw new Error(`the host returned an unknown case '${c.name}'`);
    if (sha256(bytes) !== c.inputSha256) throw new Error(`case '${c.name}': the host read different input bytes than were staged`);
    const dir = join(req.out, "cases", c.name);
    cpSync(join(wslRun, "result", "cases", c.name), dir, { recursive: true });
    writeFileSync(join(dir, "input.xml"), bytes);
  }
  const scrubbed: Record<string, Record<string, number>> = {};
  for (const path of listFiles(req.out)) {
    const counts = scrubFile(join(req.out, path), []);
    if (Object.keys(counts).length > 0) scrubbed[path] = counts;
  }

  const run = {
    engine: req.engine,
    command: "xsl",
    toolset: { digest: toolsetDigest(entry), source: entry.source, libs: entry.libs, iom: entry.iom },
    xsl: req.xsl,
    stylesheet: info.stylesheet,
    preserveWhitespace,
    culture: info.culture,
    clr: info.clr,
    startedAt,
    finishedAt,
    cases: info.cases.map((c) => ({ ...c, source: req.inputs.find((i) => i.name === c.name)!.source })),
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
  log(`recorded ${relative(process.cwd(), req.out) || basename(req.out)} (${info.cases.length} cases)\n`);
  return { out: req.out, hostExit: result.code, cases: info.cases.length, remainingSecrets };
}
