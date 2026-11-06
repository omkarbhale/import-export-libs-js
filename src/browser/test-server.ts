import { readFileSync } from "node:fs";
import { STATUS_CODES, createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTranscript } from "../../oracle/src/transcript.js";
import { md5Lower, sha256Upper } from "../../tools/wire-digests.js";
import { MembershipServer, type ServerItem } from "../cli/membership-server.js";
import { RecordedServer } from "../cli/replay-transport.js";
import { DEV_VARIABLES, type DevServerOptions, type FakeHandler, bodyText, devServer, header, respond } from "../client/fake-transport.js";
import type { TransportRequest, TransportResponse } from "../client/transport.js";
import type { Engine } from "../engines.js";
import { CaptureServer, parseCapture } from "./wire-capture-server.js";
import { type CorsSpec, type FaultAction, type ScenarioCreated, type SeenRequest, type WireScenarioSpec, flavourCors } from "./wire-spec.js";

export * from "./wire-spec.js";

/**
 * The HTTP server of the browser's wire tests (HOST-234): a Node server, started once for a run of the browser project, that a page
 * on another origin talks to with `fetch`. It is the HTTP framing around handlers that already exist: `RecordedServer` and
 * `MembershipServer` (the recorded export runs of the CLI's tests, `src/cli/replay-transport.ts`), `devServer` (the fake Aras
 * server's login) and `CaptureServer` (a reference host's recorded login). Each test asks it, over HTTP, for a scenario of its own
 * and gets a base URL, so tests do not share state and may run in any order.
 *
 * What the framing adds, and what the tests of the page cannot get from a `FakeTransport`:
 *
 * - CORS as a server configures it: `Access-Control-Allow-Origin` echoing the page's origin (or `*`, or none), `Allow-Headers` (the
 *   lists the three server flavours ship, `roadmap/browser-cors-poc.md`), `Allow-Credentials` and `Expose-Headers`, with its own
 *   answer to the preflight, which the browser sends and the page never sees. The SOAP endpoint may be configured apart from the OAuth
 *   endpoints, as a deployment can.
 * - faults, scripted per request: a status and a reason phrase (an empty one is what HTTP/2 gives), a delay before the headers, a stall
 *   in the middle of the body, a dropped connection;
 * - a listener of its own that a test can stop, for a refused connection;
 * - the log of what the server received: the headers with the names as the browser sent them, and the preflights apart.
 *
 * Nothing here reads a password or a token from anywhere: the logins are the recorded or fake ones, and every credential is a
 * test value.
 *
 * The parity script's browser runtime serves a recorded export, import step or language-pack run from it for its dry run, with no lease
 * (`oracle/src/parity/browser-dry-run.ts`, HOST-279).
 *
 * @spec HOST-234 HOST-279
 */

const DATABASE = "12sp9";
const HOST = "127.0.0.1";
const FIXTURES = fileURLToPath(new URL("../../fixtures", import.meta.url));

interface Scenario {
  id: string;
  spec: WireScenarioSpec;
  handler: FakeHandler;
  seen: SeenRequest[];
  matches: number[];
  count: number;
  extra?: Server;
  /** The requests the recorded or captured handler refused to match. */
  mismatches: () => string[];
}

interface Context {
  scenarios: Map<string, Scenario>;
  listeners: Set<Server>;
}


const readBody = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const rawHeaders = (request: IncomingMessage): [string, string][] => {
  const pairs: [string, string][] = [];
  for (let at = 0; at + 1 < request.rawHeaders.length; at += 2) pairs.push([request.rawHeaders[at] as string, request.rawHeaders[at + 1] as string]);
  return pairs;
};

function challenge(mode: string): TransportResponse {
  return respond(
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>1</faultcode><faultstring>Authentication failed</faultstring><detail><supported_authentication_schema><schema mode="${mode}"/></supported_authentication_schema></detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
  );
}

const IOM12_USER = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><GetCurrentUserIDResponse><Result>USER1</Result></GetCurrentUserIDResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

