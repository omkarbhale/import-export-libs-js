import { type ServerPort, serveEngine } from "./worker-host.js";

/**
 * The Worker's entry (HOST-274, HOST-276): built as `dist/browser-worker.js`, a module Worker that serves the engine to the page's
 * `createEngineWorker`. It has no export; loading it as a Worker is what runs it.
 *
 * @spec HOST-274 HOST-276
 */
declare const self: ServerPort & { close(): void };

serveEngine(self, { onDisposed: () => self.close() });
