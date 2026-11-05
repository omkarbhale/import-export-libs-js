import {
  type ConnectOptions,
  type DbPatchesOptions,
  type ExportOptions,
  type ExportResult,
  type ImportLanguagePackOptions,
  type ImportOptions,
  type ImportResult,
  type OperationResult,
  type Session,
  applyDbPatches,
  connect,
  exportPackages,
  importLanguagePack,
  importPackages,
} from "../../src/browser.js";
import type { Engine } from "../../src/engines.js";

/**
 * The one module through which the page reaches the engine (HOST-280): a logged-in session that runs the four operations. This
 * implementation calls the browser API on the page's own thread. The Worker of the browser plan implements the same two interfaces
 * over `postMessage`, and replaces this module and nothing else.
 *
 * @spec HOST-280
 */

/** A logged-in connection and the operations it runs. */
export interface EngineSession {
  readonly engine: Engine;
  /** The server version as the engine writes it in its log, such as `14.0.9.36073`. */
  readonly serverVersion: string;
  exportPackages(options: ExportOptions): Promise<ExportResult>;
  importPackages(options: ImportOptions): Promise<ImportResult>;
  importLanguagePack(options: ImportLanguagePackOptions): Promise<OperationResult>;
  applyDbPatches(options: DbPatchesOptions): Promise<OperationResult>;
  /** Sends the logoff; a second call does nothing. */
  close(): Promise<void>;
}

export interface EngineClient {
  connect(options: ConnectOptions): Promise<EngineSession>;
}

function sessionOf(session: Session): EngineSession {
  return {
    engine: session.engine,
    serverVersion: session.serverVersionText,
    exportPackages: (options) => exportPackages(session, options),
    importPackages: (options) => importPackages(session, options),
    importLanguagePack: (options) => importLanguagePack(session, options),
    applyDbPatches: (options) => applyDbPatches(session, options),
    close: () => session.close(),
  };
}

/** The client that runs the engine on this thread. */
export function createDirectEngine(): EngineClient {
  return { connect: async (options) => sessionOf(await connect(options)) };
}