/** The version a fake server of an engine reports: 12 SP9 for 12.0, R23 for 14.0.7 and R35 for 14.35 (`serverOf` of `api-test-support.ts`). */
function versionOf(engine: Engine): Record<string, string> {
  if (engine === "12.0") return DEV_VARIABLES;
  return { VersionMajor: "14", VersionMinor: engine === "14.35" ? "35" : "0", VersionServicePack: "0", VersionBuild: "36073", VersionServiceUpdate: "9" };
}

/** What a scenario asks of the fake login: the grant's digest, the header login, the token counter and the IOM 12 user id. */
function loginOverride(spec: WireScenarioSpec): NonNullable<DevServerOptions["override"]> {
  let tokens = 0;
  return (request) => {
    if (request.url.endsWith("/connect/token")) {
      const form = new URLSearchParams(bodyText(request));
      if (spec.tokenHash !== undefined) {
        const want = spec.tokenHash.mode === "MD5" ? md5Lower(spec.tokenHash.password) : sha256Upper(spec.tokenHash.password);
        if (form.get("password") !== want) {
          return respond(`{"error":"incompatible_hash_use_${spec.tokenHash.mode.toLowerCase()}","error_description":"Incompatible password hash algorithm."}`, {
            status: 400,
            reason: "Bad Request",
          });
        }
      }
      tokens += 1;
      return respond(`{"access_token":"token-${tokens}","expires_in":3600,"token_type":"Bearer"}`);
    }
    if (spec.login === "legacy") {
      if (request.url.endsWith("/OAuthServerDiscovery.aspx")) return respond("Not Found", { status: 404, reason: "Not Found" });
      const legacy = spec.legacy;
      if (legacy !== undefined && header(request, "SOAPAction") !== undefined) {
        const wanted = legacy.mode === "MD5" ? md5Lower(legacy.password) : sha256Upper(legacy.password);
        if (header(request, "AUTHPASSWORD") !== wanted) return challenge(legacy.mode);
      }
    }
    if (header(request, "SOAPAction") === "GetCurrentUserID") return respond(IOM12_USER);
    return undefined;
  };
}

/** The handler of a scenario, and a way to read what it refused. */
function handlerOf(spec: WireScenarioSpec, base: string): { handler: FakeHandler; mismatches: () => string[] } {
  if (spec.capture !== undefined) {
    // the recorded bodies name the database already (`http://localhost:18169/12sp9/OAuthServer/`), so the address replaced is the scenario's without it
    const server = new CaptureServer(parseCapture(readFileSync(join(FIXTURES, "wire", spec.capture), "utf8")), { base: base.slice(0, -`/${DATABASE}`.length) });
    return { handler: server.handler, mismatches: () => server.mismatches };
  }
  const serverOptions: DevServerOptions = {
    base,
    variables: versionOf(spec.engine),
    override: loginOverride(spec),
    ...(spec.oauthProtocol === undefined ? {} : { protocolType: spec.oauthProtocol }),
  };
  if (spec.recorded === undefined) return { handler: devServer(serverOptions), mismatches: () => [] };

  const kind = spec.recorded.kind ?? "export";
  const caseDir = join(FIXTURES, spec.engine, kind, spec.recorded.name);
  const dir = kind === "import" ? join(caseDir, `step-${spec.recorded.step ?? 1}`) : caseDir;
  const calls = readTranscript(join(dir, "transcript.jsonl"), join(FIXTURES, spec.engine, kind, "_blobs"));
  const server = new RecordedServer(calls, spec.engine, { server: serverOptions, unordered: spec.recorded.unordered ?? false });
  // an import or a language pack is the engine's requests in order, and no package is listed first
  if (kind !== "export") return { handler: server.handler, mismatches: () => server.mismatches };
  const input = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as {
    packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }>;
  };
  const items: ServerItem[] = input.packages.flatMap((entry) =>
    entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })),
  );
  const membership = new MembershipServer(items, server.handler);
  membership.answersPackageList = true;
  return { handler: membership.handler, mismatches: () => server.mismatches };
}

// ------------------------------------------------------------------------------------------------------------------ framing

const corsFor = (scenario: Scenario, path: string): CorsSpec => {
  const soap = path.endsWith("/InnovatorServer.aspx");
  return (soap ? scenario.spec.soapCors : undefined) ?? scenario.spec.cors ?? flavourCors(scenario.spec.engine);
};

