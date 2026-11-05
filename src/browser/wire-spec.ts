import type { Engine } from "../engines.js";

/**
 * What a page and the test server of the wire tests say to each other (HOST-234): the scenario a page asks for, the log the server
 * gives back, and the CORS lists of the three server flavours. It imports nothing from Node, so that a page can import it for the
 * values; the server itself is `test-server.ts`.
 *
 * @spec HOST-234
 */

// -------------------------------------------------------------------------------------------------------------------- CORS

/** How a server answers the cross-origin requests of a page (HOST-234). */
export interface CorsSpec {
  /** `echo` answers the page's own origin, `*` a wildcard, `none` sends no `Access-Control-Allow-Origin` at all (a server that has no CORS). */
  allowOrigin: "echo" | "*" | "none";
  /** `Access-Control-Allow-Headers`. */
  allowHeaders?: string;
  /** `Access-Control-Allow-Credentials: true`. */
  allowCredentials?: boolean;
  /** `Access-Control-Expose-Headers`. */
  exposeHeaders?: string;
}

/** The request headers that R23's `Server/web.config` lists in `Access-Control-Allow-Headers` (`roadmap/browser-cors-poc.md`, section 2). */
export const R23_ALLOW_HEADERS =
  "content-disposition,content-range,content-type,locale,soapaction,timezone_name,transactionid,vaultid,Aras-Content-Range-Checksum-Type,Aras-Content-Range-Checksum,Authorization,X-Aras-Authorization";
/** R35's: R23's with the two trace headers. */
export const R35_ALLOW_HEADERS = `${R23_ALLOW_HEADERS},traceparent,tracestate`;
/** What the POC deployed to 12 SP9, which has none out of the box (section 3b). */
export const SP9_ALLOW_HEADERS = "content-type,locale,soapaction,timezone_name,Authorization,X-Aras-Authorization";

/** The configuration a flavour has: 12 SP9 once an administrator has added the block, R23 and R35 as shipped. */
export function flavourCors(engine: Engine): CorsSpec {
  const allowHeaders = engine === "12.0" ? SP9_ALLOW_HEADERS : engine === "14.0.7" ? R23_ALLOW_HEADERS : R35_ALLOW_HEADERS;
  return { allowOrigin: "echo", allowHeaders };
}

// ------------------------------------------------------------------------------------------------------------------- faults

/** Which requests of a scenario a fault applies to. A field that is absent matches any. */
export interface FaultMatch {
  /** The request path ends with this. */
  pathEnds?: string;
  soapAction?: string;
  method?: "GET" | "POST";
}

/** What the server does instead of answering. */
export interface FaultAction {
  status?: number;
  /** The reason phrase of the status line; `""` is an empty one, which is what HTTP/2 puts on the wire. */
  reason?: string;
  body?: string;
  /** Waits this long before it answers (the headers do not arrive meanwhile). */
  delayMs?: number;
  /** Sends the headers and `afterBytes` bytes of the body, waits `ms`, and sends the rest. */
  stallBody?: { afterBytes: number; ms: number };
  /** Closes the connection with no answer. */
  destroy?: boolean;
}

export interface FaultSpec {
  match: FaultMatch;
  /** The matching requests to let through before the fault applies. Default 0. */
  skip?: number;
  /** How many matching requests the fault applies to. Default 1. */
  times?: number;
  action: FaultAction;
}

// ---------------------------------------------------------------------------------------------------------------- scenarios

/** A fixture export case, served as the recorded server of its run (`RecordedServer`, with the package membership answered). */
export interface RecordedCase {
  /** The folder under `fixtures/<engine>/export/`. */
  name: string;
  /** Answers each request with the recorded call that has its text, in any order (EXP-551: items in flight). Default: in the recorded order. */
  unordered?: boolean;
}

/** What a page asks for: the login the server speaks, its CORS, its faults and what it serves after the login. */
export interface WireScenarioSpec {
  /** The engine whose server this is: it decides the OAuth shape (IOM 12, IOM 14, IOM 15) and the CORS list of the flavour. */
  engine: Engine;
  /**
   * `oauth` (default) serves the discovery and the password grant. `legacy` has no discovery page (a 404) and expects the header login
   * with `legacyPassword` as its digest in the mode the server wants.
   */
  login?: "oauth" | "legacy";
  /** For `legacy`: the password the server checks `AUTHPASSWORD` against, and the hashing mode it wants. */
  legacy?: { password: string; mode: "MD5" | "SHA256" };
  /** For `oauth`: a server that wants the digest of the password, not the password, in the grant, and says so with the error code. */
  tokenHash?: { password: string; mode: "MD5" | "SHA256" };
  /** For `oauth`: the discovery's `protocol_type`. `Custom` names `X-Aras-Authorization` as the bearer header and 498 as the status of a refused token (WIRE-005). Default `Standard`. */
  oauthProtocol?: "Standard" | "Custom";
  /** Hands out `token-1`, `token-2`, … so that a renewal shows. Default true. */
  countTokens?: boolean;
  /** Serves a recorded export run after the login. */
  recorded?: RecordedCase;
  /** Serves the recorded exchanges of a capture file (`fixtures/wire/<folder>/<file>`) in place of the fake login. */
  capture?: string;
  cors?: CorsSpec;
  /** The SOAP endpoint's own configuration, when it differs from `cors` (the OAuth server and the SOAP application are configured apart). */
  soapCors?: CorsSpec;
  faults?: FaultSpec[];
  /** Serves the scenario on a listener of its own, which `POST /__control/scenarios/<id>/stop` closes. */
  ownListener?: boolean;
}

/** One request as the server received it. */
export interface SeenRequest {
  method: string;
  /** The path and query below the scenario's prefix. */
  path: string;
  /** The headers with the names as the browser sent them (`rawHeaders`). */
  headers: [string, string][];
  body: string;
  /** The `OPTIONS` request that a browser sends before a request with custom headers. */
  preflight: boolean;
}

/** What `POST /__control/scenarios` answers. */
export interface ScenarioCreated {
  id: string;
  /** The URL to give `connect`: the scenario's base below the server, ending in the database name. */
  url: string;
  /** The origin the scenario is served on (its own listener's, when it has one). */
  origin: string;
}

