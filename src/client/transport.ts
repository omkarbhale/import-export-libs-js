import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

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

export const nodeTransport: HttpTransport = {
  send(request) {
    return new Promise((resolve, reject) => {
      const url = new URL(request.url);
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      let responseTimer: NodeJS.Timeout | undefined;
      const fail = (failure: TransportFailure, message: string) => {
        clearTimeout(responseTimer);
        req.destroy();
        reject(new TransportError(failure, message, url.hostname));
      };

      const req = send(url, { method: request.method });
      for (const [name, value] of request.headers) req.setHeader(name, value);
      if (request.responseTimeoutMs > 0) {
        responseTimer = setTimeout(() => fail("timeout", "The operation has timed out"), request.responseTimeoutMs);
      }
      req.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(responseTimer);
        if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
          reject(new TransportError("refused", "Unable to connect to the remote server", url.hostname));
        } else if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
          reject(new TransportError("unresolved", `The remote name could not be resolved: '${url.hostname}'`, url.hostname));
        } else if (/^(ERR_TLS|ERR_SSL|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH)/.test(error.code ?? "")) {
          reject(
            new TransportError(
              "other",
              "The underlying connection was closed: Could not establish trust relationship for the SSL/TLS secure channel.",
              url.hostname,
            ),
          );
        } else {
          reject(new TransportError("other", error.message, url.hostname));
        }
      });
      req.on("response", (response: IncomingMessage) => {
        clearTimeout(responseTimer);
        if (request.readTimeoutMs > 0) {
          response.setTimeout(request.readTimeoutMs, () => fail("timeout", "The operation has timed out"));
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", (error) => fail("other", error.message));
        response.on("end", () => {
          const headers: [string, string][] = [];
          for (let i = 0; i + 1 < response.rawHeaders.length; i += 2) {
            headers.push([response.rawHeaders[i] ?? "", response.rawHeaders[i + 1] ?? ""]);
          }
          resolve({
            status: response.statusCode ?? 0,
            reason: response.statusMessage ?? "",
            headers,
            body: Buffer.concat(chunks),
          });
        });
      });
      req.end(request.body);
    });
  },
};
