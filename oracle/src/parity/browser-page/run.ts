import { allPackagesTable, fromManifestTable, useImportTable } from "../../../../src/cli/console-modes.js";
import type { HttpTransport } from "../../../../src/client/transport.js";
import { DBUpdateConfig } from "../../../../src/db-patches/index.js";
import { SolutionUpgradeContext } from "../../../../src/export/export-context.js";
import { ImportExportManager, type SelectionTable } from "../../../../src/export/import-export-manager.js";
import { createMessagesFactory } from "../../../../src/export/messages.js";
import { MemoryVfs } from "../../../../src/host/memory-fs.js";
import type { HostFs } from "../../../../src/host/types.js";
import { SUImportContext } from "../../../../src/import/import-context.js";
import { exceptionText } from "../../../../src/language-pack/exception-text.js";
import { languagePackImport } from "../../../../src/language-pack/lp-import.js";
import { createBrowserHost } from "../../../../src/browser/host.js";
import { createFetchTransport } from "../../../../src/browser/fetch-transport.js";
import type { CallRecord, Termination } from "../outcome.js";
import {
  ORACLE_HOST_CULTURE,
  type PortServer,
  baseContext,
  collectors,
  exportContextFor,
  openSession,
  selectionOf,
  termination,
} from "../port-core.js";
import type {
  BrowserRunRequest,
  BrowserRunResult,
  BrowserServer,
  DbPatchRunRequest,
  ExportRunRequest,
  ImportRunRequest,
  LanguagePackRunRequest,
  TreeFiles,
  WireCall,
} from "./protocol.js";

/**
 * The browser's counterpart of `port-run.ts` (HOST-279): the same host sequence as the oracle's and the Node port's (the contexts of
 * `port-core.ts`, the manager, the selection), but over a {@link MemoryVfs} and the browser host, with the engine's calls going out
 * through the `fetch` transport, in a Worker. Each function takes the files of the run as a list, runs, and gives back what the Node
 * driver turns into a `RunOutcome`: the calls the engine made, the output tree, the log, the messages, the console text and how it
 * ended.
 *
 * @spec HOST-279
 */

const WORK = "/work";
const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

/** A tree that holds the request's files, and the working folder. */
function treeOf(files: TreeFiles): MemoryVfs {
  const vfs = new MemoryVfs();
  vfs.mount({ [`${WORK}/`]: "", "/tmp/": "" });
  for (const [path, bytes] of files) vfs.mount({ [path]: bytes });
  return vfs;
}

/** Every file below `root` as `relative/path` and every empty folder as `relative/path/`, as `readTree` of `outcome.ts` lists a folder. */
export function readVfsTree(fs: HostFs, root: string): TreeFiles {
  const out: TreeFiles = [];
  const walk = (dir: string, prefix: string): void => {
    const entries = fs.readdir(dir);
    if (entries.length === 0 && dir !== root) out.push([`${prefix}`, new Uint8Array(0)]);
    for (const entry of entries) {
      const full = `${dir === "/" ? "" : dir}/${entry.name}`;
      if (entry.isDirectory) walk(full, `${prefix}${entry.name}/`);
      else out.push([`${prefix}${entry.name}`, fs.readFile(full)]);
    }
  };
  if (fs.exists(root)) walk(root, "");
  return out;
}

const logOf = (fs: HostFs, path: string): string => (fs.exists(path) ? textDecoder.decode(fs.readFile(path)) : "");

interface WireRecord {
  calls: WireCall[];
  origins: Set<string>;
}

const newWireRecord = (): WireRecord => ({ calls: [], origins: new Set() });

/** A transport that sends through `fetch`, notes each SOAP request as the wire carried it, and the origin of every request (HOST-279). */
function recordingTransport(wire: WireRecord): HttpTransport {
  const inner = createFetchTransport();
  const header = (request: { headers: readonly (readonly [string, string])[] }, name: string): string | undefined =>
    request.headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return {
    async send(request) {
      wire.origins.add(new URL(request.url).origin);
      const response = await inner.send(request);
      const action = header(request, "SOAPAction");
      if (action !== undefined && request.body !== undefined) {
        wire.calls.push({ action, body: textDecoder.decode(request.body).replace(/^<\?xml[^>]*\?>/, "") });
      }
      return response;
    },
  };
}

const serverOf = (server: BrowserServer, transport: HttpTransport): PortServer => ({ ...server, transport });

interface Settled {
  calls: CallRecord[];
  files: TreeFiles | null;
  log: string;
  messages: Array<{ channel: string; text: string }>;
  console: string;
  termination: Termination;
  exitCode: number;
}

function result(settled: Settled, wire: WireRecord): BrowserRunResult {
  return { ...settled, wire: wire.calls, origins: [...wire.origins] };
}

// ---------------------------------------------------------------------------------------------------------------------- export

