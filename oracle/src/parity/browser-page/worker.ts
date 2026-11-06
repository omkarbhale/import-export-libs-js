import { runRequest } from "./run.js";
import type { FromWorker, ToWorker } from "./protocol.js";

/**
 * The Worker of the parity page (HOST-277): it takes one run request at a time from the page and answers with the run's result. The
 * engine, the tree in memory and the `fetch` calls are all here, off the page's thread, as a caller of the shipped library runs them.
 *
 * @spec HOST-277
 */
declare const self: {
  onmessage: ((event: { data: ToWorker }) => void) | null;
  postMessage(message: FromWorker, transfer?: ArrayBuffer[]): void;
};

self.onmessage = (event) => {
  const { id, request } = event.data;
  runRequest(request).then(
    (result) => {
      const transfer: ArrayBuffer[] = [];
      for (const [, bytes] of result.files ?? []) if (bytes.buffer instanceof ArrayBuffer && bytes.byteLength > 0) transfer.push(bytes.buffer);
      self.postMessage({ id, ok: true, result }, transfer);
    },
    (error: unknown) => self.postMessage({ id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  );
};
