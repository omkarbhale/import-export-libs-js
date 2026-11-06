/**
 * A recorded run, served over HTTP (HOST-280): the reference page's manual test harness and the server its browser test talks to.
 * It wraps the fake Aras servers the CLI's tests already use (`RecordedServer`, `MembershipServer`, `RecordedDbPatchServer`, which answer
 * the login and then each request with the next recorded response) in `node:http`, with the CORS answers a cross-origin page needs:
 * the preflight, and `Access-Control-Allow-Origin` echoing the page's origin. Each logoff starts the recording again, so that a person
 * can run the same case twice.
 *
 * The server answers the login as a 12 SP9 server (what those fakes do), so a page that connects to it names the engine of the case
 * instead of `auto`. It serves one case at a time; the wire in a browser against every shape of server is the browser plan's own
 * ticket (the test server of `src/browser/`), and this one is the smallest thing that lets the page be run and tested.
 *
 * Test and manual-test tooling: nothing under `src/` imports it.
 *
 * @spec HOST-280
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { MembershipServer, type ServerItem } from "../../src/cli/membership-server.js";
import { RecordedDbPatchServer } from "../../src/cli/replay-db-patch-transport.js";
import { RecordedServer } from "../../src/cli/replay-transport.js";
import { type FakeHandler, header } from "../../src/client/fake-transport.js";
import type { TransportRequest } from "../../src/client/transport.js";
import { type Engine, isEngine } from "../../src/engines.js";
import { repoRoot } from "../browser-bundle.js";
import type { Recipe, ReplayOperation, ReplayStats } from "./replay-types.js";

/** One pass through a recording: a login, the recorded requests, the logoff. */
export interface ReplayRun {
  handler: FakeHandler;
  stats(): ReplayStats;
}

export type { Recipe, ReplayStats } from "./replay-types.js";

export interface ReplayCase {
  /** `<engine>/<operation>/<name>[/step-N]` */
  id: string;
  recipe: Recipe;
  newRun(): ReplayRun;
}

const osUserOf = (calls: readonly TranscriptCall[]): string => /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

