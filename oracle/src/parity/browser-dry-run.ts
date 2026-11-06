import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startWireServer, type ScenarioCreated, type WireServer } from "../../../src/browser/test-server.js";
import type { Engine } from "../../../src/engines.js";
import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import type { ImportOptions } from "../import-cases.js";
import { type BrowserCors, type BrowserOutcome, type BrowserName, BrowserRuntime, paddedInputDir, runBrowserExport, runBrowserImport, runBrowserLanguagePack } from "./browser-runner.js";
import { type Difference, diffOutcomes, relabelDifferences } from "./diff.js";
import { type RunOutcome, readOracleOutcome } from "./outcome.js";
import { type PortServer, osUserOf, selectionOf } from "./port-core.js";
import { runPortExport, runPortImport, runPortLanguagePack } from "./port-run.js";

/**
 * A dry run of the browser parity pipeline (HOST-277), with no lease: one recorded export case is served over HTTP by the browser
 * tests' server (`src/browser/test-server.ts`, HOST-234), and the oracle's side is the recording itself. The Node port and the page's
 * Worker each run the case against their own scenario of that server and the three outcomes go through the same normalisation and
 * diff that a live run uses (`diffOutcomes`, the wire check, the relabelling). A recorded case found equal here is known to be found
 * equal by the live run, and a difference of the browser would show as one.
 *
 * It reads no credential: the password of the run is a test value.
 *
 * @spec HOST-277
 */

const FIXTURES = fileURLToPath(new URL("../../../fixtures", import.meta.url));

/** The calls a login makes before the engine's own: the test server's, so the comparison starts after them. */
export const LOGIN_CALLS: Record<Engine, number> = { "12.0": 5, "14.0.7": 6, "14.35": 6 };

export interface DryRunOptions {
  engine: Engine;
  /** A folder of `fixtures/<engine>/export/`. */
  caseName: string;
  browser: BrowserName;
  /** How the page reaches the test server: through the runner's proxy (default) or itself, the server answering CORS. */
  cors?: BrowserCors;
  /** Serves another recorded case than the one compared with, so that the comparison must find a difference (a check of the check). */
  serve?: string;
  /** An already started server; one is started (and closed) otherwise. */
  server?: WireServer;
  log?: (line: string) => void;
}

export interface DryRunReport {
  engine: Engine;
  caseName: string;
  browser: string;
  /** The Node port against the recording, the browser against the recording, and the browser against the Node port. */
  nodeAgainstOracle: Difference[];
  browserAgainstOracle: Difference[];
  browserAgainstNode: Difference[];
  /** The page's own check that what the engine says it sent is what the transport sent. */
  wire: Difference[];
  calls: { oracle: number; node: number; browser: number };
}

/** The report has no difference in any part. */
export const isClean = (report: DryRunReport): boolean =>
  [report.nodeAgainstOracle, report.browserAgainstOracle, report.browserAgainstNode, report.wire].every((part) => part.length === 0);

async function scenario(server: WireServer, engine: Engine, recorded: { name: string; kind?: "import" | "language-pack"; step?: number }): Promise<ScenarioCreated> {
  const answer = await fetch(`${server.origin}/__control/scenarios`, { method: "POST", body: JSON.stringify({ engine, recorded }) });
  return (await answer.json()) as ScenarioCreated;
}

/** Git keeps no empty folder, so a committed recording cannot hold the ones a live run leaves. */
const withoutFolders = <T extends { files: Map<string, Buffer> | null }>(outcome: T): T => ({
  ...outcome,
  files: outcome.files === null ? null : new Map([...outcome.files].filter(([path]) => !path.endsWith("/"))),
});

/** What differs between one family of recordings and another: where the recording is, and how each side runs it. */
interface DryCase {
  engine: Engine;
  caseName: string;
  /** The folder of the recording the oracle's side is read from. */
  dir: string;
  blobs: string;
  filesFrom?: string;
  /** The recorded case the test server serves (`serve` of the options replaces its name). */
  recorded: { name: string; kind?: "import" | "language-pack"; step?: number };
  node(server: PortServer, oracle: RunOutcome): Promise<RunOutcome>;
  browser(runtime: BrowserRuntime, server: PortServer, oracle: RunOutcome): Promise<BrowserOutcome>;
}

