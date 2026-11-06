import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_ENGINE, isEngine, type Engine } from "../../../src/engines.js";
import { casesFor } from "../import-cases.js";
import { ORACLE_DIR } from "../manifest.js";
import { assertLiveTarget, windowsUrl } from "../live-targets.js";
import { DEV_SERVER } from "../record.js";
import { readPassword } from "../cli.js";
import { DBPATCH_CASES } from "../record-dbpatch-cases.js";
import { CONSOLE_MODE_CASES, PARITY_ENGINES, catalogue, exportCasesOf, seedGroupsOf, duplicateIds, languagePackCases, type CatalogueEntry, type ParityKind } from "./cases.js";
import { BrowserRuntime, parseRuntimeOptions, type RuntimeChoice } from "./browser-runner.js";
import { describeDifferences } from "./diff.js";
import { KNOWN_DIFFERENCES } from "./known.js";
import { openSideConnection, type PortServer } from "./port-run.js";
import {
  type CaseReport,
  CaseFailure,
  DevNotClean,
  type ParityEnv,
  pruneEqual,
  runConsoleModeCase,
  runDbPatchCase,
  runImportCase,
  runLanguagePackCase,
  runPlainExport,
  runSeedGroup,
  seedGroupPrecondition,
} from "./runners.js";

/** The address WSL reaches the dev instance at; the oracle's Windows side calls the same server `localhost`. */
const WSL_DEV_URL = "http://172.19.0.1/12sp9";

const USAGE = `Usage: npm run parity -- [--engine 12.0|14.0.7|14.35] [--case <id>,<id>...] [--kind <kind>,...] [--include-slow] [--list]
                           [--out <folder>] [--keep-all] [--url <url>]
                           [--runtime node|browser] [--browser chromium|firefox|webkit] [--browser-cors proxy|server] [--browser-page-port <port>]

Runs the oracle (the vendored Libs.dll through the Windows host) and the port on the same inputs against the dev instance, or
an arashouse lease, and diffs, for each case:
  - the request AML, in order (login included; the envelope and headers are not recorded);
  - the output folder, byte for byte;
  - the engine log, after the date-times, the run's own paths and the ids the server assigned are normalised;
  - the messages, by channel, and the console text;
  - how the run ended: the value ImportSolutions returned, or the exception.

Engine 14.35 exports the items of a package in parallel, so its export runs agree in the parts EXP-558 names
(oracle/src/parity/diff-1435.ts) and not request for request. Its dbpatch kind applies the committed no-op test patch (oracle/dbpatch/,
DBP-070) as root, applies it again, and as admin; the oracle's DB patch cleanup deletes the three items each side made.

Kinds: export (read-only), scratch-export (seeds LIBSJS-SCRATCH-* packages, exports, deletes them), import (LIBSJS-SCRATCH-*
copies, deleted again by each side), language-pack (needs the Languages de and fr on dev; skipped otherwise), console-mode
(--use-import, --from-manifest, --all-packages), dbpatch (14.35 only). A case marked slow runs only when named with --case or with --include-slow.
Imports use LIBSJS-SCRATCH-* packages and items only; each side deletes what it created, and the ids are in the report.

--runtime browser (HOST-279) adds the browser as a third side. Each step of each case also runs in a headless browser (the engine of
the browser build, in a Worker, over a tree in memory and the fetch transport; Playwright's Chromium unless --browser names another), and
its request AML, output tree, log, messages, console text and ending are compared with the oracle's and with the Node port's by the same
diff. --browser-cors proxy (the default) puts a same-origin reverse proxy in front of the server, and keeps the login chain on its origin;
--browser-cors server has the page call the server directly, and needs --browser-page-port <port>: the lease must already be configured for
the page's origin, http://127.0.0.1:<port> exactly (allowedCorsOrigins and the rest of roadmap/browser-cors-poc.md, section 3); the runner does not configure it. The server's address, database, user and password reach the page in one argument of one call, never in a URL,
a file or the page's source. --list needs no server and no browser.

The server is --url, else ARAS_URL, else the dev instance (${WSL_DEV_URL}), as WSL reaches it, and its database is ARAS_DATABASE
(default ${DEV_SERVER.database}); the oracle's Windows side reaches the same path at localhost. Anything but the dev instance or a lease
that \`arashouse status --json\` shows as leased is refused, so \`arashouse run --lease <id> -- npm run parity -- ...\` runs on a lease.
The password comes from ARAS_PASSWORD or stdin, as for \`npm run oracle\`; the user from ARAS_USER (default root).
--out keeps the folders of every case that differs or failed (default oracle/out/parity-<engine>-<time>); --keep-all keeps the
equal ones too. Exit status: 0 every case equal or skipped, 1 a difference or a failed case, 3 dev was left unclean.
`;

