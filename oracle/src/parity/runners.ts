import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { allPackagesTable, fromManifestTable, useImportTable } from "../../../src/cli/console-modes.js";
import type { SelectionTable } from "../../../src/export/import-export-manager.js";
import type { Engine } from "../../../src/engines.js";
import { hostItems, hostOptions as exportHostOptions, type ExportCase } from "../export-cases.js";
import { resolveCase, type SeedGroup } from "../export-scratch-cases.js";
import { hostOptions as importHostOptions, expectedOutcome, type ImportCase, type ImportStep } from "../import-cases.js";
import { writePackages, type ScratchPackage } from "../import-packages.js";
import { LP_PACKAGE, writePack, type LpCase } from "../language-pack-cases.js";
import { outcomeMatches, returnedValue } from "../record-import-cases.js";
import { oracleWindowsRoot } from "../stage.js";
import { winJoin } from "../windows.js";
import { record, runId, type CleanupReport, type ItemRef, type RecordRequest, type RecordResult } from "../record.js";
import { type Difference, diffOutcomes } from "./diff.js";
import { diffExportRuns1435 } from "./diff-1435.js";
import { getProperty } from "../../../src/client/fault.js";
import { type RunOutcome, readOracleOutcome } from "./outcome.js";
import { type PortServer, createdBy, openSideConnection, osUserOf, runPortExport, runPortImport, runPortLanguagePack, selectionOf } from "./port-run.js";
import { type CreatedItem, cleanup as portCleanup } from "./scratch.js";

/** What every runner needs: the engine, who connects where, and where this run keeps its folders. */
export interface ParityEnv {
  engine: Engine;
  /** The user the oracle and the port both log in as. */
  user: string;
  password: string;
  /** The dev instance as the oracle (Windows) reaches it. */
  oracleUrl: string;
  database: string;
  port: PortServer;
  /** The folder of this parity run: one folder per case, one per step, `oracle/` and `port/` inside. */
  out: string;
  log: (line: string) => void;
}

/** One compared run: an export, one import step, or one language-pack import. */
export interface StepReport {
  name: string;
  differences: Difference[];
  oracleCalls: number;
  portCalls: number;
  oracleEnd: string;
  portEnd: string;
}

export type CaseStatus = "equal" | "different" | "known" | "skipped" | "failed";

export interface CaseReport {
  id: string;
  kind: string;
  status: CaseStatus;
  steps: StepReport[];
  /** Why a case was skipped or failed. */
  note?: string;
  /** Every item either side created on dev for this case, and what the cleanups deleted. */
  created: ItemRef[];
  deleted: ItemRef[];
  seconds: number;
}

const describeEnd = (outcome: RunOutcome): string =>
  outcome.termination.kind === "exception"
    ? `exception ${outcome.termination.summary.split("\n")[0]}`
    : outcome.termination.kind === "returned"
      ? `returned ${outcome.termination.value}`
      : "exported";

/**
 * A fresh folder for the port's package files whose path is as long as the oracle's `input/` folder (`…\\oracle\\runs\\<run id>\\input`).
 * A path reaches the engine's package log (the warning for a file without a root tag), and 12.0 reads the in-memory log only up to
 * `1024 × ⌊(N − 1) / 1024⌋` UTF-16 code units (IMP-406): a path of another length would move the cut, a difference of the harness
 * and not of the engine. The caller removes the folder's parent (`dirname`) when the step is done.
 */