function corsHeaders(spec: CorsSpec, origin: string | undefined, preflight: boolean): [string, string][] {
  const out: [string, string][] = [];
  if (spec.allowOrigin === "none" || origin === undefined) return out;
  out.push(["Access-Control-Allow-Origin", spec.allowOrigin === "*" ? "*" : origin]);
  if (spec.allowOrigin === "echo") out.push(["Vary", "Origin"]);
  if (spec.allowCredentials === true) out.push(["Access-Control-Allow-Credentials", "true"]);
  if (preflight && spec.allowHeaders !== undefined) out.push(["Access-Control-Allow-Headers", spec.allowHeaders]);
  if (!preflight && spec.exposeHeaders !== undefined) out.push(["Access-Control-Expose-Headers", spec.exposeHeaders]);
  return out;
}

function faultFor(scenario: Scenario, request: TransportRequest): FaultAction | undefined {
  const faults = scenario.spec.faults ?? [];
  for (const [at, fault] of faults.entries()) {
    const { match } = fault;
    if (match.method !== undefined && match.method !== request.method) continue;
    if (match.pathEnds !== undefined && !new URL(request.url).pathname.endsWith(match.pathEnds)) continue;
    if (match.soapAction !== undefined && header(request, "SOAPAction") !== match.soapAction) continue;
    const nth = scenario.matches[at] ?? 0;
    scenario.matches[at] = nth + 1;
    const skip = fault.skip ?? 0;
    if (nth >= skip && nth < skip + (fault.times ?? 1)) return fault.action;
  }
  return undefined;
}

/** A status line and headers, then the body in the pieces a stall asks for. */
async function send(
  response: ServerResponse,
  answer: TransportResponse,
  extra: [string, string][],
  action: FaultAction | undefined,
): Promise<void> {
  const body = Buffer.from(answer.body);
  const headers = [...answer.headers.filter(([name]) => !["content-length", "transfer-encoding", "connection"].includes(name.toLowerCase())), ...extra];
  const lines: Record<string, string[]> = {};
  for (const [name, value] of [...headers, ["Content-Length", String(body.length)] as [string, string]]) (lines[name] ??= []).push(value);
  response.writeHead(answer.status, answer.reason, lines);
  if (action?.stallBody !== undefined) {
    const cut = Math.min(action.stallBody.afterBytes, body.length);
    response.write(body.subarray(0, cut));
    await sleep(action.stallBody.ms);
    if (!response.destroyed) response.end(body.subarray(cut));
  } else {
    response.end(body);
  }
}

async function serveScenario(scenario: Scenario, prefix: string, request: IncomingMessage, response: ServerResponse, listener: Server): Promise<void> {
  const origin = request.headers.origin;
  const rest = (request.url ?? "/").slice(prefix.length) || "/";
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  const body = await readBody(request);
  const headers = rawHeaders(request);
  const cors = corsFor(scenario, path.split("?")[0] ?? path);

  if (request.method === "OPTIONS") {
    scenario.seen.push({ method: "OPTIONS", path, headers, body: "", preflight: true });
    response.writeHead(cors.allowOrigin === "none" ? 200 : 204, "", Object.fromEntries(corsHeaders(cors, origin, true)));
    response.end();
    return;
  }
  scenario.seen.push({ method: request.method ?? "GET", path, headers, body: body.toString("utf8"), preflight: false });

  const address = listener.address() as AddressInfo;
  const transportRequest: TransportRequest = {
    method: request.method === "POST" ? "POST" : "GET",
    url: `http://${HOST}:${address.port}${path}`,
    headers,
    body: new Uint8Array(body),
    responseTimeoutMs: 0,
    readTimeoutMs: 0,
  };
  const action = faultFor(scenario, transportRequest);
  if (action?.destroy === true) {
    request.socket.destroy();
    return;
  }
  if (action?.delayMs !== undefined) await sleep(action.delayMs);
  if (response.destroyed) return;
  const index = scenario.count;
  scenario.count += 1;
  const answer: TransportResponse =
    action?.status !== undefined
      ? respond("", { status: action.status, reason: action.reason ?? STATUS_CODES[action.status] ?? "" })
      : await scenario.handler(transportRequest, index);
  const fixed = action?.reason !== undefined && action.status === undefined ? { ...answer, reason: action.reason } : answer;
  await send(response, fixed, corsHeaders(cors, origin, false), action);
}

