import type { BrowserRunRequest, BrowserRunResult, FromWorker, ToWorker } from "./protocol.js";

/**
 * The parity page's main thread (HOST-279): it starts the Worker and gives the driver one call, `window.__parity.run(request)`, which
 * the driver makes through `page.evaluate` with the request as its argument. The request holds the server's credentials; nothing here
 * reads them from the URL, the page or storage, and nothing keeps them after the call.
 *
 * @spec HOST-279
 */
interface WorkerLike {
  postMessage(message: ToWorker, transfer?: ArrayBuffer[]): void;
  onmessage: ((event: { data: FromWorker }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}
declare const Worker: new (url: string, options: { type: "module" }) => WorkerLike;
declare const window: { __parity?: { run(request: BrowserRunRequest): Promise<BrowserRunResult> } };

const worker = new Worker("./worker.js", { type: "module" });
const pending = new Map<number, { resolve(result: BrowserRunResult): void; reject(error: Error): void }>();
let next = 1;

worker.onmessage = ({ data }) => {
  const waiting = pending.get(data.id);
  pending.delete(data.id);
  if (waiting === undefined) return;
  if (data.ok) waiting.resolve(data.result);
  else waiting.reject(new Error(data.error));
};
worker.onerror = (event) => {
  for (const waiting of pending.values()) waiting.reject(new Error(`the Worker failed: ${event.message ?? "unknown"}`));
  pending.clear();
};

window.__parity = {
  run: (request) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      const transfer: ArrayBuffer[] = [];
      worker.postMessage({ id, request }, transfer);
    }),
};