async function runExport(request: ExportRunRequest): Promise<BrowserRunResult> {
  const wire = newWireRecord();
  const server = serverOf(request.server, recordingTransport(wire));
  const vfs = treeOf(request.files);
  const host = createBrowserHost({ fs: vfs, cwd: WORK, osUser: "libsjs" }).env;
  const output = `${WORK}/output`;
  const logPath = `${WORK}/engine.log`;
  vfs.mkdir(output);
  const { context, onItemError } = exportContextFor(server, request.options, output, logPath);
  if (request.console?.manifestPath !== undefined) context.manifestFile = request.console.manifestPath;
  const collected = collectors();
  const cancelAfter = request.options.cancelAfterStatus ?? 0;
  let statuses = 0;
  let manager: ImportExportManager | undefined;
  const messages = createMessagesFactory({
    onMessage: (message) => {
      collected.messages.push(message);
      if (message.channel === "status" && cancelAfter > 0 && ++statuses === cancelAfter) manager?.cancel();
    },
    ...(onItemError === undefined ? {} : { onItemError }),
    engine: server.engine,
  });
  let ended: Termination = { kind: "exported" };
  let calls: CallRecord[] = [];
  let session: Awaited<ReturnType<typeof openSession>> | undefined;
  try {
    session = await openSession(server);
    manager = await ImportExportManager.create(context, messages, session.helper, {
      fs: vfs,
      host,
      console: collected.sink,
      culture: ORACLE_HOST_CULTURE,
    });
    const mode = request.console?.mode;
    let selection;
    if (mode === undefined) selection = selectionOf(request.packages ?? []);
    else {
      const manifest = request.console?.manifestPath ?? "";
      const table: SelectionTable =
        mode === "use-import"
          ? useImportTable(manifest, { engine: server.engine, logFilePath: context.logFilePath, fs: vfs, host })
          : mode === "from-manifest"
            ? await fromManifestTable(manager, manifest, false)
            : await allPackagesTable(manager);
      selection = table;
    }
    await manager.exportSolutions(context, selection);
  } catch (error) {
    ended = termination(error);
  } finally {
    if (session !== undefined) {
      try {
        await session.helper.logout();
      } catch (error) {
        if (ended.kind === "exported") ended = { kind: "exception", summary: `logout: ${exceptionText(error)}` };
      }
      calls = session.calls;
    }
  }
  return result(
    {
      calls,
      files: readVfsTree(vfs, output),
      log: logOf(vfs, logPath),
      messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
      console: collected.console(),
      termination: ended,
      exitCode: ended.kind === "exception" ? 2 : 0,
    },
    wire,
  );
}

// ---------------------------------------------------------------------------------------------------------------------- import

async function runImport(request: ImportRunRequest): Promise<BrowserRunResult> {
  const options = request.options;
  const wire = newWireRecord();
  const server = serverOf(request.server, recordingTransport(wire));
  if (server.engine !== "14.35" && (options.languages !== undefined || options.amlBatch !== undefined || options.collectErrors !== undefined)) {
    throw new Error(`the options ${JSON.stringify(options)} are 14.35's`);
  }
  const vfs = treeOf(request.files);
  const host = createBrowserHost({ fs: vfs, cwd: WORK, osUser: request.osUser }).env;
  const logPath = `${WORK}/engine.log`;
  const context = baseContext(new SolutionUpgradeContext(), server, request.inputDir, logPath, options.verbose === true);
  context.action = "Import";
  context.manifestFile = `${request.inputDir}/imports.mf`;
  const importContext = new SUImportContext();
  importContext.merge = options.merge === true;
  importContext.release = options.release ?? null;
  importContext.description = options.description ?? null;
  importContext.vault = options.vault === true;
  importContext.fast = options.fast === true;
  if (options.languages !== undefined) context.languages = [...options.languages];
  if (options.amlBatch !== undefined) {
    importContext.amlBatchMode = true;
    importContext.amlBatchMaxSize = options.amlBatch.maxSize;
  }
  if (options.collectErrors !== undefined) {
    importContext.collectImportErrors = true;
    importContext.collectImportErrorsMaxCount = options.collectErrors.maxCount;
  }
  const collected = collectors();
  let statusMessages = 0;
  let manager: ImportExportManager | undefined;
  const messages = createMessagesFactory({
    onMessage: (message) => {
      collected.messages.push(message);
      if (message.channel === "status") {
        statusMessages += 1;
        if (statusMessages === options.cancelAfterStatus) manager?.cancel();
      }
    },
    engine: server.engine,
  });
  let ended: Termination = { kind: "returned", value: -1 };
  let calls: CallRecord[] = [];
  let session: Awaited<ReturnType<typeof openSession>> | undefined;
  try {
    session = await openSession(server);
    manager = await ImportExportManager.create(context, messages, session.helper, {
      fs: vfs,
      host,
      console: collected.sink,
      osUser: request.osUser,
      culture: ORACLE_HOST_CULTURE,
    });
    const packages = request.only !== undefined ? [...request.only] : (manager.manifestFile?.getAllPackageNames() ?? []);
    ended = { kind: "returned", value: await manager.importSolutions(packages, importContext) };
  } catch (error) {
    ended = termination(error);
  } finally {
    if (session !== undefined) {
      try {
        await session.helper.logout();
      } catch (error) {
        if (ended.kind === "returned") ended = { kind: "exception", summary: `logout: ${exceptionText(error)}` };
      }
      calls = session.calls;
    }
  }
  return result(
    {
      calls,
      files: null,
      log: logOf(vfs, logPath),
      messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
      console: collected.console(),
      termination: ended,
      exitCode: ended.kind === "exception" ? 2 : 0,
    },
    wire,
  );
}

