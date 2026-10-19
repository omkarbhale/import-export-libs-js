import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import type { Engine } from "../engines.js";
import { SUExportContext } from "../export/export-context.js";
import type { SelectionTable } from "../export/import-export-manager.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { USE_IMPORT_ENGINES, allPackagesTable, fromManifestTable, useImportTable } from "./console-modes.js";

/**
 * The export-modes probe (oracle/export-modes-probe, fixtures/export-modes/<engine>-probe.json) replayed: the real engines'
 * `GenerateHashtableFromManifest` and ConsoleUpgrade's `ProcessExport` loops, run on the inputs recorded in the fixture, against the
 * port. A table is compared in the order a .NET `Hashtable` enumerates it, package by package and item by item.
 */

interface Described {
  name: string;
  count: number;
  digest: string;
  items?: string[];
}

interface Scenario {
  kind: "generate" | "console";
  useImport?: boolean;
  returned?: "null" | "table";
  thrown?: { type: string; message: string };
  constructorThrown?: { type: string; message: string };
  table?: Described[];
  log?: string;
  requests?: number;
  messages?: Array<{ channel: string; text: string }>;
  input: {
    solutions: string | null;
    manifest: unknown;
    path?: { raw?: string | null; manifest?: true };
  };
}

interface Probe {
  engine: Engine;
  solutionSets: Record<string, string>;
  scenarios: Record<string, Scenario>;
}

const BLOB = "fixtures/14.0.7/export/_blobs/316a9c3d9a9560ddfc841f6a2eeac8ee1be992500fd4610f8a50458e38cb7910.xml";
const blobInner = /<Result>([\s\S]*)<\/Result>/.exec(readFileSync(BLOB, "utf8"))?.[1] as string;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NAMESPACES: Record<string, string> = {
  ArgumentException: "System",
  ArgumentNullException: "System",
  NullReferenceException: "System",
  IOException: "System.IO",
  FileNotFoundException: "System.IO",
  DirectoryNotFoundException: "System.IO",
  XmlException: "System.Xml",
  XPathException: "System.Xml.XPath",
  CItemException: "Aras.Tools.SolutionUpgrade",
};