/** The recorded cases the harness knows, by the folder a case lives in: `14.0.7/export/e27-permission`, `14.0.7/import/s0-mini-defaults`. */
export function loadReplayCase(id: string, root: string = repoRoot): ReplayCase {
  const [engineName, operation, name, step] = id.split("/");
  if (engineName === undefined || !isEngine(engineName)) throw new Error(`'${id}' does not start with an engine: 12.0, 14.0.7 or 14.35`);
  if (operation !== "export" && operation !== "import" && operation !== "language-pack" && operation !== "dbpatch") {
    throw new Error(`'${id}': the operation is export, import, language-pack or dbpatch`);
  }
  if (name === undefined) throw new Error(`'${id}' names no case`);
  const engine: Engine = engineName;
  const base = path.join(root, "fixtures", engine, operation, name);
  if (!existsSync(base)) throw new Error(`there is no recorded case ${path.relative(root, base)}`);
  const blobs = path.join(root, "fixtures", engine, operation, "_blobs");
  // the 2.7 MB list of package definitions is recorded once, under 14.0.7's export (fixture-set.ts)
  const shared = path.join(root, "fixtures", "14.0.7", "export", "_blobs");
  const read = (dir: string): TranscriptCall[] => {
    const file = path.join(dir, "transcript.jsonl");
    try {
      return readTranscript(file, blobs);
    } catch {
      return readTranscript(file, shared);
    }
  };

  if (operation === "export") {
    const definition = readJson<{ packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }> }>(path.join(base, "case.json"));
    const calls = read(base);
    const items: ServerItem[] = definition.packages.flatMap((entry) => entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })));
    const level = /^Export level: (.*)\r$/m.exec(readFileSync(path.join(base, "engine.log"), "utf8"))?.[1] ?? "";
    return {
      id,
      recipe: { engine, operation, userName: "admin", packages: definition.packages.map((entry) => entry.name), ...(level === "" ? {} : { level }) },
      newRun() {
        const server = new RecordedServer(calls, engine);
        const membership = new MembershipServer(items, server.handler);
        membership.answersPackageList = true;
        return { handler: membership.handler, stats: () => ({ consumed: server.consumed, total: server.total, mismatches: server.mismatches }) };
      },
    };
  }

  if (operation === "import") {
    const dir = path.join(base, step ?? "step-1");
    const definition = readJson<{ steps: Array<{ options?: Record<string, unknown> }> }>(path.join(base, "case.json"));
    const index = Number(/^step-(\d+)$/.exec(step ?? "step-1")?.[1] ?? "1");
    const calls = read(dir);
    return {
      id,
      recipe: { engine, operation, userName: "admin", inputDir: path.join(dir, "input"), osUser: osUserOf(calls), options: definition.steps[index - 1]?.options ?? {} },
      newRun() {
        const server = new RecordedServer(calls, engine);
        return { handler: server.handler, stats: () => ({ consumed: server.consumed, total: server.total, mismatches: server.mismatches }) };
      },
    };
  }

  if (operation === "language-pack") {
    const definition = readJson<{ lpPackage: string }>(path.join(base, "case.json"));
    const calls = read(base);
    return {
      id,
      recipe: { engine, operation, userName: "admin", inputDir: path.join(base, "lp"), osUser: osUserOf(calls), lpPackage: definition.lpPackage },
      newRun() {
        const server = new RecordedServer(calls, engine);
        return { handler: server.handler, stats: () => ({ consumed: server.consumed, total: server.total, mismatches: server.mismatches }) };
      },
    };
  }

  const dir = path.join(base, step ?? "step-1");
  const calls = readTranscript(path.join(dir, "transcript.jsonl"), path.join(dir, "_blobs"));
  return {
    id,
    recipe: { engine, operation, userName: "root", inputDir: path.join(dir, "input"), osUser: osUserOf(calls), manifestPath: "/manifest.xml" },
    newRun() {
      const server = new RecordedDbPatchServer(calls);
      return { handler: server.handler, stats: () => ({ consumed: server.consumed, total: server.total, mismatches: server.mismatches }) };
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------ HTTP

/** The address the fake servers claim for themselves in their OAuth documents; the replay server puts its own in its place. */
const CLAIMED_BASE = "http://dev.example/12sp9";

/** The CORS answer for a request: the page's origin, and the headers it asked to send (HOST-280; roadmap/browser-cors-poc.md, section 3). */
function corsHeaders(request: IncomingMessage): Record<string, string> {
  const asked = request.headers["access-control-request-headers"];
  return {
    "Access-Control-Allow-Origin": request.headers.origin ?? "*",
    "Access-Control-Allow-Headers": typeof asked === "string" ? asked : "content-type,locale,soapaction,timezone_name,authorization,x-aras-authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function bodyOf(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on("error", reject);
  });
}

export interface ReplayServer {
  /** The server's address as the page's URL field takes it: `http://127.0.0.1:PORT/12sp9`. */
  url: string;
  /** Every run so far: one per login. */
  runs: ReplayRun[];
  /** The requests received, in order, as `METHOD path SOAPAction`. */
  requests: string[];
  /** What the runs used, added up. */
  report(): ReplayStats & { runs: number };
  close(): Promise<void>;
}

export interface ReplayServerOptions {
  port?: number;
  host?: string;
  /** Logs each request line here. */
  log?: (line: string) => void;
}

/** Starts the server. A logoff ends a run, and the next request starts the recording again. */
export async function startReplayServer(replay: ReplayCase, options: ReplayServerOptions = {}): Promise<ReplayServer> {
  const host = options.host ?? "127.0.0.1";
  const runs: ReplayRun[] = [replay.newRun()];
  const requests: string[] = [];
  let base = CLAIMED_BASE;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors).end();
      return;
    }
    const body = await bodyOf(request);
    const transport: TransportRequest = {
      method: request.method === "GET" ? "GET" : "POST",
      url: `${base}${(request.url ?? "/").replace(/^\/12sp9/, "")}`,
      headers: Object.entries(request.headers).flatMap(([name, value]) => (Array.isArray(value) ? value.map((v) => [name, v] as const) : value === undefined ? [] : [[name, value] as const])),
      body,
      responseTimeoutMs: 0,
      readTimeoutMs: 0,
    };
    const action = header(transport, "SOAPAction");
    requests.push(`${request.method} ${request.url} ${action ?? ""}`.trim());
    options.log?.(requests.at(-1) as string);
    const run = runs.at(-1) as ReplayRun;
    const answer = await run.handler(transport, requests.length - 1);
    if (action === "Logoff") runs.push(replay.newRun());
    const text = Buffer.from(answer.body).toString("utf8").replaceAll(CLAIMED_BASE, base);
    const headers: Record<string, string | string[]> = { ...cors };
    for (const [name, value] of answer.headers) {
      const known = headers[name];
      headers[name] = known === undefined ? value : [...(Array.isArray(known) ? known : [known]), value];
    }
    headers["Content-Length"] = String(Buffer.byteLength(text));
    response.writeHead(answer.status, answer.reason, headers).end(text);
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.writeHead(500, { ...corsHeaders(request) }).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const address = server.address() as AddressInfo;
  base = `http://${host}:${address.port}/12sp9`;
  return {
    url: base,
    runs,
    requests,
    report() {
      const stats = runs.map((run) => run.stats());
      return {
        runs: runs.length,
        consumed: stats.reduce((sum, one) => sum + one.consumed, 0),
        total: stats[0]?.total ?? 0,
        mismatches: stats.flatMap((one) => one.mismatches),
      };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}
