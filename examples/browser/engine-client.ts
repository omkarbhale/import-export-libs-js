import {
  type EngineWorker,
  type WorkerConnectOptions,
  type WorkerDbPatchesOptions,
  type WorkerExportOptions,
  type WorkerExportResult,
  type WorkerImportOptions,
  type WorkerLanguagePackOptions,
  type WorkerLike,
  type WorkerOperationResult,
  createEngineWorker,
} from "../../src/browser.js";
import type { Engine } from "../../src/engines.js";

/**
 * The one module through which the page reaches the engine (HOST-280): a logged-in session that runs the four operations, in a Web
 * Worker (HOST-274), so that the page keeps its thread while an export or an import runs. Every run starts a Worker of its own and
 * stops it when the session is closed. The engine keeps lookup caches that it never clears, a fault it reproduces (EXP-619): in a
 * page that runs again and again, against this server and then another, a Worker that lived on would read what an earlier run left
 * in them. A new Worker starts with none, and the engine is left as it is.
 *
 * @spec HOST-280 HOST-274
 */

/** A logged-in connection and the operations it runs. */
export interface EngineSession {
  readonly engine: Engine;
  /** The server version as the engine writes it in its log, such as `14.0.9.36073`. */
  readonly serverVersion: string;
  exportPackages(options: WorkerExportOptions): Promise<WorkerExportResult>;
  importPackages(options: WorkerImportOptions): Promise<WorkerOperationResult>;
  importLanguagePack(options: WorkerLanguagePackOptions): Promise<WorkerOperationResult>;
  applyDbPatches(options: WorkerDbPatchesOptions): Promise<WorkerOperationResult>;
  /** Sends the logoff and stops the Worker; a second call does nothing. */
  close(): Promise<void>;
}

export interface EngineClient {
  connect(options: WorkerConnectOptions): Promise<EngineSession>;
}

export interface WorkerEngineOptions {
  /**
   * Where each run's Worker comes from: the `Worker` or the URL of the Worker's file. Default the library's own, the file
   * `browser-worker.js` next to the page's script, which is where the build puts it.
   */
  worker?: () => WorkerLike | URL | string;
}

/** The client that runs the engine in a new Worker for each connection. */
export function createWorkerEngine(options: WorkerEngineOptions = {}): EngineClient {
  return {
    async connect(connectOptions) {
      const worker: EngineWorker = createEngineWorker(options.worker === undefined ? {} : { worker: options.worker() });
      try {
        const session = await worker.connect(connectOptions);
        let closed = false;
        return {
          engine: session.engine,
          serverVersion: session.serverVersionText,
          exportPackages: (run) => worker.exportPackages(session, run),
          importPackages: (run) => worker.importPackages(session, run),
          importLanguagePack: (run) => worker.importLanguagePack(session, run),
          applyDbPatches: (run) => worker.applyDbPatches(session, run),
          async close() {
            if (closed) return;
            closed = true;
            try {
              await session.close();
            } finally {
              await worker.dispose({ force: true });
            }
          },
        };
      } catch (error) {
        await worker.dispose({ force: true });
        throw error;
      }
    },
  };
}
