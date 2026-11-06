import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { type Browser, type BrowserContext, type Page, chromium, firefox, webkit } from "playwright";
import { browserBundleOptions, repoRoot } from "../../../tools/browser-bundle.js";
import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import type { ImportOptions } from "../import-cases.js";
import { DBPATCH_DIR, MANIFEST_FILE, PATCH_FILE, TOOL_NAME, assertTestPatch } from "../dbpatch.js";
import { manifestPackageNames } from "../record.js";
import type {
  BrowserConsoleMode,
  BrowserRunRequest,
  BrowserRunResult,
  BrowserServer,
  TreeFiles,
  WireCall,
} from "./browser-page/protocol.js";
import type { Difference } from "./diff.js";
import { type RunOutcome, readTree } from "./outcome.js";
import type { PortServer } from "./port-core.js";
import { type PortImportResult, createdBy, scrubbedOutcome } from "./port-run.js";
import { assertScratchImport, preRun, type CreatedItem } from "./scratch.js";
import { openSideConnection } from "./port-core.js";
import { type RunningProxy, startProxy } from "./proxy.js";

/**
 * The browser as the third runtime of the parity run (HOST-277). The driver is Node's: it builds the harness page (`browser-page/`:
 * the engine of `src/browser.ts`'s graph in a Worker, over a `MemoryVfs` and the `fetch` transport), starts one origin that serves it
 * and, by default, proxies the server (`proxy.ts`), launches Chromium, Firefox or WebKit with Playwright, and runs each case's step in
 * the page. What comes back (the calls, the output tree, the log, the messages, the console text, the ending) becomes a `RunOutcome`
 * that the existing diff compares with the oracle's and the Node port's.
 *
 * The server's address, database, user and password reach the page in one argument of one `page.evaluate`, built here from the
 * values the caller read from the environment. They are never in a URL, a file or the page's source, and the outcome is scrubbed
 * as the Node port's outcome is before anything is kept (`scrubbedOutcome`).
 *
 * @spec HOST-277
 */

export type BrowserName = "chromium" | "firefox" | "webkit";
export const BROWSERS: readonly BrowserName[] = ["chromium", "firefox", "webkit"];

/** How the page reaches the server: through the runner's same-origin proxy, or straight, from a server already configured for the page's origin (HOST-277). */
export type BrowserCors = "proxy" | "server";
export const BROWSER_CORS: readonly BrowserCors[] = ["proxy", "server"];

export interface BrowserRuntimeOptions {
  browser: BrowserName;
  cors: BrowserCors;
  /** The server as this machine reaches it (a lease's URL, or a test server's): the proxy forwards to it, or the page calls it. */
  target: string;
  /** Where Playwright's browsers are searched is Playwright's own business (`PLAYWRIGHT_BROWSERS_PATH`). */
  log?: (line: string) => void;
}

export type Runtime = "node" | "browser";

/** What `--runtime`, `--browser` and `--browser-cors` of the parity script mean (HOST-277). */
export type RuntimeChoice = { runtime: "node" } | { runtime: "browser"; browser: BrowserName; cors: BrowserCors };

/**
 * Reads the three options of the script. `node` is the default and runs as it always did; `browser` adds the page as a third side, in
 * Chromium unless `--browser` says another, through the proxy unless `--browser-cors=server` says the server is already configured to answer CORS. The
 * two browser options mean nothing without `--runtime browser`, and a value that is not one of the choices is refused with the choices.
 */
export function parseRuntimeOptions(values: { runtime?: string | undefined; browser?: string | undefined; "browser-cors"?: string | undefined }): RuntimeChoice {
  const runtime = values.runtime ?? "node";
  if (runtime !== "node" && runtime !== "browser") throw new Error(`unknown runtime '${runtime}' (node, browser)`);
  if (runtime === "node") {
    if (values.browser !== undefined || values["browser-cors"] !== undefined) throw new Error("--browser and --browser-cors need --runtime browser");
    return { runtime };
  }
  const browser = values.browser ?? "chromium";
  if (!(BROWSERS as readonly string[]).includes(browser)) throw new Error(`unknown browser '${browser}' (${BROWSERS.join(", ")})`);
  const cors = values["browser-cors"] ?? "proxy";
  if (!(BROWSER_CORS as readonly string[]).includes(cors)) throw new Error(`unknown --browser-cors '${cors}' (${BROWSER_CORS.join(", ")})`);
  return { runtime, browser: browser as BrowserName, cors: cors as BrowserCors };
}

const PAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "browser-page");
const launchers = { chromium, firefox, webkit };

declare const window: { __parity: { run(request: BrowserRunRequest): Promise<BrowserRunResult> } };

/** Builds the page and its Worker into a fresh folder: two esbuild bundles of the browser graph and the page's HTML. */
export async function buildPage(into: string): Promise<void> {
  for (const [entry, out] of [["page.ts", "page.js"], ["worker.ts", "worker.js"]] as const) {
    await build({
      ...browserBundleOptions(repoRoot, `oracle/src/parity/browser-page/${entry}`),
      outfile: join(into, out),
      sourcemap: false,
    });
  }
  copyFileSync(join(PAGE_DIR, "index.html"), join(into, "index.html"));
}

/** A running browser with the harness page open. */
export class BrowserRuntime {
  private constructor(
    readonly options: BrowserRuntimeOptions,
    private readonly proxy: RunningProxy,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly dir: string,
    /** The browser's own name and version, for the report. */
    readonly version: string,
  ) {}

  static async start(options: BrowserRuntimeOptions): Promise<BrowserRuntime> {
    const dir = mkdtempSync(join(tmpdir(), "libsjs-parity-page-"));
    let proxy: RunningProxy | undefined;
    let browser: Browser | undefined;
    try {
      await buildPage(dir);
      proxy = await startProxy({ target: options.target, staticRoot: dir });
      browser = await launchers[options.browser].launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on("pageerror", (error) => options.log?.(`page error: ${error.message}`));
      await page.goto(proxy.pageUrl);
      await page.waitForFunction(() => "__parity" in window);
      return new BrowserRuntime(options, proxy, browser, context, page, dir, `${options.browser} ${browser.version()}`);
    } catch (error) {
      await browser?.close().catch(() => undefined);
      await proxy?.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /** The address the page's Worker calls for the server: the proxy's, or the server itself. */
  get serverUrl(): string {
    return this.options.cors === "proxy" ? this.proxy.url : this.options.target;
  }

  /** The page's own origin: in `proxy` mode, the only one its transport may call. */
  get pageOrigin(): string {
    return this.proxy.origin;
  }

  /** What a page keeps after a run: its URL, its cookies and its storage, as text (HOST-277). */
  async kept(): Promise<string> {
    const session = await this.page.evaluate<string>("JSON.stringify(sessionStorage)");
    return JSON.stringify({ url: this.page.url(), storage: await this.context.storageState(), session });
  }

  /** How many requests the proxy forwarded (0 in `server` mode). */
  get forwarded(): number {
    return this.proxy.forwarded();
  }

  /** The server of a run as the page gets it. The password is part of the request and of nothing else. */
  serverOf(server: PortServer): BrowserServer {
    return { engine: server.engine, url: this.serverUrl, logUrl: server.logUrl, database: server.database, userName: server.userName, password: server.password };
  }

  /** Runs one request in the page's Worker. The request is the one-shot argument of the call. */
  run(request: BrowserRunRequest): Promise<BrowserRunResult> {
    return this.page.evaluate((one) => window.__parity.run(one), request);
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
    await this.proxy.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------------------------- disk and tree

/** A folder of the disk as the files of a tree, below `root` (a folder with no file is a path ending in `/`). */
export function treeFromDisk(dir: string, root: string): TreeFiles {
  return [...readTree(dir)].map(([path, bytes]) => [`${root}/${path}`, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length)] as [string, Uint8Array]);
}

/** The path of the input folder in the Worker's tree: a path as long as `length`, below the root, ending in `/input` (12.0's log depends on its length, IMP-406). */
export function paddedInputDir(length: number): string {
  const pad = length - "//input".length;
  return pad < 1 ? "/input" : `/${"p".repeat(pad)}/input`;
}

/** The page's result as a `RunOutcome`, scrubbed as the Node port's is (`scrubbedOutcome`), so that the three sides compare. */
export function outcomeOf(result: BrowserRunResult, password: string): RunOutcome {
  return scrubbedOutcome(
    {
      side: "browser",
      calls: result.calls,
      files: result.files === null ? null : new Map(result.files.map(([path, bytes]) => [path, Buffer.from(bytes)] as const)),
      log: result.log,
      messages: result.messages,
      console: result.console,
      termination: result.termination,
      exitCode: result.exitCode,
    },
    password,
  );
}

// ------------------------------------------------------------------------------------------------------------------- wire check

/**
 * What the engine says it sent against what the page's transport sent (HOST-277): each call's request, in order, must be the body of a
 * SOAP request on the wire with its action. A request the engine repeated (a renewed token, a changed digest, WIRE-012) is on the wire
 * more than once, so a wire request may be passed over, but a call with none left to match is a difference: the page would have
 * recorded a request it did not send. The engine's record keeps the white space before the root element, which the wire does not carry,
 * so the two are compared trimmed.
 */
export function wireDifferences(calls: readonly { action: string; request: string }[], wire: readonly WireCall[]): Difference[] {
  const out: Difference[] = [];
  let at = 0;
  for (const [index, call] of calls.entries()) {
    let found = -1;
    for (let i = at; i < wire.length; i++) {
      const sent = wire[i] as WireCall;
      if (sent.action === call.action && sent.body.trim() === call.request.trim()) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      out.push({ area: "wire", summary: `call ${index + 1} (${call.action}) is not the body of a request that the transport sent`, oracle: call.request, port: wire[at]?.body ?? "(no more requests on the wire)", labels: { oracle: "engine", port: "wire" } });
      if (out.length >= 3) break;
      continue;
    }
    at = found + 1;
  }
  return out;
}

/** In `proxy` mode the whole run, the login's discovery included, stays on the page's origin; another origin in the list is a difference. */
export function originDifferences(origins: readonly string[], pageOrigin: string): Difference[] {
  return origins
    .filter((origin) => origin !== pageOrigin)
    .map((origin) => ({ area: "wire", summary: `the page called ${origin}, not its own origin`, oracle: pageOrigin, port: origin, labels: { oracle: "page", port: "called" } }));
}

// ---------------------------------------------------------------------------------------------------------------------- runs

export interface BrowserExportRun {
  options: ExportCaseOptions;
  packages?: readonly ExportCasePackage[];
  /** A console mode and the folder of the disk that holds `imports.mf` (or a package folder) it reads. */
  console?: { mode: BrowserConsoleMode; manifestDir?: string };
}

/** What a browser run gives with the outcome: the wire's differences. */
export interface BrowserOutcome {
  outcome: RunOutcome;
  wire: Difference[];
}

function finish(runtime: BrowserRuntime, result: BrowserRunResult, password: string): BrowserOutcome {
  const strays = runtime.options.cors === "proxy" ? originDifferences(result.origins, runtime.pageOrigin) : [];
  return { outcome: outcomeOf(result, password), wire: [...wireDifferences(result.calls, result.wire), ...strays] };
}

const MANIFEST_DIR = "/work/manifest";

/** One export in the page, as `runPortExport` runs it on Node. */
export async function runBrowserExport(runtime: BrowserRuntime, server: PortServer, run: BrowserExportRun): Promise<BrowserOutcome> {
  const result = await runtime.run({
    kind: "export",
    server: runtime.serverOf(server),
    options: run.options,
    ...(run.packages === undefined ? {} : { packages: [...run.packages] }),
    ...(run.console === undefined
      ? {}
      : { console: { mode: run.console.mode, ...(run.console.manifestDir === undefined ? {} : { manifestPath: `${MANIFEST_DIR}/imports.mf` }) } }),
    files: run.console?.manifestDir === undefined ? [] : treeFromDisk(run.console.manifestDir, MANIFEST_DIR),
  });
  return finish(runtime, result, server.password);
}

export interface BrowserImportStep {
  /** The folder of the disk with `imports.mf` and the package folders. */
  inputDir: string;
  /** Where it goes in the Worker's tree (`paddedInputDir`). */
  treeDir: string;
  options: ImportOptions;
  only?: readonly string[];
}

/**
 * One import in the page, as `runPortImport` runs it: the package folder is checked to be scratch first, and the pre-run steps (locked
 * upgrade rows, new generations) go through a connection of Node's own, as they do there.
 */
export async function runBrowserImport(
  runtime: BrowserRuntime,
  server: PortServer,
  step: BrowserImportStep,
  osUser: string,
): Promise<PortImportResult & BrowserOutcome & { preRunCreated: CreatedItem[] }> {
  const options = step.options;
  const names = step.only === undefined ? manifestPackageNames(readFileSync(join(step.inputDir, "imports.mf"), "utf8")) : [...step.only];
  assertScratchImport(names, step.inputDir);
  let preRunCreated: CreatedItem[] = [];
  if (options.lockUpgradeRows === true || (options.versionBefore?.length ?? 0) > 0) {
    const side = await openSideConnection(server);
    try {
      preRunCreated = await preRun(side.inn, {
        ...(options.lockUpgradeRows === true ? { lockRowsOf: names } : {}),
        ...(options.versionBefore === undefined ? {} : { versionBefore: options.versionBefore }),
      });
    } finally {
      await side.close();
    }
  }
  const result = await runtime.run({
    kind: "import",
    server: runtime.serverOf(server),
    options,
    inputDir: step.treeDir,
    files: treeFromDisk(step.inputDir, step.treeDir),
    ...(step.only === undefined ? {} : { only: [...step.only] }),
    osUser,
  });
  const done = finish(runtime, result, server.password);
  return { ...done, created: createdBy(done.outcome.calls), preRunCreated };
}

export interface BrowserLanguagePack {
  /** The language pack folder of the disk, with `ImportConfig.xml` and `xml/`. */
  lpDir: string;
  lpPackage: string;
  lpDebug: boolean;
  languages?: readonly string[];
}

/** One `lpimport` in the page, as `runPortLanguagePack` runs it. */
export async function runBrowserLanguagePack(runtime: BrowserRuntime, server: PortServer, run: BrowserLanguagePack, osUser: string): Promise<PortImportResult & BrowserOutcome> {
  assertScratchImport([run.lpPackage], run.lpDir, run.lpDir);
  const result = await runtime.run({
    kind: "language-pack",
    server: runtime.serverOf(server),
    lpDir: "/work/lp",
    lpPackage: run.lpPackage,
    lpDebug: run.lpDebug,
    ...(run.languages === undefined ? {} : { languages: [...run.languages] }),
    files: treeFromDisk(run.lpDir, "/work/lp"),
    osUser,
  });
  const done = finish(runtime, result, server.password);
  return { ...done, created: createdBy(done.outcome.calls) };
}

/** One `ApplyDBUpdateManifest` in the page: only the committed no-op patch (DBP-071), checked as the oracle's runs check it. */
export async function runBrowserDbPatch(runtime: BrowserRuntime, server: PortServer, osUser: string): Promise<BrowserOutcome> {
  const committed = assertTestPatch(join(DBPATCH_DIR, MANIFEST_FILE), DBPATCH_DIR, TOOL_NAME);
  const input = "/work/input";
  const files: TreeFiles = [
    [`${input}/${MANIFEST_FILE}`, new Uint8Array(readFileSync(committed.manifest))],
    [`${input}/${PATCH_FILE}`, new Uint8Array(readFileSync(join(committed.folder, PATCH_FILE)))],
  ];
  const result = await runtime.run({ kind: "db-patch", server: runtime.serverOf(server), inputDir: input, manifestName: MANIFEST_FILE, toolName: TOOL_NAME, files, osUser });
  return finish(runtime, result, server.password);
}