/** The scenario's folders as `<DIR>`, and the separators of the paths that follow as the engine writes them (`\`). */
function scrub(text: string, dirs: string[]): string {
  let out = text;
  for (const dir of dirs) out = out.split(dir).join("<DIR>").split(dir.replace(/\//g, "\\")).join("<DIR>");
  return out.replace(/<DIR>[^'\s]*/g, (path) => path.replace(/\//g, "\\"));
}

/** The .NET type name of an error the port raises, and its message with the scenario's folder as `<DIR>` and `\` as the separator. */
function describeError(error: unknown, dirs: string[]): { type: string; message: string } {
  const name = (error as Error).name;
  return { type: `${NAMESPACES[name] ?? "?"}.${name}`, message: scrub((error as Error).message, dirs) };
}

function describeTable(table: SelectionTable): Described[] {
  const total = [...table.values()].reduce((sum, inner) => sum + inner.count, 0);
  return [...table.entries()].map(([name, inner]) => {
    const lines = [...inner.entries()].map(([key, item]) => `${key}|${item.idName ?? ""}|${item.typeName ?? ""}|${item.keyedName ?? ""}`);
    const digest = createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
    return { name, count: lines.length, digest, ...(total <= 400 ? { items: lines } : {}) };
  });
}

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

interface Run {
  table?: Described[];
  returned?: "null" | "table";
  thrown?: { type: string; message: string };
  constructorThrown?: { type: string; message: string };
  log?: string;
  requests: number;
  messages: Array<{ channel: string; text: string }>;
}

async function playScenario(probe: Probe, scenario: Scenario): Promise<Run> {
  const work = mkdtempSync(join(tmpdir(), "libsjs-modes-"));
  roots.push(work);
  const engine = probe.engine;
  const solutions = scenario.input.solutions === null ? null : scenario.input.solutions === "blob" ? blobInner : (probe.solutionSets[scenario.input.solutions] as string);
  const connection = new StubConnection((request) => {
    if (!request.startsWith('<Item type="PackageDefinition" select="name,generation"')) return stubFault("0", "No items found.");
    return solutions === null ? stubFault("0", "No items of type PackageDefinition found.") : stubResult(solutions);
  });
  const helper = new CItemHelper(connection, { engine });
  const sent: SentMessage[] = [];
  const logPath = join(work, "engine.log");
  const context = new SUExportContext();
  Object.assign(context, { url: "http://stub/", dataBase: "db", userName: "u", workingDirectory: join(work, "out"), logFilePath: logPath });

  const environment: { cwd: string; platform?: NodeJS.Platform } = { cwd: work };
  let dirs = [work];
  let manifestPath: string;
  if (scenario.kind === "generate") {
    manifestPath = join(work, "imports.mf");
    const manifest = scenario.input.manifest as { text?: string; directory?: true };
    if (manifest.directory) mkdirSync(manifestPath);
    else if (manifest.text !== undefined) writeFileSync(manifestPath, manifest.text);
    if (scenario.input.path && "raw" in scenario.input.path) {
      manifestPath = scenario.input.path.raw as string;
      if (manifestPath?.includes("|")) {
        environment.platform = "win32";
        environment.cwd = "C:\\work";
      }
    }
  } else if (scenario.input.manifest === "empty") {
    manifestPath = "";
  } else {
    const given = scenario.input.manifest as { absent?: string; fixtureInput?: string; files?: Record<string, string>; name?: string };
    if (given.absent !== undefined) manifestPath = join(work, given.absent);
    else if (given.fixtureInput !== undefined) {
      const folder = join("fixtures", engine, "import", given.fixtureInput);
      manifestPath = join(folder, given.name as string);
      dirs = [folder, work];
    } else {
      writeFiles(work, given.files as Record<string, string>);
      manifestPath = join(work, given.name as string);
    }
  }
  if (scenario.kind === "console") context.manifestFile = manifestPath;

  const record: Run = { requests: 0, messages: [] };
  const finish = (): Run => {
    record.requests = connection.requests.length;
    record.messages = sent.map(({ channel, text }) => ({ channel, text }));
    if (existsSync(logPath)) {
      record.log = scrub(readFileSync(logPath, "utf8"), dirs);
    }
    return record;
  };

  let manager: ImportExportManager;
  try {
    manager = new ImportExportManager(context, createMessagesFactory({ onMessage: (message) => void sent.push(message) }), helper, environment);
  } catch (error) {
    record.constructorThrown = describeError(error, dirs);
    return finish();
  }
  try {
    if (scenario.kind === "generate") {
      const table = await manager.generateHashtableFromManifest(manifestPath);
      record.returned = table === null ? "null" : "table";
      if (table !== null) record.table = describeTable(table);
    } else if (scenario.useImport === true) {
      record.table = describeTable(useImportTable(manifestPath, { engine, logFilePath: logPath, ...environment }));
    } else {
      record.table = describeTable(await fromManifestTable(manager, manifestPath, true));
    }
  } catch (error) {
    record.thrown = describeError(error, dirs);
  }
  return finish();
}

/** `--use-import` loads package folders, which the CLI offers for 12.0 and 14.0.7 so far (HOST-113). */
const WAITS_FOR_LOADING = (engine: Engine, name: string): boolean => name.startsWith("ui-") && !USE_IMPORT_ENGINES.includes(engine);

for (const engine of ["12.0", "14.0.7", "14.35"] as const) {
  const probe = JSON.parse(readFileSync(`fixtures/export-modes/${engine}-probe.json`, "utf8")) as Probe;
  describe(`the console export modes against the ${engine} probe (EXP-700 to EXP-704, HOST-110 to HOST-121)`, () => {
    it("is the probe of this engine", () => {
      expect(probe.engine).toBe(engine);
      expect(Object.keys(probe.scenarios).length).toBeGreaterThan(80);
    });
    for (const [name, scenario] of Object.entries(probe.scenarios)) {
      const run = WAITS_FOR_LOADING(engine, name) ? it.skip : it;
      run(name, async () => {
        const played = await playScenario(probe, scenario);
        expect(played.constructorThrown).toEqual(scenario.constructorThrown);
        expect(played.thrown).toEqual(scenario.thrown);
        expect(played.returned).toEqual(scenario.returned);
        expect(played.table).toEqual(scenario.table);
        expect(played.log).toEqual(scenario.log);
        if (scenario.constructorThrown === undefined) {
          expect(played.messages).toEqual(scenario.messages);
          if (scenario.kind === "generate") expect(played.requests).toBe(scenario.requests);
        }
      });
    }
  });
}

describe("allPackagesTable (HOST-121)", () => {
  it("is exported for the CLI", () => {
    expect(typeof allPackagesTable).toBe("function");
  });
});
