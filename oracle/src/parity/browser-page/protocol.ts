import type { Engine } from "../../../../src/engines.js";
import type { ExportCaseOptions, ExportCasePackage } from "../../export-cases.js";
import type { ImportOptions } from "../../import-cases.js";
import type { CallRecord, RecordedMessage, Termination } from "../outcome.js";

/**
 * What the Node-side driver (`browser-runner.ts`) and the page's Worker (`run.ts`) say to each other (HOST-277). It names no global of
 * Node or of a page, so both sides import it. A request carries the credentials of the run; the driver builds it from the environment
 * and hands it to the page in one `page.evaluate` argument, so no URL, file or source of the page holds them.
 *
 * @spec HOST-277
 */

/** The server a run connects to, as the page's Worker reaches it. */
export interface BrowserServer {
  engine: Engine;
  /** The address the Worker's `fetch` calls: the lease itself, or the runner's same-origin proxy of it (HOST-277). */
  url: string;
  /** The address the engine writes in its log header: the one the oracle host connected as. */
  logUrl: string;
  database: string;
  userName: string;
  password: string;
}

/** The files a run reads, by absolute path in the Worker's tree; a folder with no file is a path ending in `/`. */
export type TreeFiles = Array<[path: string, bytes: Uint8Array]>;

/** The console modes of the export (`runners.ts`, `ConsoleMode`). */
export type BrowserConsoleMode = "all-packages" | "from-manifest" | "use-import";

export interface ExportRunRequest {
  kind: "export";
  server: BrowserServer;
  options: ExportCaseOptions;
  /** The items to export, as the host's `Selection`; absent for a console mode. */
  packages?: ExportCasePackage[];
  /** A console mode builds its table itself, from the manifest the files hold. */
  console?: { mode: BrowserConsoleMode; manifestPath?: string };
  /** The files of the tree the run starts with (a console mode's manifest). */
  files: TreeFiles;
  parallelism?: number;
}

export interface ImportRunRequest {
  kind: "import";
  server: BrowserServer;
  options: ImportOptions;
  /** The folder of `imports.mf` and the package folders, in the tree: as long as the oracle's `input` folder (12.0's log depends on it, IMP-406). */
  inputDir: string;
  files: TreeFiles;
  only?: string[];
  osUser: string;
}

export interface LanguagePackRunRequest {
  kind: "language-pack";
  server: BrowserServer;
  /** The language pack folder in the tree, with `ImportConfig.xml` and `xml/`. */
  lpDir: string;
  lpPackage: string;
  lpDebug: boolean;
  languages?: string[];
  files: TreeFiles;
  osUser: string;
}

export interface DbPatchRunRequest {
  kind: "db-patch";
  server: BrowserServer;
  /** The folder with `manifest.xml` and the patch file, which is the engine's working directory too. */
  inputDir: string;
  manifestName: string;
  toolName: string;
  files: TreeFiles;
  osUser: string;
}

export type BrowserRunRequest = ExportRunRequest | ImportRunRequest | LanguagePackRunRequest | DbPatchRunRequest;

/** One request the Worker's transport sent, as the wire carried it: the SOAP action and the body, which the engine's own call record must repeat (HOST-277). */
export interface WireCall {
  action: string;
  /** The body as sent, without its XML declaration. */
  body: string;
  status: number;
}

/** What a run in the page gives back. The driver turns it into a `RunOutcome`. */
export interface BrowserRunResult {
  calls: CallRecord[];
  /** The output tree (an export's folder, a kept language pack): relative path to bytes, an empty folder as `name/`. Null when the run has none. */
  files: TreeFiles | null;
  log: string;
  messages: RecordedMessage[];
  console: string;
  termination: Termination;
  exitCode: number;
  /** The SOAP requests of the transport, in order, for the wire check. */
  wire: WireCall[];
  /** The browser that ran it, for the report. */
  userAgent: string;
}

/** The Worker's messages. */
export type ToWorker = { id: number; request: BrowserRunRequest };
export type FromWorker = { id: number; ok: true; result: BrowserRunResult } | { id: number; ok: false; error: string };