// ------------------------------------------------------------------------------------------------------------------ control

const CONTROL_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE",
};

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { ...CONTROL_CORS, "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function closeListener(listener: Server): Promise<void> {
  return new Promise((resolve) => {
    listener.close(() => resolve());
    listener.closeAllConnections();
  });
}

async function control(context: Context, request: IncomingMessage, response: ServerResponse, listener: Server): Promise<void> {
  const url = new URL(request.url ?? "/", "http://control");
  const parts = url.pathname.split("/").filter((part) => part !== "");
  if (request.method === "OPTIONS") {
    response.writeHead(204, CONTROL_CORS);
    response.end();
    return;
  }
  // POST /__control/scenarios
  if (parts[1] === "scenarios" && parts.length === 2 && request.method === "POST") {
    const spec = JSON.parse((await readBody(request)).toString("utf8")) as WireScenarioSpec;
    const id = `${context.scenarios.size + 1}-${Math.random().toString(36).slice(2, 8)}`;
    let served = listener;
    if (spec.ownListener === true) served = await listen(context, 0);
    const port = (served.address() as AddressInfo).port;
    const origin = `http://${HOST}:${port}`;
    const base = `${origin}/s/${id}/${DATABASE}`;
    const made = handlerOf(spec, base);
    const scenario: Scenario = { id, spec, handler: made.handler, mismatches: made.mismatches, seen: [], matches: [], count: 0 };
    if (spec.ownListener === true) scenario.extra = served;
    context.scenarios.set(id, scenario);
    json(response, 200, { id, url: base, origin } satisfies ScenarioCreated);
    return;
  }
  const scenario = context.scenarios.get(parts[2] ?? "");
  if (parts[1] !== "scenarios" || scenario === undefined) return json(response, 404, { error: "no such scenario" });
  // GET /__control/scenarios/<id>/seen
  if (parts[3] === "seen" && request.method === "GET") return json(response, 200, { seen: scenario.seen, mismatches: scenario.mismatches() });
  // POST /__control/scenarios/<id>/stop
  if (parts[3] === "stop" && request.method === "POST") {
    if (scenario.extra !== undefined) await closeListener(scenario.extra);
    return json(response, 200, { stopped: scenario.extra !== undefined });
  }
  // DELETE /__control/scenarios/<id>
  if (parts.length === 3 && request.method === "DELETE") {
    if (scenario.extra !== undefined) await closeListener(scenario.extra);
    context.scenarios.delete(scenario.id);
    return json(response, 200, { deleted: true });
  }
  return json(response, 404, { error: "no such control call" });
}

function listen(context: Context, port: number): Promise<Server> {
  const listener = createServer((request, response) => {
    const url = request.url ?? "/";
    const run = async (): Promise<void> => {
      if (url.startsWith("/__control/")) return control(context, request, response, listener);
      const match = /^\/s\/([^/]+)/.exec(url);
      const scenario = match === null ? undefined : context.scenarios.get(match[1] as string);
      if (match === null || scenario === undefined) {
        response.writeHead(404, "Not Found", { "Content-Type": "text/plain" });
        response.end("no such scenario");
        return;
      }
      return serveScenario(scenario, `/s/${scenario.id}`, request, response, listener);
    };
    run().catch((error: unknown) => {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(500, "Internal Server Error", { "Content-Type": "text/plain" });
        response.end(`the test server failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
  context.listeners.add(listener);
  return new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, HOST, () => resolve(listener));
  });
}

// --------------------------------------------------------------------------------------------------------------------- start

export interface WireServer {
  /** The origin a page reaches the control calls and the default scenarios on, `http://127.0.0.1:<port>`. */
  origin: string;
  close(): Promise<void>;
}

/** Starts the server on a free port. */
export async function startWireServer(): Promise<WireServer> {
  const context: Context = { scenarios: new Map(), listeners: new Set() };
  const main = await listen(context, 0);
  const { port } = main.address() as AddressInfo;
  return {
    origin: `http://${HOST}:${port}`,
    close: async () => {
      await Promise.all([...context.listeners].map((listener) => (listener.listening ? closeListener(listener) : Promise.resolve())));
    },
  };
}