// ---------------------------------------------------------------------------------------------------------------- language pack

async function runLanguagePack(request: LanguagePackRunRequest): Promise<BrowserRunResult> {
  const wire = newWireRecord();
  const server = serverOf(request.server, recordingTransport(wire));
  if (request.languages !== undefined && server.engine !== "14.35") throw new Error("the Languages selection is 14.35's");
  const vfs = treeOf(request.files);
  const host = createBrowserHost({ fs: vfs, cwd: WORK, osUser: request.osUser }).env;
  const logPath = `${WORK}/engine.log`;
  const tempRoot = "/tmp/libsjs-lp";
  vfs.mkdir(tempRoot);
  const context = baseContext(new SolutionUpgradeContext(), server, WORK, logPath, false);
  context.action = "LPImport";
  context.lpPath = `${request.lpDir}/ImportConfig.xml`;
  context.lpPackage = request.lpPackage;
  context.lpDebug = request.lpDebug;
  if (request.languages !== undefined) context.languages = [...request.languages];
  const importContext = new SUImportContext();
  const collected = collectors();
  const messages = createMessagesFactory({ onMessage: (message) => void collected.messages.push(message), engine: server.engine });
  let ended: Termination = { kind: "returned", value: -1 };
  let session: Awaited<ReturnType<typeof openSession>> | undefined;
  try {
    session = await openSession(server);
    ended = {
      kind: "returned",
      value: await languagePackImport(context, importContext, messages, session.helper, {
        fs: vfs,
        host,
        console: collected.sink,
        osUser: request.osUser,
        tempPath: `${tempRoot}/`,
        hostCatch: false,
      }),
    };
  } catch (error) {
    ended = termination(error);
  }
  const kept = request.lpDebug ? vfs.readdir(tempRoot).map((entry) => entry.name) : [];
  const files = kept.length === 1 ? readVfsTree(vfs, `${tempRoot}/${kept[0] as string}`) : null;
  return result(
    {
      calls: session?.calls ?? [],
      files,
      log: logOf(vfs, logPath),
      messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
      console: collected.console(),
      termination: ended,
      exitCode: ended.kind === "exception" ? 2 : 0,
    },
    wire,
  );
}

// -------------------------------------------------------------------------------------------------------------------- DB patch

async function runDbPatch(request: DbPatchRunRequest): Promise<BrowserRunResult> {
  const wire = newWireRecord();
  const server = serverOf(request.server, recordingTransport(wire));
  const vfs = treeOf(request.files);
  const host = createBrowserHost({ fs: vfs, cwd: WORK, osUser: request.osUser }).env;
  const logPath = `${WORK}/engine.log`;
  const context = baseContext(new SolutionUpgradeContext(), server, request.inputDir, logPath, false);
  context.action = "ImportDPPatch";
  const config = new DBUpdateConfig();
  config.dbUpdatedManifestFilePath = `${request.inputDir}/${request.manifestName}`;
  config.dbPatchesFolderPath = request.inputDir;
  config.toolName = request.toolName;
  const collected = collectors();
  const messages = createMessagesFactory({ onMessage: (message) => void collected.messages.push(message), engine: server.engine });
  let ended: Termination = { kind: "applied" };
  let calls: CallRecord[] = [];
  let session: Awaited<ReturnType<typeof openSession>> | undefined;
  try {
    session = await openSession(server);
    const manager = new ImportExportManager(context, messages, session.helper, {
      fs: vfs,
      host,
      console: collected.sink,
      ...(request.osUser === "" ? {} : { osUser: request.osUser }),
    });
    await manager.applyDBUpdateManifest(config, {});
  } catch (error) {
    ended = termination(error);
  } finally {
    if (session !== undefined) {
      try {
        await session.helper.logout();
      } catch (error) {
        if (ended.kind === "applied") ended = { kind: "exception", summary: `logout: ${exceptionText(error)}` };
      }
      calls = session.calls;
    }
  }
  const errors = collected.messages.filter((m) => m.channel === "error").length;
  return result(
    {
      calls,
      files: null,
      log: logOf(vfs, logPath),
      messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
      console: collected.console(),
      termination: ended,
      exitCode: ended.kind === "exception" ? 2 : errors > 0 ? 1 : 0,
    },
    wire,
  );
}

/** Runs one request in the Worker. A run that throws before it can give an outcome rejects; the driver reports the case as failed. */
export function runRequest(request: BrowserRunRequest): Promise<BrowserRunResult> {
  switch (request.kind) {
    case "export":
      return runExport(request);
    case "import":
      return runImport(request);
    case "language-pack":
      return runLanguagePack(request);
    case "db-patch":
      return runDbPatch(request);
  }
}
