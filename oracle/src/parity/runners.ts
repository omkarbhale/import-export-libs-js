import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allPackagesTable, fromManifestTable, useImportTable } from "../../../src/cli/console-modes.js";
import type { SelectionTable } from "../../../src/export/import-export-manager.js";
import type { Engine } from "../../../src/engines.js";
import { hostItems, hostOptions as exportHostOptions, type ExportCase } from "../export-cases.js";
import { resolveCase, type SeedGroup } from "../export-scratch-cases.js";
import { hostOptions as importHostOptions, expectedOutcome, type ImportCase, type ImportStep } from "../import-cases.js";
import { writePackages, type ScratchPackage } from "../import-packages.js";
import { LP_PACKAGE, writePack, type LpCase } from "../language-pack-cases.js";
import { outcomeMatches, returnedValue } from "../record-import-cases.js";
import { DBPATCH_DIR, MANIFEST_FILE, TOOL_NAME } from "../dbpatch.js";
import type { DbPatchCase } from "../record-dbpatch-cases.js";
import { oracleWindowsRoot } from "../stage.js";
import { winJoin } from "../windows.js";
import { record, runId, type CleanupReport, type ItemRef, type RecordRequest, type RecordResult } from "../record.js";
import { type Difference, diffOutcomes, relabelDifferences } from "./diff.js";
import { diffExportRuns1435 } from "./diff-1435.js";
import { getProperty } from "../../../src/client/fault.js";
import { dbPatchIds } from "./normalize.js";
import { type RunOutcome, readOracleOutcome } from "./outcome.js";
import {
  type BrowserOutcome,
  BrowserRunCrashed,
  type BrowserRuntime,
  paddedInputDir,
  runBrowserDbPatch,
  runBrowserExport,
  runBrowserImport,
  runBrowserLanguagePack,
} from "./browser-runner.js";
import { type PortServer, assertPatchAbsent, createdBy, dbPatchCreated, openSideConnection, osUserOf, runPortDbPatch, runPortExport, runPortImport, runPortLanguagePack, selectionOf } from "./port-run.js";
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
  /** The browser as a third runtime (`--runtime browser`, HOST-279): each step also runs in a page, and is compared with both of the others. */
  browser?: BrowserRuntime;
  /** Where the seconds each port spent running the engine add up; the page's includes the crossing of its files and results. */
  timing?: SideSeconds;
}

/** The seconds the Node port and the browser spent on the engine's runs (not the oracle's, the cleanups or the comparison). */
export interface SideSeconds {
  node: number;
  browser: number;
}

/** Runs one side's engine run and adds its time to `env.timing`, also when it fails. */
export async function timed<T>(env: Pick<ParityEnv, "timing">, side: keyof SideSeconds, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    if (env.timing !== undefined) env.timing[side] += (performance.now() - started) / 1000;
  }
}

/** One compared run: an export, one import step, or one language-pack import. */
export interface StepReport {
  name: string;
  differences: Difference[];
  oracleCalls: number;
  portCalls: number;
  oracleEnd: string;
  portEnd: string;
  /** With the browser runtime: the calls of the page's run and how it ended. */
  browserCalls?: number;
  browserEnd?: string;
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
  /** With the browser runtime: what the engine's runs of this case took on each side. A seed group's cases share one count, on its first case. */
  sideSeconds?: SideSeconds;
}

const describeEnd = (outcome: RunOutcome): string =>
  outcome.termination.kind === "exception"
    ? `exception ${outcome.termination.summary.split("\n")[0]}`
    : outcome.termination.kind === "returned"
      ? `returned ${outcome.termination.value}`
      : outcome.termination.kind === "applied"
        ? "applied"
        : "exported";

/** The length of the path of the oracle's `input` folder, which the port's package folder is made as long as (IMP-406). */
export function oracleInputLength(engine: Engine, command: string): number {
  return winJoin(oracleWindowsRoot(), "runs", runId(engine, command), "input").length;
}

/** The path of the browser's package folder in the Worker's tree: as long as the oracle's `input` folder, for the same reason (HOST-279). */
export function browserInputDir(engine: Engine): string {
  return paddedInputDir(oracleInputLength(engine, "import"));
}

