import { type HttpTransport, TransportError, type TransportResponse } from "../client/transport.js";

/**
 * The browser's `HttpTransport`, over `fetch`. It gives what `nodeTransport` gives (`src/host/node-transport.ts`) where a browser
 * permits it, and the differences are rules: failures are one class (HOST-231), the headers a browser forbids are dropped and the
 * reason phrase is filled in (HOST-232), and cookies and credentials are the browser's (HOST-233). It imports nothing from Node, and
 * `fetch` is injectable, so the same code runs under Node's own `fetch` in the tests.
 *
 * @spec HOST-230 HOST-231 HOST-232 HOST-233
 */

/** The `credentials` modes of `fetch`; declared here because the Node and DOM typings do not both name the type. */
export type FetchCredentials = "omit" | "same-origin" | "include";

export interface FetchTransportOptions {
  /** The `fetch` to call. Default: the global one. */
  fetch?: typeof fetch;
  /**
   * The `credentials` mode of every request. Default `"omit"` (HOST-233): the Aras session cookie is not needed, and a request
   * that includes credentials is refused by a server that answers `Access-Control-Allow-Origin: *`. A page served from the
   * server's own origin may pass `"same-origin"`.
   */
  credentials?: FetchCredentials;
  /**
   * Cancels the exchange. An abort by this signal rejects the `send` with the signal's own reason (an `AbortError` as a rule),
   * not with a `TransportError` (HOST-231).
   */
  signal?: AbortSignal;
  /**
   * Whether to send the `Aras-Request-ReadOnly` header that the client adds to a read (`client/connection.ts`). Default `false`
   * (HOST-232): a server whose CORS configuration does not list the header refuses the whole request, with no detail, and the
   * header is a hint that does not change the request. Pass `true` when the server's `Access-Control-Allow-Headers` lists it.
   */
  sendReadOnlyHint?: boolean;
}

/**
 * The request header names a browser's `fetch` refuses to set and silently ignores (HOST-232), in lower case. `Host`,
 * `Content-Length` and `Cookie` are the ones the client's own request carries; the rest are dropped for the same reason.
 */
export const FORBIDDEN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "cookie",
  "content-length",
  "connection",
  "expect",
  "accept-encoding",
  "user-agent",
]);

const READ_ONLY_HINT_HEADER = "aras-request-readonly";
/** Always dropped (HOST-232): no server lists it, so its preflight would refuse 12.0's discovery, and a browser holds no session for it to steer. */
const SESSION_STATE_HINT_HEADER = "aras-set-httpsessionstate-behavior";

/**
 * The reason phrases of the final HTTP statuses (RFC 9110), for a response whose `statusText` is empty (HTTP/2 has no reason
 * phrase and Chromium and Firefox give none). 1xx are left out: `fetch` never answers with one.
 */
const REASON_PHRASES: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  426: "Upgrade Required",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
};

/** The reason phrase of a status code, or the empty string for a code the table does not know. */
export function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? "";
}

type Phase = "headers" | "body";

/** @spec HOST-230 HOST-231 HOST-232 HOST-233 */
export function createFetchTransport(options: FetchTransportOptions = {}): HttpTransport {
  const credentials = options.credentials ?? "omit";
  return {
    async send(request) {
      const fetchFn = options.fetch ?? fetch;
      const url = new URL(request.url);
      const controller = new AbortController();
      const callerSignal = options.signal;
      let timedOut = false;
      let phase: Phase = "headers";
      let timer: ReturnType<typeof setTimeout> | undefined;

      const abortForTimeout = () => {
        timedOut = true;
        controller.abort();
      };
      const onCallerAbort = () => controller.abort(callerSignal?.reason);
      if (callerSignal) {
        if (callerSignal.aborted) throw callerSignal.reason;
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }

      // The failures of one exchange, in the classes of the transport (HOST-231).
      const failure = (error: unknown): unknown => {
        if (timedOut) return new TransportError("timeout", "The operation has timed out", url.hostname);
        if (callerSignal?.aborted) return error;
        if (error instanceof TransportError) return error;
        if (error instanceof TypeError) {
          return phase === "headers"
            ? new TransportError("refused", "Unable to connect to the remote server", url.hostname)
            : new TransportError("other", error.message, url.hostname);
        }
        return new TransportError("other", error instanceof Error ? error.message : String(error), url.hostname);
      };

      try {
        const headers: [string, string][] = [];
        for (const [name, value] of request.headers) {
          const lower = name.toLowerCase();
          if (FORBIDDEN_REQUEST_HEADERS.has(lower)) continue;
          if (lower === SESSION_STATE_HINT_HEADER) continue;
          if (lower === READ_ONLY_HINT_HEADER && options.sendReadOnlyHint !== true) continue;
          headers.push([name, value]);
        }
        const init: NonNullable<Parameters<typeof fetch>[1]> = {
          method: request.method,
          headers,
          redirect: "follow",
          credentials,
          cache: "no-store",
          mode: "cors",
          signal: controller.signal,
        };
        if (request.body !== undefined) init.body = request.body as Uint8Array<ArrayBuffer>;

        if (request.responseTimeoutMs > 0) timer = setTimeout(abortForTimeout, request.responseTimeoutMs);
        let response: Response;
        try {
          response = await fetchFn(request.url, init);
        } catch (error) {
          throw failure(error);
        } finally {
          clearTimeout(timer);
        }

        phase = "body";
        let body: Uint8Array;
        try {
          body = await readBody(response, request.readTimeoutMs, abortForTimeout);
        } catch (error) {
          throw failure(error);
        }

        const responseHeaders: [string, string][] = [];
        response.headers.forEach((value, name) => responseHeaders.push([name, value]));
        const result: TransportResponse = {
          status: response.status,
          reason: response.statusText !== "" ? response.statusText : reasonPhrase(response.status),
          headers: responseHeaders,
          body,
        };
        return result;
      } finally {
        callerSignal?.removeEventListener("abort", onCallerAbort);
      }
    },
  };
}

/**
 * The body of a response. Without a read timeout it is `arrayBuffer()`; with one it is read chunk by chunk, and a wait for the
 * next chunk that lasts `readTimeoutMs` calls `onStall`, which aborts the exchange.
 */
async function readBody(response: Response, readTimeoutMs: number, onStall: () => void): Promise<Uint8Array> {
  if (readTimeoutMs <= 0 || response.body === null) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const stall = setTimeout(onStall, readTimeoutMs);
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } finally {
      clearTimeout(stall);
    }
    const { done, value } = chunk;
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}