const KINDS: readonly ParityKind[] = ["export", "scratch-export", "import", "language-pack", "console-mode", "dbpatch"];

/** The scratch packages and packages a run starts from: nothing named `LIBSJS-SCRATCH-*` may exist on the server (dev, or a lease). */
export async function assertNoScratchLeft(server: PortServer): Promise<void> {
  const side = await openSideConnection(server);
  try {
    for (const [type, property] of [["PackageDefinition", "name"], ["DatabaseUpgrade", "name"]] as const) {
      const found = await side.inn.applyItem(`<Item type="${type}" action="get" select="id,${property}"><${property} condition="like">LIBSJS-SCRATCH-*</${property}></Item>`);
      if (!found.isError && found.items.length > 0) {
        throw new CaseFailure(`the server already has ${found.items.length} ${type} item(s) named LIBSJS-SCRATCH-*: an earlier run left them. On a lease, return it and take a new one. On the dev instance, delete the run's LIBSJS-SCRATCH-* and LIBSJS_SCRATCH_* items by hand (a browser crash leaves no record of them); only an oracle run kept with --keep-created has a record, for \`npm run oracle -- cleanup --from-runs <run.json>\`.`);
      }
    }
  } finally {
    await side.close();
  }
}

function printCase(report: CaseReport, write: (text: string) => void): void {
  const tag = { equal: "ok       ", different: "DIFFERENT", known: "known    ", skipped: "skipped  ", failed: "FAILED   " }[report.status];
  write(`${tag} ${report.id} (${report.kind}, ${report.seconds.toFixed(1)} s${report.steps.length === 0 ? "" : `, ${report.steps.map((s) => `${s.oracleCalls}/${s.portCalls}${s.browserCalls === undefined ? "" : `/${s.browserCalls}`} calls`).join(" + ")}`})\n`);
  if (report.note !== undefined) write(`    ${report.note}\n`);
  for (const step of report.steps) {
    if (step.differences.length === 0) continue;
    write(`  ${step.name}: oracle ${step.oracleEnd}; port ${step.portEnd}${step.browserEnd === undefined ? "" : `; browser ${step.browserEnd}`}\n`);
    write(`${describeDifferences(step.differences).join("\n")}\n`);
  }
  if (report.created.length > 0) {
    write(`    created ${report.created.length} item(s); deleted ${report.deleted.length}\n`);
  }
}