/**
 * A fresh folder for the port's package files whose path is as long as the oracle's `input/` folder (`…\\oracle\\runs\\<run id>\\input`).
 * A path reaches the engine's package log (the warning for a file without a root tag), and 12.0 reads the in-memory log only up to
 * `1024 × ⌊(N − 1) / 1024⌋` UTF-16 code units (IMP-406): a path of another length would move the cut, a difference of the harness
 * and not of the engine. The caller removes `root`, the folder made for it, when the step is done.
 */
export function inputDirLikeOracle(engine: Engine, command: string, base = tmpdir()): { input: string; root: string } {
  const target = oracleInputLength(engine, command);
  const root = mkdtempSync(join(base, "libsjs-parity-in-"));
  const pad = target - root.length - "//input".length;
  const input = pad < 1 ? join(root, "input") : join(root, "p".repeat(pad), "input");
  mkdirSync(input, { recursive: true });
  return { input, root };
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

/**
 * The page's step, compared with the oracle's and with the Node port's (HOST-279) and added to the step the first two made: a
 * difference between the browser and the Node port is a difference of the browser's host, and one against the oracle is a difference of
 * the engine; the page's own wire check is added too. `same` is the comparison the case's kind uses, called with the left side first.
 */
export function withBrowser(
  step: StepReport,
  oracle: RunOutcome,
  port: RunOutcome,
  browser: BrowserOutcome,
  same: (left: RunOutcome, right: RunOutcome) => Difference[],
): StepReport {
  return {
    ...step,
    differences: [
      ...step.differences,
      ...relabelDifferences(same(oracle, browser.outcome), "oracle", "browser"),
      ...relabelDifferences(same(port, browser.outcome), "node", "browser"),
      ...browser.wire,
    ],
    browserCalls: browser.outcome.calls.length,
    browserEnd: describeEnd(browser.outcome),
  };
}

/** The comparison of one step of a run of several: the earlier steps' calls and the ids made before it are numbered first on each side. */
const sameAfter =
  (earlierLeft: readonly RunOutcome[], earlierRight: readonly RunOutcome[], madeLeft: readonly string[], madeRight: readonly string[]) =>
  (left: RunOutcome, right: RunOutcome): Difference[] =>
    diffOutcomes(left, right, {
      earlier: { oracle: earlierLeft.flatMap((o) => o.calls), port: earlierRight.flatMap((o) => o.calls) },
      madeBefore: { oracle: madeLeft, port: madeRight },
    });

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
  const port = await timed(env, "node", () => runPortExport(env.port, { selection: selectionOf(c.packages), options }));
  writePortRun(join(env.out, label, "port"), port);
  // 14.35 exports the items of a package in parallel: its runs agree in the parts EXP-558 names
  const same = (left: RunOutcome, right: RunOutcome): Difference[] =>
    env.engine === "14.35" ? diffExportRuns1435(left, right, { packages: c.packages, options }) : diffOutcomes(left, right);
  const step = env.engine === "14.35" ? report(label, oracle, port, same(oracle, port)) : compare(label, oracle, port);
  if (env.browser === undefined) return step;
  const page = env.browser;
  const browser = await timed(env, "browser", () => runBrowserExport(page, env.port, { options, packages: c.packages }));
  writePortRun(join(env.out, label, "browser"), browser.outcome);
  return withBrowser(step, oracle, port, browser, same);
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
  const why = await importCasePrecondition(env, c);
  if (why !== null) return { id: c.id, kind: "import", status: "skipped", steps: [], note: why, created: [], deleted: [], seconds: 0 };
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
      const { input, root } = inputDirLikeOracle(env.engine, "import");
      writePackages(input, step.packages);
      let run;
      try {
        run = await timed(env, "node", () =>
          runPortImport(
            env.port,
            { inputDir: input, options: step.options ?? {}, ...(step.only === undefined ? {} : { only: step.only }) },
            osUserOf(oracleSteps[i]!.calls),
            join(dir, "work"),
          ),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
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

  // the browser's pass, from fresh copies of the same packages, cleaned up like the port's
  const browserCreated: CreatedItem[] = [];
  let browserDeleted: ItemRef[] = [];
  let crashed = false;
  if (env.browser !== undefined) {
    const browserSteps: RunOutcome[] = [];
    const browserMadeBefore: string[][] = [];
    try {
      for (const [i, step] of c.steps.entries()) {
        const dir = join(env.out, c.id, `step-${i + 1}`, "browser");
        const root = mkdtempSync(join(tmpdir(), "libsjs-parity-browser-in-"));
        let run;
        try {
          writePackages(root, step.packages);
          const page = env.browser;
          run = await timed(env, "browser", () =>
            runBrowserImport(
              page,
              env.port,
              { inputDir: root, treeDir: browserInputDir(env.engine), options: step.options ?? {}, ...(step.only === undefined ? {} : { only: step.only }) },
              osUserOf(oracleSteps[i]!.calls),
            ),
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
        browserCreated.push(...run.preRunCreated, ...run.created);
        writePortRun(dir, run.outcome);
        browserSteps.push(run.outcome);
        browserMadeBefore.push(run.preRunCreated.map((made) => made.id));
        const upTo = i + 1;
        const madeBy = (made: readonly string[][]): string[] => made.slice(0, upTo).flat();
        const step1 = reports[i]!;
        // the oracle's and the port's steps are compared with the page's by the same rule: earlier steps numbered first on each side
        reports[i] = {
          ...step1,
          differences: [
            ...step1.differences,
            ...relabelDifferences(sameAfter(oracleSteps.slice(0, i), browserSteps.slice(0, i), madeBy(oracleMadeBefore), madeBy(browserMadeBefore))(oracleSteps[i]!, run.outcome), "oracle", "browser"),
            ...relabelDifferences(sameAfter(portSteps.slice(0, i), browserSteps.slice(0, i), madeBy(portMadeBefore), madeBy(browserMadeBefore))(portSteps[i]!, run.outcome), "node", "browser"),
            ...run.wire,
          ],
          browserCalls: run.outcome.calls.length,
          browserEnd: describeEnd(run.outcome),
        };
      }
    } catch (error) {
      if (!(error instanceof BrowserRunCrashed)) throw error;
      crashed = true;
      browserCreated.push(...error.preRunCreated);
      notes.push(error.message);
    } finally {
      browserDeleted = await portCleanupAll(env, `${c.id}-browser`, browserCreated);
      if (browserDeleted.length === 0 && browserCreated.length > 0) notes.push("the cleanup of the browser's items deleted nothing, though its runs created items");
    }
  }
  const status = crashed ? "failed" : statusOf(reports);
  return {
    id: c.id,
    kind: "import",
    status,
    steps: reports,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    created: oracleCreated.concat(refs(portCreated), refs(browserCreated)),
    deleted: deleted.concat(portDeleted, browserDeleted),
    seconds: (Date.now() - started) / 1000,
  };
}

// ---- language packs ---------------------------------------------------------------------------------------------------------

/** Languages the language-pack cases translate into, and the scratch Forums they edit (`fixtures/14.0.7/language-pack/setup.aml`). */
const LP_LANGUAGES = ["de", "fr"];

/** The codes of the Languages dev has. */
async function installedLanguages(env: ParityEnv): Promise<string[]> {
  const side = await openSideConnection(env.port);
  try {
    const languages = await side.inn.applyItem('<Item type="Language" action="get" select="code"/>');
    return languages.isError ? [] : languages.items.map((item) => getProperty(item, "code") ?? "");
  } finally {
    await side.close();
  }
}

/** The Languages of `LP_LANGUAGES` that dev does not have: adding one adds a column to every table with a multilingual property, which the script does not do. */
async function missingLanguages(env: ParityEnv): Promise<string[]> {
  const codes = await installedLanguages(env);
  return LP_LANGUAGES.filter((code) => !codes.includes(code));
}

/**
 * Why an import case cannot give its recorded result on this dev, or null when it can: a case lists the Languages dev must have
 * (`devLanguages`), and its result depends on the whole set (`Languages = *` over a package that uses de is refused when de is not installed).
 */
export async function importCasePrecondition(env: ParityEnv, c: Pick<ImportCase, "devLanguages">): Promise<string | null> {
  if (c.devLanguages === undefined) return null;
  const have = new Set(await installedLanguages(env));
  const want = new Set(c.devLanguages);
  if (have.size === want.size && [...want].every((code) => have.has(code))) return null;
  return `the case needs the Languages ${[...want].join(", ")} on dev and dev has ${[...have].join(", ")}; the script never adds or removes a Language (it adds or drops a column of every table with a multilingual property)`;
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
    params: { LPPackage: c.lpPackage ?? LP_PACKAGE, ...(c.lpDebug === true ? { LPDebug: true } : {}), ...(c.languages === undefined ? {} : { Languages: [...c.languages] }) },
  });
  const oracle = readOracleOutcome(out, { ...(c.lpDebug === true ? { filesFrom: "temp-package" } : {}) });
  const report = result.cleanup;
  if (report === null || report.kept.length > 0 || report.unverified.length > 0) {
    throw new DevNotClean(`the oracle's cleanup of ${c.id} left items behind`, [...(report?.kept ?? []).map((k) => `${k.type}:${k.id}`), ...(report?.unverified ?? []).map((u) => `${u.type}:${u.id}`)]);
  }
  const dir = join(env.out, c.id, "port");
  const run = await timed(env, "node", () => runPortLanguagePack(env.port, { lpDir: pack, lpPackage: c.lpPackage ?? LP_PACKAGE, lpDebug: c.lpDebug === true, ...(c.languages === undefined ? {} : { languages: c.languages }) }, osUserOf(oracle.calls), join(dir, "work")));
  let portDeleted: ItemRef[] = [];
  try {
    writePortRun(dir, run.outcome);
  } finally {
    portDeleted = await portCleanupAll(env, c.id, run.created);
  }
  let step = compare(c.id, oracle, run.outcome);
  let browserCreated: CreatedItem[] = [];
  let browserDeleted: ItemRef[] = [];
  if (env.browser !== undefined) {
    const browserDir = join(env.out, c.id, "browser");
    try {
      const page = env.browser;
      const browser = await timed(env, "browser", () =>
        runBrowserLanguagePack(
          page,
          env.port,
          { lpDir: pack, lpPackage: c.lpPackage ?? LP_PACKAGE, lpDebug: c.lpDebug === true, ...(c.languages === undefined ? {} : { languages: c.languages }) },
          osUserOf(oracle.calls),
        ),
      );
      browserCreated = browser.created;
      writePortRun(browserDir, browser.outcome);
      step = withBrowser(step, oracle, run.outcome, browser, (left, right) => diffOutcomes(left, right));
    } finally {
      browserDeleted = await portCleanupAll(env, `${c.id}-browser`, browserCreated);
    }
  }
  return {
    id: c.id,
    kind: "language-pack",
    status: statusOf([step]),
    steps: [step],
    created: report.created.concat(refs(run.created), refs(browserCreated)),
    deleted: report.deleted.concat(portDeleted, browserDeleted),
    seconds: (Date.now() - started) / 1000,
  };
}

// ---- DB patch (14.35) -------------------------------------------------------------------------------------------------------

/**
 * One DB patch case: the committed no-op patch applied as each step's login (DBP-070, DBP-071). The oracle runs every step first
 * (each keeps what it created, the last deletes all of it), then the port runs the same steps and the oracle's `cleanup` command, in
 * its DB patch mode, deletes what the port created: it deletes an item only when it matches the test patch. The ids the runs make up
 * are numbered, not compared (the engine gives the `id` of the items it adds, and the server the "Applied Updates" item's).
 */
export async function runDbPatchCase(env: ParityEnv, c: DbPatchCase): Promise<CaseReport> {
  const started = Date.now();
  const dbpatch = { manifest: join(DBPATCH_DIR, MANIFEST_FILE), folder: DBPATCH_DIR, toolName: TOOL_NAME };
  const as = (user: string): ParityEnv => ({ ...env, user, port: { ...env.port, userName: user } });
  const oracleSteps: RunOutcome[] = [];
  const oracleCreated: ItemRef[] = [];
  let deleted: ItemRef[] = [];
  const notes: string[] = [];
  try {
    for (const [i, step] of c.steps.entries()) {
      const last = i === c.steps.length - 1;
      const { result, out } = await oracleRun(as(step.user), `${c.id}/step-${i + 1}`, {
        command: "dbpatch",
        dbpatch,
        params: { ...(last ? {} : { KeepCreated: true }), ...(oracleCreated.length === 0 ? {} : { PriorCreated: priorLines(oracleCreated) }) },
      });
      oracleCreated.push(...(result.cleanup?.created ?? []));
      const outcome = readOracleOutcome(out);
      oracleSteps.push(outcome);
      const errors = outcome.messages.filter((m) => m.channel === "error").length;
      const ended = step.expect.kind === "applied" ? outcome.termination.kind === "applied" && errors === 0 : step.expect.kind === "patch-failed" ? errors === 1 : outcome.termination.kind === "exception";
      if (!ended) notes.push(`step ${i + 1} (${step.name}): the oracle ended as ${describeEnd(outcome)}, not as the recorded case says (${step.expect.kind}); dev may have changed`);
      if (last) {
        const report = result.cleanup;
        if (report === null || report.kept.length > 0 || report.unverified.length > 0) {
          throw new DevNotClean(`the oracle's cleanup of ${c.id} left items behind`, [...(report?.kept ?? []).map((k) => `${k.type}:${k.id}`), ...(report?.unverified ?? []).map((u) => `${u.type}:${u.id}`)]);
        }
        deleted = report.deleted;
      }
    }
  } catch (error) {
    if (!(error instanceof DevNotClean)) await oracleDbPatchCleanup(env, c.id, oracleCreated).catch(() => undefined);
    throw error;
  }

  // the port's pass
  const portCreated: ItemRef[] = [];
  const portSteps: RunOutcome[] = [];
  const reports: StepReport[] = [];
  let portDeleted: ItemRef[] = [];
  try {
    for (const [i, step] of c.steps.entries()) {
      const dir = join(env.out, c.id, `step-${i + 1}`, "port");
      const run = await timed(env, "node", () => runPortDbPatch(as(step.user).port, { preconditions: i === 0 }, osUserOf(oracleSteps[i]!.calls), join(dir, "work")));
      portCreated.push(...refs(run.created));
      writePortRun(dir, run.outcome);
      portSteps.push(run.outcome);
      reports.push(
        compare(`step ${i + 1}: ${step.name}`, oracleSteps[i]!, run.outcome, {
          oracle: oracleSteps.slice(0, i),
          port: portSteps.slice(0, i),
          madeBefore: { oracle: dbPatchIds(oracleSteps.slice(0, i + 1).flatMap((o) => o.calls)), port: dbPatchIds(portSteps.flatMap((o) => o.calls)) },
        }),
      );
    }
  } finally {
    portDeleted = await oracleDbPatchCleanup(env, `${c.id}-port`, portCreated);
    if (portDeleted.length === 0 && portCreated.length > 0) notes.push("the cleanup of the port's items deleted nothing, though its runs created items");
  }
  // the browser's pass: the same steps in the page, then the same cleanup of what it made
  const browserCreated: ItemRef[] = [];
  let browserDeleted: ItemRef[] = [];
  if (env.browser !== undefined) {
    const browserSteps: RunOutcome[] = [];
    try {
      for (const [i, step] of c.steps.entries()) {
        const dir = join(env.out, c.id, `step-${i + 1}`, "browser");
        if (i === 0) await assertPatchAbsent(as(step.user).port);
        const page = env.browser;
        const run = await timed(env, "browser", () => runBrowserDbPatch(page, as(step.user).port, osUserOf(oracleSteps[i]!.calls)));
        browserCreated.push(...refs(dbPatchCreated(run.outcome.calls)));
        writePortRun(dir, run.outcome);
        browserSteps.push(run.outcome);
        const step1 = reports[i]!;
        reports[i] = {
          ...step1,
          differences: [
            ...step1.differences,
            ...relabelDifferences(
              sameAfter(oracleSteps.slice(0, i), browserSteps.slice(0, i), dbPatchIds(oracleSteps.slice(0, i + 1).flatMap((o) => o.calls)), dbPatchIds(browserSteps.flatMap((o) => o.calls)))(oracleSteps[i]!, run.outcome),
              "oracle",
              "browser",
            ),
            ...relabelDifferences(
              sameAfter(portSteps.slice(0, i), browserSteps.slice(0, i), dbPatchIds(portSteps.slice(0, i + 1).flatMap((o) => o.calls)), dbPatchIds(browserSteps.flatMap((o) => o.calls)))(portSteps[i]!, run.outcome),
              "node",
              "browser",
            ),
            ...run.wire,
          ],
          browserCalls: run.outcome.calls.length,
          browserEnd: describeEnd(run.outcome),
        };
      }
    } finally {
      browserDeleted = await oracleDbPatchCleanup(env, `${c.id}-browser`, browserCreated);
      if (browserDeleted.length === 0 && browserCreated.length > 0) notes.push("the cleanup of the browser's items deleted nothing, though its runs created items");
    }
  }
  return {
    id: c.id,
    kind: "dbpatch",
    status: statusOf(reports),
    steps: reports,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    created: oracleCreated.concat(portCreated, browserCreated),
    deleted: deleted.concat(portDeleted, browserDeleted),
    seconds: (Date.now() - started) / 1000,
  };
}

/** The oracle's `cleanup` in its DB patch mode: it deletes an item only when it matches the test patch, and reads back that nothing of the release or the number is left. */
async function oracleDbPatchCleanup(env: ParityEnv, label: string, created: readonly ItemRef[]): Promise<ItemRef[]> {
  if (created.length === 0) return [];
  const { result } = await oracleRun(env, `${label}-cleanup`, { command: "cleanup", params: { PriorCreated: priorLines(created), DbPatchCleanup: true } });
  const report = result.cleanup;
  const left = [...(report?.kept ?? []).map((k) => `${k.type}:${k.id} (${k.reason})`), ...(report?.unverified ?? []).map((u) => `${u.type}:${u.id} (unverified)`)];
  if (report === null || left.length > 0) throw new DevNotClean(`the DB patch cleanup of ${label} left items behind`, left.length > 0 ? left : created.map((c) => `${c.type}:${c.id}`));
  return report.deleted;
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
    const port = await timed(env, "node", () =>
      runPortExport(env.port, {
        options: { level: "1", refToUnknownPacks: "DoNotRemove", ...(c.mode === "use-import" ? { useImport: true } : {}) },
        ...(reads ? { manifestFile: manifestPath } : {}),
        selection: async (_helper, context, manager): Promise<SelectionTable> => {
          if (c.mode === "use-import") return useImportTable(manifestPath, { engine: env.engine, logFilePath: context.logFilePath });
          if (c.mode === "from-manifest") return fromManifestTable(manager, manifestPath, false);
          return allPackagesTable(manager);
        },
      }),
    );
    writePortRun(join(env.out, c.id, "port"), port);
    const same = (left: RunOutcome, right: RunOutcome): Difference[] =>
      env.engine === "14.35" ? diffExportRuns1435(left, right, { packages: [], options: {}, racing: true }) : diffOutcomes(left, right);
    step = env.engine === "14.35" ? report(c.id, oracle, port, same(oracle, port)) : compare(c.id, oracle, port);
    if (env.browser !== undefined) {
      const page = env.browser;
      const browser = await timed(env, "browser", () =>
        runBrowserExport(page, env.port, {
          options: { level: "1", refToUnknownPacks: "DoNotRemove", ...(c.mode === "use-import" ? { useImport: true } : {}) },
          console: { mode: c.mode, ...(reads ? { manifestDir: input } : {}) },
        }),
      );
      writePortRun(join(env.out, c.id, "browser"), browser.outcome);
      step = withBrowser(step, oracle, port, browser, same);
    }
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