export function inputDirLikeOracle(engine: Engine, command: string, base = tmpdir()): string {
  const target = winJoin(oracleWindowsRoot(), "runs", runId(engine, command), "input").length;
  const root = mkdtempSync(join(base, "libsjs-parity-in-"));
  const pad = target - root.length - "//input".length;
  if (pad < 1) return join(root, "input");
  const dir = join(root, "p".repeat(pad), "input");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A compared run with the differences found by a comparison of its own. */
function report(name: string, oracle: RunOutcome, port: RunOutcome, differences: Difference[]): StepReport {
  return { name, differences, oracleCalls: oracle.calls.length, portCalls: port.calls.length, oracleEnd: describeEnd(oracle), portEnd: describeEnd(port) };
}

/** The login every call list starts with is the same on both sides here: the live port logs in as the oracle host does. */
export function compare(
  name: string,
  oracle: RunOutcome,
  port: RunOutcome,
  earlier?: { oracle: RunOutcome[]; port: RunOutcome[]; madeBefore?: { oracle: string[]; port: string[] } },
): StepReport {
  return {
    name,
    differences: diffOutcomes(oracle, port, {
      ...(earlier === undefined ? {} : { earlier: { oracle: earlier.oracle.flatMap((o) => o.calls), port: earlier.port.flatMap((o) => o.calls) } }),
      ...(earlier?.madeBefore === undefined ? {} : { madeBefore: earlier.madeBefore }),
    }),
    oracleCalls: oracle.calls.length,
    portCalls: port.calls.length,
    oracleEnd: describeEnd(oracle),
    portEnd: describeEnd(port),
  };
}

const statusOf = (steps: readonly StepReport[]): CaseStatus => (steps.every((s) => s.differences.length === 0) ? "equal" : "different");

/** A step the script could not run at all (the dev state was not what the case needs, or a safety check refused it). */
export class CaseFailure extends Error {}

/** Items a case could not delete again: the run stops, because dev is not clean. */
export class DevNotClean extends Error {
  constructor(
    message: string,
    readonly left: readonly string[],
  ) {
    super(message);
  }
}

const refs = (items: readonly CreatedItem[]): ItemRef[] => items.map((i) => ({ type: i.type, id: i.id, ...(i.unconfirmed ? { unconfirmed: true as const } : {}) }));
const priorLines = (created: readonly ItemRef[]): string[] => created.map((c) => [c.type, c.id, c.unconfirmed === true ? "1" : "0"].join("\t"));

/** One oracle run into `<out>/<label>/oracle`. */
async function oracleRun(
  env: ParityEnv,
  label: string,
  request: Omit<RecordRequest, "engine" | "url" | "database" | "user" | "password" | "out" | "log">,
): Promise<{ result: RecordResult; out: string }> {
  const out = join(env.out, label, "oracle");
  const result = await record({
    engine: env.engine,
    url: env.oracleUrl,
    database: env.database,
    user: env.user,
    password: env.password,
    out,
    log: () => undefined,
    ...request,
  });
  if (result.remainingSecrets.length > 0) {
    throw new CaseFailure(`credential-shaped text survived scrubbing in ${label}: ${result.remainingSecrets.join(", ")}`);
  }
  return { result, out };
}

/** The oracle's `cleanup` command over what earlier kept runs created; dev must be left clean. */
async function oracleCleanup(env: ParityEnv, label: string, created: readonly ItemRef[]): Promise<ItemRef[]> {
  if (created.length === 0) return [];
  const { result } = await oracleRun(env, `${label}-cleanup`, { command: "cleanup", params: { PriorCreated: priorLines(created) } });
  const report = result.cleanup;
  const left = [...(report?.kept ?? []).map((k) => `${k.type}:${k.id} (${k.reason})`), ...(report?.unverified ?? []).map((u) => `${u.type}:${u.id} (unverified)`)];
  if (report === null || left.length > 0) throw new DevNotClean(`the oracle's cleanup of ${label} left items behind`, left.length > 0 ? left : created.map((c) => `${c.type}:${c.id}`));
  return report.deleted;
}

/** The port's cleanup of what its runs created, through a connection that records nothing. */
async function portCleanupAll(env: ParityEnv, label: string, created: readonly CreatedItem[]): Promise<ItemRef[]> {
  if (created.length === 0) return [];
  const side = await openSideConnection(env.port);
  let report: CleanupReport;
  try {
    report = await portCleanup(side.inn, created);
  } finally {
    await side.close();
  }
  const left = [...report.kept.map((k) => `${k.type}:${k.id} (${k.reason})`), ...report.unverified.map((u) => `${u.type}:${u.id} (unverified)`)];
  if (left.length > 0) throw new DevNotClean(`the port's cleanup of ${label} left items behind`, left);
  return report.deleted;
}

// ---- export ----------------------------------------------------------------------------------------------------------------

/** One export case: the oracle exports, the port exports, and the two are compared. */
export async function runExportCase(env: ParityEnv, c: Pick<ExportCase, "id" | "packages" | "options">, label = c.id): Promise<StepReport> {
  const options = c.options ?? {};
  const { out } = await oracleRun(env, label, { command: "export", params: { Items: hostItems(c.packages), ...exportHostOptions(options) } });
  const oracle = readOracleOutcome(out, { filesFrom: "output" });
  const port = await runPortExport(env.port, { selection: selectionOf(c.packages), options });
  writePortRun(join(env.out, label, "port"), port);
  // 14.35 exports the items of a package in parallel: its runs agree in the parts EXP-558 names
  if (env.engine === "14.35") return report(label, oracle, port, diffExportRuns1435(oracle, port, { packages: c.packages, options }));
  return compare(label, oracle, port);
}

export async function runPlainExport(env: ParityEnv, c: ExportCase): Promise<CaseReport> {
  const started = Date.now();
  const step = await runExportCase(env, c);
  return { id: c.id, kind: "export", status: statusOf([step]), steps: [step], created: [], deleted: [], seconds: (Date.now() - started) / 1000 };
}

// ---- scratch-seeded export -------------------------------------------------------------------------------------------------

/** Seeds a group on dev with the oracle: every step keeps what it created. */
async function oracleSeed(env: ParityEnv, label: string, steps: readonly ImportStep[], created: ItemRef[]): Promise<void> {
  for (const [i, step] of steps.entries()) {
    const input = join(env.out, label, `seed-input-${i + 1}`);
    writePackages(input, step.packages);
    const { result, out } = await oracleRun(env, `${label}-seed-${i + 1}`, {
      command: "import",
      inputDir: input,
      params: { ...importHostOptions(step.options, step.only), KeepCreated: true, ...(created.length === 0 ? {} : { PriorCreated: priorLines(created) }) },
    });
    created.push(...(result.cleanup?.created ?? []));
    const run = JSON.parse(readFileSync(join(out, "run.json"), "utf8")) as { host: { result?: string | null } | null };
    const returned = returnedValue(run.host?.result);
    if (!outcomeMatches(step.expect, { hostExit: result.hostExit, returned, error: result.error })) {
      throw new CaseFailure(`seed step ${i + 1} (${step.name}): expected ${step.expect}, got host exit ${result.hostExit}, returned ${returned}, error ${result.error?.split("\n")[0] ?? "none"}`);
    }
    rmSync(join(env.out, label, `seed-input-${i + 1}`), { recursive: true, force: true });
  }
}

/** A seed group: import its packages, export each chosen case with both sides, and delete what the seed made. */
export async function runSeedGroup(env: ParityEnv, group: SeedGroup, caseIds: ReadonlySet<string>): Promise<CaseReport[]> {
  const started = Date.now();
  const created: ItemRef[] = [];
  const steps: Array<{ id: string; step: StepReport }> = [];
  let failure: unknown;
  let deleted: ItemRef[] = [];
  try {
    await oracleSeed(env, group.id, group.steps, created);
    for (const c of group.cases.filter((x) => caseIds.has(x.id))) {
      const resolved = resolveCase(c, created);
      steps.push({ id: c.id, step: await runExportCase(env, { id: c.id, packages: resolved.packages, options: resolved.options ?? {} }, `${group.id}-${c.id}`) });
    }
  } catch (error) {
    failure = error;
  } finally {
    deleted = await oracleCleanup(env, group.id, created);
  }
  if (failure !== undefined) throw failure;
  const seconds = (Date.now() - started) / 1000;
  return steps.map(({ id, step }) => ({ id, kind: "scratch-export", status: statusOf([step]), steps: [step], created, deleted, seconds }));
}

// ---- import -----------------------------------------------------------------------------------------------------------------

/**
 * One import case. The oracle runs every step first (each keeps what it created, the last deletes everything), then the port runs
 * the same steps from the same fresh package folders and deletes what it created; the steps are compared one by one.
 */
export async function runImportCase(env: ParityEnv, c: ImportCase): Promise<CaseReport> {
  const started = Date.now();
  const oracleSteps: RunOutcome[] = [];
  const oracleMadeBefore: string[][] = [];
  const oracleCreated: ItemRef[] = [];
  let deleted: ItemRef[] = [];
  const notes: string[] = [];
  try {
    for (const [i, step] of c.steps.entries()) {
      const last = i === c.steps.length - 1;
      const input = join(env.out, c.id, `input-${i + 1}`);
      writePackages(input, step.packages);
      const { result, out } = await oracleRun(env, `${c.id}/step-${i + 1}`, {
        command: "import",
        inputDir: input,
        params: { ...importHostOptions(step.options, step.only), ...(last ? {} : { KeepCreated: true }), ...(oracleCreated.length === 0 ? {} : { PriorCreated: priorLines(oracleCreated) }) },
      });
      oracleCreated.push(...(result.cleanup?.created ?? []));
      const outcome = readOracleOutcome(out);
      oracleSteps.push(outcome);
      // the new generations of `versionBefore` are made first, before the run, and no answer of the transcript shows them
      oracleMadeBefore.push((result.cleanup?.created ?? []).slice(0, step.options?.versionBefore?.length ?? 0).map((made) => made.id));
      const returned = outcome.termination.kind === "returned" ? outcome.termination.value : null;
      if (!outcomeMatches(expectedOutcome(step, env.engine), { hostExit: result.hostExit, returned, error: result.error })) {
        notes.push(`step ${i + 1} (${step.name}): the oracle ended as ${describeEnd(outcome)}, not as the recorded case says (${expectedOutcome(step, env.engine)}); dev may have changed`);
      }
      if (last) {
        const report = result.cleanup;
        if (report === null || report.kept.length > 0 || report.unverified.length > 0) {
          throw new DevNotClean(`the oracle's cleanup of ${c.id} left items behind`, [...(report?.kept ?? []).map((k) => `${k.type}:${k.id}`), ...(report?.unverified ?? []).map((u) => `${u.type}:${u.id}`)]);
        }
        deleted = report.deleted;
      }
    }
  } catch (error) {
    if (!(error instanceof DevNotClean)) await oracleCleanup(env, c.id, oracleCreated).catch(() => undefined);
    throw error;
  }

  // the port's pass, from fresh copies of the same packages
  const portCreated: CreatedItem[] = [];
  const reports: StepReport[] = [];
  const portSteps: RunOutcome[] = [];
  const portMadeBefore: string[][] = [];
  let portDeleted: ItemRef[] = [];
  try {
    for (const [i, step] of c.steps.entries()) {
      const dir = join(env.out, c.id, `step-${i + 1}`, "port");
      const input = inputDirLikeOracle(env.engine, "import");
      writePackages(input, step.packages);
      let run;
      try {
        run = await runPortImport(
          env.port,
          { inputDir: input, options: step.options ?? {}, ...(step.only === undefined ? {} : { only: step.only }) },
          osUserOf(oracleSteps[i]!.calls),
          join(dir, "work"),
        );
      } finally {
        rmSync(dirname(dirname(input)), { recursive: true, force: true });
      }
      portCreated.push(...run.preRunCreated, ...run.created);
      writePortRun(dir, run.outcome);
      portSteps.push(run.outcome);
      portMadeBefore.push(run.preRunCreated.map((made) => made.id));
      // ids made before step i, by it or by an earlier step's pre-run, are numbered first on each side
      reports.push(
        compare(`step ${i + 1}: ${step.name}`, oracleSteps[i]!, run.outcome, {
          oracle: oracleSteps.slice(0, i),
          port: portSteps.slice(0, i),
          madeBefore: { oracle: oracleMadeBefore.slice(0, i + 1).flat(), port: portMadeBefore.slice(0, i + 1).flat() },
        }),
      );
    }
  } finally {
    portDeleted = await portCleanupAll(env, c.id, portCreated);
    if (portDeleted.length === 0 && portCreated.length > 0) notes.push("the port's cleanup deleted nothing, though its runs created items");
  }
  const status = statusOf(reports);
  return {
    id: c.id,
    kind: "import",
    status,
    steps: reports,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    created: oracleCreated.concat(refs(portCreated)),
    deleted: deleted.concat(portDeleted),
    seconds: (Date.now() - started) / 1000,
  };
}

// ---- language packs ---------------------------------------------------------------------------------------------------------

/** Languages the language-pack cases translate into, and the scratch Forums they edit (`fixtures/14.0.7/language-pack/setup.aml`). */
const LP_LANGUAGES = ["de", "fr"];

/** The Languages of `LP_LANGUAGES` that dev does not have: adding one adds a column to every table with a multilingual property, which the script does not do. */
async function missingLanguages(env: ParityEnv): Promise<string[]> {
  const side = await openSideConnection(env.port);
  try {
    const languages = await side.inn.applyItem('<Item type="Language" action="get" select="code"/>');
    const codes = languages.isError ? [] : languages.items.map((item) => getProperty(item, "code") ?? "");
    return LP_LANGUAGES.filter((code) => !codes.includes(code));
  } finally {
    await side.close();
  }
}

/** Why a seed group cannot run on this dev, or null when it can: the language-resource group (14.35) translates into `de` and `fr`. */
export async function seedGroupPrecondition(env: ParityEnv, group: Pick<SeedGroup, "id">): Promise<string | null> {
  if (group.id !== "lang-ml") return null;
  const missing = await missingLanguages(env);
  return missing.length === 0
    ? null
    : `dev has no Language ${missing.join(", ")}; the language-resource cases translate into them, and adding a Language (fixtures/14.35/language-pack/README.md) adds a column to every table with a multilingual property`;
}

/** Why a language-pack case cannot run on this dev, or null when it can: the cases need the Languages `de` and `fr` and the two scratch Forums. */
export async function languagePackPrecondition(env: ParityEnv): Promise<string | null> {
  const missing = await missingLanguages(env);
  if (missing.length > 0) {
    return `dev has no Language ${missing.join(", ")}; the language-pack cases need them, and adding a Language (fixtures/14.0.7/language-pack/setup.aml) adds a column to every table with a multilingual property`;
  }
  const side = await openSideConnection(env.port);
  try {
    const forums = await side.inn.applyItem('<Item type="Forum" action="get" select="keyed_name"><keyed_name condition="like">LIBSJS-SCRATCH-LP-*</keyed_name></Item>');
    if (forums.isError || forums.items.length < 2) return "dev has not the two scratch Forums LIBSJS-SCRATCH-LP-Forum and LIBSJS-SCRATCH-LP-Forum2 that the language packs translate (setup.aml)";
    return null;
  } finally {
    await side.close();
  }
}

/** One `lpimport` case: the oracle runs it and cleans up after itself, the port runs it and cleans up through its side connection. */
export async function runLanguagePackCase(env: ParityEnv, c: LpCase): Promise<CaseReport> {
  const started = Date.now();
  const why = await languagePackPrecondition(env);
  if (why !== null) return { id: c.id, kind: "language-pack", status: "skipped", steps: [], note: why, created: [], deleted: [], seconds: 0 };
  const pack = join(env.out, c.id, "lp");
  writePack(pack, c);
  const input = join(env.out, c.id, "package");
  mkdirSync(input, { recursive: true });
  const { result, out } = await oracleRun(env, c.id, {
    command: "lpimport",
    inputDir: input,
    lpDir: pack,
    params: { LPPackage: c.lpPackage ?? LP_PACKAGE, ...(c.lpDebug === true ? { LPDebug: true } : {}) },
  });
  const oracle = readOracleOutcome(out, { ...(c.lpDebug === true ? { filesFrom: "temp-package" } : {}) });
  const report = result.cleanup;
  if (report === null || report.kept.length > 0 || report.unverified.length > 0) {
    throw new DevNotClean(`the oracle's cleanup of ${c.id} left items behind`, [...(report?.kept ?? []).map((k) => `${k.type}:${k.id}`), ...(report?.unverified ?? []).map((u) => `${u.type}:${u.id}`)]);
  }
  const dir = join(env.out, c.id, "port");
  const run = await runPortLanguagePack(env.port, { lpDir: pack, lpPackage: c.lpPackage ?? LP_PACKAGE, lpDebug: c.lpDebug === true }, osUserOf(oracle.calls), join(dir, "work"));
  let portDeleted: ItemRef[] = [];
  try {
    writePortRun(dir, run.outcome);
  } finally {
    portDeleted = await portCleanupAll(env, c.id, run.created);
  }
  const step = compare(c.id, oracle, run.outcome);
  return { id: c.id, kind: "language-pack", status: statusOf([step]), steps: [step], created: report.created.concat(refs(run.created)), deleted: report.deleted.concat(portDeleted), seconds: (Date.now() - started) / 1000 };
}

// ---- console export modes ---------------------------------------------------------------------------------------------------

export type ConsoleMode = "all-packages" | "from-manifest" | "use-import";

export interface ConsoleModeCase {
  id: string;
  mode: ConsoleMode;
  title: string;
  /**
   * The manifest the mode reads: `stock` lists stock package names (only their names and paths are read); `scratch` is the package
   * folder of `scratchPackages`, written the way an import reads it; `none` is a mode that reads no manifest.
   */
  manifest: { kind: "stock"; packages: readonly string[] } | { kind: "scratch"; packages: () => ScratchPackage[] } | { kind: "none" };
  /** A scratch import done first (with the oracle, kept) so that the items the mode exports exist; deleted again afterwards. */
  seed?: readonly ImportStep[];
  /** Exports every package of dev (about 10 000 items): run only when asked for by name. */
  slow?: true;
}

/** `imports.mf` for stock packages, as the export writes it (the loops read only the names and paths). */
const stockManifest = (names: readonly string[]): string => `<imports>${names.map((n) => `<package name="${n}" path=".\\"/>`).join("")}</imports>`;

/** One console export mode: the oracle runs ConsoleUpgrade's `ProcessExport` for real, the port builds the table itself. */
export async function runConsoleModeCase(env: ParityEnv, c: ConsoleModeCase): Promise<CaseReport> {
  const started = Date.now();
  const created: ItemRef[] = [];
  let step: StepReport | undefined;
  let failure: unknown;
  let deleted: ItemRef[] = [];
  try {
    if (c.seed !== undefined) await oracleSeed(env, c.id, c.seed, created);
    const input = join(env.out, c.id, "manifest");
    mkdirSync(input, { recursive: true });
    if (c.manifest.kind === "stock") writeFileSync(join(input, "imports.mf"), stockManifest(c.manifest.packages));
    else if (c.manifest.kind === "scratch") writePackages(input, c.manifest.packages());
    const reads = c.manifest.kind !== "none";
    const { out } = await oracleRun(env, c.id, {
      command: "export",
      consoleMode: c.mode,
      params: { Level: "1", RefToUnknownPacks: "DoNotRemove", ...(c.mode === "use-import" ? { UseImport: true } : {}) },
      ...(reads ? { exportInputDir: input, exportManifestName: "imports.mf" } : {}),
    });
    const oracle = readOracleOutcome(out, { filesFrom: "output" });
    const manifestPath = join(input, "imports.mf");
    const port = await runPortExport(env.port, {
      options: { level: "1", refToUnknownPacks: "DoNotRemove", ...(c.mode === "use-import" ? { useImport: true } : {}) },
      ...(reads ? { manifestFile: manifestPath } : {}),
      selection: async (_helper, context, manager): Promise<SelectionTable> => {
        if (c.mode === "use-import") return useImportTable(manifestPath, { engine: env.engine, logFilePath: context.logFilePath });
        if (c.mode === "from-manifest") return fromManifestTable(manager, manifestPath, false);
        return allPackagesTable(manager);
      },
    });
    writePortRun(join(env.out, c.id, "port"), port);
    step = env.engine === "14.35" ? report(c.id, oracle, port, diffExportRuns1435(oracle, port, { packages: [], options: {}, racing: true })) : compare(c.id, oracle, port);
  } catch (error) {
    failure = error;
  } finally {
    deleted = await oracleCleanup(env, c.id, created);
  }
  if (failure !== undefined) throw failure;
  return { id: c.id, kind: "console-mode", status: statusOf([step!]), steps: [step!], created, deleted, seconds: (Date.now() - started) / 1000 };
}

// ---- saving a run ---------------------------------------------------------------------------------------------------------------

/** The port's run in the layout of the oracle's: `transcript.jsonl`, `messages.jsonl`, `engine.log`, `console.txt`, `output/`, `run.json`. */
export function writePortRun(dir: string, outcome: RunOutcome): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "transcript.jsonl"), outcome.calls.map((c, i) => JSON.stringify({ seq: i + 1, action: c.action, request: c.request, response: c.response })).join("\n") + "\n");
  writeFileSync(join(dir, "messages.jsonl"), outcome.messages.map((m) => JSON.stringify(m)).join("\n") + (outcome.messages.length > 0 ? "\n" : ""));
  writeFileSync(join(dir, "engine.log"), outcome.log);
  if (outcome.console !== null) writeFileSync(join(dir, "console.txt"), outcome.console);
  writeFileSync(join(dir, "run.json"), `${JSON.stringify({ side: outcome.side, termination: outcome.termination, exitCode: outcome.exitCode }, null, 2)}\n`);
  if (outcome.files !== null) {
    for (const [path, bytes] of outcome.files) {
      if (path.endsWith("/")) mkdirSync(join(dir, "output", path), { recursive: true });
      else {
        mkdirSync(join(dir, "output", ...path.split("/").slice(0, -1)), { recursive: true });
        writeFileSync(join(dir, "output", ...path.split("/")), bytes);
      }
    }
  }
}

/** Keeps the folders of a case only when it differs or failed: an equal case needs no evidence. */
export function pruneEqual(env: ParityEnv, report: CaseReport): void {
  if (report.status === "equal" || report.status === "skipped") rmSync(join(env.out, report.id), { recursive: true, force: true });
}