async function dry(options: DryRunOptions, c: DryCase): Promise<DryRunReport> {
  const { engine, caseName } = c;
  const run = JSON.parse(readFileSync(join(c.dir, "run.json"), "utf8")) as { params: { Url: string; Database: string; User: string } };
  const oracle = withoutFolders(readOracleOutcome(c.dir, { ...(c.filesFrom === undefined ? {} : { filesFrom: c.filesFrom }), blobs: c.blobs }));
  // the recording's server was 12.0 SP9; the test server presents the version of the engine's own flavour, and writes it in the log header
  oracle.log = oracle.log.replace(/^(Innovator version: ).*$/m, `$1${engine === "12.0" ? "12.0 SP9 Build 24090" : engine === "14.35" ? "14.35.9.36073" : "14.0.9.36073"}`);
  const server = options.server ?? (await startWireServer());
  let runtime: BrowserRuntime | undefined;
  try {
    const serverOf = (created: ScenarioCreated): PortServer => ({
      engine,
      url: created.url,
      logUrl: run.params.Url,
      database: run.params.Database,
      userName: run.params.User,
      password: "not-a-real-password",
    });
    const served = { ...c.recorded, name: options.serve ?? c.recorded.name };
    const forNode = serverOf(await scenario(server, engine, served));
    const forBrowser = serverOf(await scenario(server, engine, served));
    const node = withoutFolders(await c.node(forNode, oracle));
    // through the proxy the page and the server are one origin; with `server` the page is in another, and the test server's CORS answers are a real server's
    runtime = await BrowserRuntime.start({ browser: options.browser, cors: options.cors ?? "proxy", target: forBrowser.url, ...(options.log === undefined ? {} : { log: options.log }) });
    const ran = await c.browser(runtime, forBrowser, oracle);
    const browser = withoutFolders(ran.outcome);
    const skipCalls = LOGIN_CALLS[engine];
    return {
      engine,
      caseName,
      browser: runtime.version,
      nodeAgainstOracle: relabelDifferences(diffOutcomes(oracle, node, { skipCalls }), "oracle", "node"),
      browserAgainstOracle: relabelDifferences(diffOutcomes(oracle, browser, { skipCalls }), "oracle", "browser"),
      browserAgainstNode: relabelDifferences(diffOutcomes(node, browser, { skipCalls }), "node", "browser"),
      wire: ran.wire,
      calls: { oracle: oracle.calls.length, node: node.calls.length, browser: browser.calls.length },
    };
  } finally {
    await runtime?.close();
    if (options.server === undefined) await server.close();
  }
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** One recorded export case (`fixtures/<engine>/export/<case>`). */
export function dryRunExport(options: DryRunOptions): Promise<DryRunReport> {
  const { engine, caseName } = options;
  const dir = join(FIXTURES, engine, "export", caseName);
  const input = readJson<{ packages: ExportCasePackage[]; options: ExportCaseOptions }>(join(dir, "case.json"));
  return dry(options, {
    engine,
    caseName,
    dir,
    blobs: join(FIXTURES, engine, "export", "_blobs"),
    filesFrom: "output",
    recorded: { name: caseName },
    node: (server) => runPortExport(server, { selection: selectionOf(input.packages), options: input.options }),
    browser: (runtime, server) => runBrowserExport(runtime, server, { options: input.options, packages: input.packages }),
  });
}

/** One step of a recorded import case (`fixtures/<engine>/import/<case>/step-<n>`). */
export function dryRunImport(options: DryRunOptions & { step?: number }): Promise<DryRunReport> {
  const { engine, caseName } = options;
  const step = options.step ?? 1;
  const dir = join(FIXTURES, engine, "import", caseName, `step-${step}`);
  const definition = readJson<{ steps: Array<{ options: ImportOptions; only?: string[] }> }>(join(FIXTURES, engine, "import", caseName, "case.json")).steps[step - 1]!;
  const inputDir = join(dir, "input");
  const only = definition.only === undefined ? {} : { only: definition.only };
  return dry(options, {
    engine,
    caseName: `${caseName} step ${step}`,
    dir,
    blobs: join(FIXTURES, engine, "import", "_blobs"),
    recorded: { name: caseName, kind: "import", step },
    node: async (server, oracle) => (await runPortImport(server, { inputDir, options: definition.options, ...only }, osUserOf(oracle.calls))).outcome,
    browser: (runtime, server, oracle) => runBrowserImport(runtime, server, { inputDir, treeDir: paddedInputDir(96), options: definition.options, ...only }, osUserOf(oracle.calls)),
  });
}

/** One recorded language-pack run (`fixtures/<engine>/language-pack/<case>`). */
export function dryRunLanguagePack(options: DryRunOptions): Promise<DryRunReport> {
  const { engine, caseName } = options;
  const dir = join(FIXTURES, engine, "language-pack", caseName);
  const definition = readJson<{ lpPackage: string; lpDebug: boolean }>(join(dir, "case.json"));
  const pack = { lpDir: join(dir, "lp"), lpPackage: definition.lpPackage, lpDebug: definition.lpDebug };
  return dry(options, {
    engine,
    caseName,
    dir,
    blobs: join(FIXTURES, engine, "language-pack", "_blobs"),
    ...(definition.lpDebug ? { filesFrom: "temp-package" } : {}),
    recorded: { name: caseName, kind: "language-pack" },
    node: async (server, oracle) => (await runPortLanguagePack(server, pack, osUserOf(oracle.calls))).outcome,
    browser: (runtime, server, oracle) => runBrowserLanguagePack(runtime, server, pack, osUserOf(oracle.calls)),
  });
}