function selectEntries(engine: Engine, values: { case?: string | undefined; kind?: string | undefined; "include-slow"?: boolean | undefined }): CatalogueEntry[] {
  const all = catalogue(engine);
  const dup = duplicateIds(all);
  if (dup.length > 0) throw new Error(`the catalogue has duplicate ids: ${dup.join(", ")}`);
  const kinds = values.kind === undefined ? null : new Set(values.kind.split(",").map((s) => s.trim()));
  if (kinds !== null) {
    const unknown = [...kinds].filter((k) => !(KINDS as readonly string[]).includes(k));
    if (unknown.length > 0) throw new Error(`unknown kind: ${unknown.join(", ")} (${KINDS.join(", ")})`);
  }
  const named = values.case === undefined ? null : new Set(values.case.split(",").map((s) => s.trim()).filter((s) => s !== ""));
  if (named !== null) {
    const unknown = [...named].filter((id) => !all.some((e) => e.id === id));
    if (unknown.length > 0) throw new Error(`unknown case: ${unknown.join(", ")} (--list shows them)`);
  }
  return all.filter((e) => (kinds === null || kinds.has(e.kind)) && (named === null ? values["include-slow"] === true || e.slow !== true : named.has(e.id)));
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        engine: { type: "string" },
        case: { type: "string" },
        kind: { type: "string" },
        "include-slow": { type: "boolean" },
        list: { type: "boolean" },
        out: { type: "string" },
        "keep-all": { type: "boolean" },
        url: { type: "string" },
        runtime: { type: "string" },
        browser: { type: "string" },
        "browser-cors": { type: "string" },
        "browser-page-port": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    });
  } catch (error) {
    process.stderr.write(`parity: ${(error as Error).message}\n\n${USAGE}`);
    return 64;
  }
  const { values } = parsed;
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }
  const engineValue = values.engine ?? DEFAULT_ENGINE;
  if (!isEngine(engineValue) || !PARITY_ENGINES.includes(engineValue)) {
    process.stderr.write(`parity: engine '${engineValue}' is not supported yet (${PARITY_ENGINES.join(", ")})\n`);
    return 64;
  }
  const engine: Engine = engineValue;
  let choice: RuntimeChoice;
  try {
    choice = parseRuntimeOptions(values);
  } catch (error) {
    process.stderr.write(`parity: ${(error as Error).message}\n`);
    return 64;
  }
  let entries: CatalogueEntry[];
  try {
    entries = selectEntries(engine, values);
  } catch (error) {
    process.stderr.write(`parity: ${(error as Error).message}\n`);
    return 64;
  }
  if (values.list === true) {
    for (const e of entries) process.stdout.write(`${e.kind.padEnd(14)} ${e.id}${e.slow === true ? "  (slow)" : ""}\n`);
    return 0;
  }
  if (entries.length === 0) {
    process.stderr.write("parity: no case selected\n");
    return 64;
  }

  const portUrl = values.url ?? process.env.ARAS_URL ?? WSL_DEV_URL;
  const database = process.env.ARAS_DATABASE ?? DEV_SERVER.database;
  let password: string;
  try {
    await assertLiveTarget(portUrl, database);
    password = readPassword();
  } catch (error) {
    process.stderr.write(`parity: ${(error as Error).message}\n`);
    return 64;
  }
  const user = process.env.ARAS_USER ?? "root";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const out = resolve(values.out ?? join(ORACLE_DIR, "out", `parity-${engine}-${stamp}`));
  mkdirSync(out, { recursive: true });
  const oracleUrl = windowsUrl(portUrl);
  let browser: BrowserRuntime | undefined;
  const write = (text: string) => process.stdout.write(text);
  const port: PortServer = { engine, url: portUrl, logUrl: oracleUrl, database, userName: user, password };
  const env: ParityEnv = {
    engine,
    user,
    password,
    oracleUrl,
    database,
    port,
    out,
    log: (line) => process.stderr.write(`${line}\n`),
  };
  if (choice.runtime === "browser") {
    try {
      browser = await BrowserRuntime.start({ browser: choice.browser, cors: choice.cors, ...(choice.cors === "server" ? { pagePort: choice.pagePort } : {}), target: portUrl, log: env.log });
    } catch (error) {
      process.stderr.write(`parity: cannot start the browser: ${(error as Error).message}\n`);
      return 64;
    }
    env.browser = browser;
    write(`parity: browser runtime: ${browser.version}, CORS through ${choice.cors}, page at ${browser.pageOrigin}\n`);
  }

  const reports: CaseReport[] = [];
  const settle = (report: CaseReport) => {
    const known = KNOWN_DIFFERENCES[report.id];
    if (known !== undefined && report.status === "different") {
      report.status = "known";
      report.note = `known difference: ${known.reason}\n    ${known.followUp}`;
    } else if (known !== undefined && report.status === "equal") {
      report.note = "listed in known.ts but now equal: remove the entry";
    }
    reports.push(report);
    printCase(report, write);
    if (values["keep-all"] !== true) pruneEqual(env, report);
  };
  const failed = (id: string, kind: string, error: unknown) =>
    settle({ id, kind, status: "failed", steps: [], note: error instanceof Error ? error.message : String(error), created: [], deleted: [], seconds: 0 });
  const chosen = (kind: ParityKind) => entries.filter((e) => e.kind === kind);

  let exitCode = 0;
  try {
    await assertNoScratchLeft(port);
    write(`parity ${engine}: ${entries.length} case(s), folders in ${out}\n`);

    for (const entry of chosen("export")) {
      const c = exportCasesOf(engine).find((x) => x.id === entry.id)!;
      try {
        settle(await runPlainExport(env, c));
      } catch (error) {
        if (error instanceof DevNotClean) throw error;
        failed(c.id, "export", error);
      }
    }

    const scratchIds = new Set(chosen("scratch-export").map((e) => e.id));
    for (const group of seedGroupsOf(engine)) {
      const wanted = new Set(group.cases.filter((c) => scratchIds.has(c.id)).map((c) => c.id));
      if (wanted.size === 0) continue;
      try {
        const why = await seedGroupPrecondition(env, group);
        if (why !== null) {
          for (const c of group.cases.filter((x) => wanted.has(x.id))) {
            settle({ id: c.id, kind: "scratch-export", status: "skipped", steps: [], note: why, created: [], deleted: [], seconds: 0 });
          }
          continue;
        }
        for (const report of await runSeedGroup(env, group, wanted)) settle(report);
      } catch (error) {
        if (error instanceof DevNotClean) throw error;
        for (const id of wanted) failed(id, "scratch-export", error);
      }
    }

    for (const entry of chosen("import")) {
      const c = casesFor(engine).find((x) => x.id === entry.id)!;
      try {
        settle(await runImportCase(env, c));
      } catch (error) {
        if (error instanceof DevNotClean) throw error;
        failed(c.id, "import", error);
      }
    }

    for (const entry of chosen("language-pack")) {
      const c = languagePackCases(engine).find((x) => x.id === entry.id)!;
      try {
        settle(await runLanguagePackCase(env, c));
      } catch (error) {
        if (error instanceof DevNotClean) throw error;
        failed(c.id, "language-pack", error);
      }
    }

    for (const entry of chosen("dbpatch")) {
      const c = DBPATCH_CASES.find((x) => `dbpatch-${x.id}` === entry.id)!;
      try {
        settle({ ...(await runDbPatchCase(env, c)), id: entry.id });
      } catch (error) {
        if (error instanceof DevNotClean) throw error;
        failed(entry.id, "dbpatch", error);
      }
    }

    for (const entry of chosen("console-mode")) {
      const c = CONSOLE_MODE_CASES.find((x) => x.id === entry.id)!;
      try {
        settle(await runConsoleModeCase(env, c));
      } catch (error) {
        if (error instanceof DevNotClean) throw error;
        failed(c.id, "console-mode", error);
      }
    }
  } catch (error) {
    if (error instanceof DevNotClean) {
      process.stderr.write(`\nparity: DEV IS NOT CLEAN. ${error.message}:\n  ${error.left.join("\n  ")}\nNothing more was run.\n`);
      exitCode = 3;
    } else {
      process.stderr.write(`parity: ${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 1;
    }
  }

  await browser?.close();
  const count = (status: string) => reports.filter((r) => r.status === status).length;
  write(`\n${reports.length} case(s): ${count("equal")} equal, ${count("different")} different, ${count("known")} known, ${count("failed")} failed, ${count("skipped")} skipped\n`);
  const created = reports.flatMap((r) => r.created);
  const deleted = reports.flatMap((r) => r.deleted);
  write(`dev items created by the runs: ${created.length}; deleted by their cleanups: ${deleted.length}\n`);
  writeFileSync(join(out, "report.json"), `${JSON.stringify({ engine, startedAt: stamp, runtime: choice.runtime === "browser" ? { ...choice, version: browser?.version, proxied: browser?.forwarded } : choice, reports }, null, 2)}\n`);
  write(`report: ${join(out, "report.json")}\n`);
  if (exitCode === 0 && (count("different") > 0 || count("failed") > 0)) exitCode = 1;
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

