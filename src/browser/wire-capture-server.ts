import { type FakeHandler, bodyText, header, respond } from "../client/fake-transport.js";
import type { TransportRequest } from "../client/transport.js";

/**
 * The server side of a proxy capture of a reference host's wire (`fixtures/wire/<engine>-reference-host/*.jsonl`, WIRE-002): a handler
 * that answers each request with the recorded response of the exchange it repeats, so that the HTTP server of the browser tests
 * (`test-server.ts`, HOST-234) can serve the login of a real engine over HTTP. It is test tooling and reads nothing: the caller gives
 * it the parsed lines.
 *
 * @spec HOST-234
 */

/** One line of a capture. A response the proxy did not keep in full has a `{length, sha256}` body and cannot be served. */
export interface CaptureExchange {
  seq: number;
  request: { method: string; url: string; headers: [string, string][]; body: string };
  response?: { status: number; headers: [string, string][]; body: string | { length: number; sha256: string }; clientBody?: string };
}

/** Parses the text of a capture file. */
export function parseCapture(text: string): CaptureExchange[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as CaptureExchange);
}

/** The request headers a recorded request has that the HTTP stack, not the client, sets (WIRE-005's port note). */
const STACK_HEADERS = new Set(["host", "connection", "expect", "content-length"]);

/** A recorded request header list without the headers of the stack: what the client chose. */
export function clientHeaders(exchange: CaptureExchange): [string, string][] {
  return exchange.request.headers.filter(([name]) => !STACK_HEADERS.has(name.toLowerCase()));
}

/** A server's response headers the HTTP framing of the test server writes itself. */
const FRAMING_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "date", "keep-alive"]);

/** The address of the machine that recorded a capture: the proxy's own, which the recorded bodies name. */
const RECORDED_ORIGIN = /https?:\/\/(?:localhost|172\.19\.5\.185)(?::\d+)?/g;

export interface CaptureServerOptions {
  /** The address that the recorded bodies' own address (`http://localhost:18169`) is replaced by: where this server is reached. */
  base: string;
}

/**
 * The handler of a capture: a request is answered by the first exchange not served yet that has its method, its path and, for a SOAP
 * call, its action and body. The token request's body is compared without its password field, because the capture holds that field
 * as `SCRUBBED` (AGENTS.md rule 6). A request that no exchange repeats is noted in `mismatches` and answered
 * with a 501.
 */
export class CaptureServer {
  /** The requests that no recorded exchange repeats, each with what differed. */
  readonly mismatches: string[] = [];
  private readonly served = new Set<number>();

  constructor(
    private readonly exchanges: readonly CaptureExchange[],
    private readonly options: CaptureServerOptions,
  ) {}

  /** The number of recorded exchanges served. */
  get consumed(): number {
    return this.served.size;
  }

  private static comparable(body: string): string {
    return body.replace(/password=[^&]*/, "password=SCRUBBED");
  }

  readonly handler: FakeHandler = (request: TransportRequest) => {
    const url = new URL(request.url);
    const wanted = `${url.pathname}${url.search}`;
    const body = CaptureServer.comparable(bodyText(request));
    const action = header(request, "SOAPAction");
    const found = this.exchanges.findIndex(
      (exchange) =>
        !this.served.has(exchange.seq) &&
        exchange.response !== undefined &&
        exchange.request.method === request.method &&
        exchange.request.url === wanted &&
        (exchange.request.headers.find(([name]) => name === "SOAPAction")?.[1] ?? undefined) === action &&
        CaptureServer.comparable(exchange.request.body) === body,
    );
    const exchange = this.exchanges[found];
    if (exchange?.response === undefined || typeof exchange.response.body !== "string") {
      this.mismatches.push(`${request.method} ${wanted} ${action ?? ""} ${body.slice(0, 200)}`);
      return respond("no recorded exchange repeats this request", { status: 501, reason: "Not Implemented" });
    }
    this.served.add(exchange.seq);
    const text = (exchange.response.clientBody ?? exchange.response.body).replace(RECORDED_ORIGIN, this.options.base);
    const headers = exchange.response.headers.filter(([name]) => !FRAMING_HEADERS.has(name.toLowerCase()));
    return respond(text, { status: exchange.response.status, reason: reasonOf(exchange.response.status), headers });
  };
}

function reasonOf(status: number): string {
  return ({ 200: "OK", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found", 500: "Internal Server Error" } as Record<number, string>)[status] ?? "";
}
