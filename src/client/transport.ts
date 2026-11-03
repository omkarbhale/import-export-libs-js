/**
 * The HTTP seam: the types the client is written against, and nothing that touches a network. The Node implementation is
 * `nodeTransport` in `src/host/node-transport.ts` (HOST-230), so that a file that imports these types does not pull in Node's HTTP client.
 *
 * @spec HOST-230
 */

/** What the client sends: the HTTP exchange, below the Aras protocol. */
export interface TransportRequest {
  method: "GET" | "POST";
  url: string;
  /** Header names and values in the order they are sent. */
  headers: ReadonlyArray<readonly [string, string]>;
  body?: Uint8Array;
  /** Milliseconds to wait for the response to arrive; 0 or less waits for ever. */
  responseTimeoutMs: number;
  /** Milliseconds a read of the response body may stall; 0 or less waits for ever. */
  readTimeoutMs: number;
}

export interface TransportResponse {
  status: number;
  /** The reason phrase of the status line. */
  reason: string;
  /** Header names and values as received, repeated headers (such as `Set-Cookie`) kept apart. */
  headers: ReadonlyArray<readonly [string, string]>;
  body: Uint8Array;
}

/** Why an exchange failed before a response was read. */
export type TransportFailure = "timeout" | "refused" | "unresolved" | "other";

export class TransportError extends Error {
  constructor(
    readonly failure: TransportFailure,
    message: string,
    /** The host the request was for, as .NET names it in "could not be resolved". */
    readonly host: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/** Sends one HTTP request. Redirects are not followed and cookies are not kept. */
export interface HttpTransport {
  send(request: TransportRequest): Promise<TransportResponse>;
}
