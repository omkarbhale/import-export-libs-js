import { afterAll, describe, expect, it } from "vitest";
import { connect, exportPackages, type Session } from "../browser.js";
import { HttpServerConnection } from "../client/connection.js";
import { WINDOWS_ZONE_IDS } from "../client/windows-zones.js";
import type { Engine } from "../engines.js";
import { LOGIN, engineMessages, recordedMessages } from "./api-test-support.js";
import { createFetchTransport } from "./fetch-transport.js";
import { R35_ALLOW_HEADERS, SP9_ALLOW_HEADERS, type FaultSpec, type SeenRequest, type WireScenarioSpec } from "./wire-spec.js";
import { loadFixtureTree, readFixtureText } from "./test-support.browser.js";
import { type CaptureExchange, clientHeaders, parseCapture } from "./wire-capture-server.js";
import { type Scenario, actionsOf, headerOf, preflightsOf, requestsOf, soapOf, wireScenario } from "./wire-support.browser.js";

/**
 * The part of the engine that the other browser replays hand over to a fake: the wire (HOST-269). The client logs in and runs an
 * export through `HttpServerConnection` and the fetch transport to a real HTTP server in another origin (`test-server.ts`, HOST-234),
 * so CORS, the preflight, the headers a browser sets and refuses, the encodings, the timeouts and the failures are the browser's own.
 * Each scenario is a server of its own that a test asks for; what it received is read back and compared with the recording.
 *
 * What a page cannot test is not tested: a mixed-content block needs an HTTPS page against an `http` server, and the page here is on
 * `localhost`, a secure context, so neither the block nor the insecure-context behaviour of the Web Crypto API is reachable. They are
 * in `roadmap/browser-cors-poc.md` and in the facade's documentation (HOST-269).
 *
 * @spec HOST-269 HOST-234 HOST-230 HOST-231 HOST-232 HOST-233 WIRE-010 WIRE-011 WIRE-012 WIRE-013 WIRE-014 WIRE-016 WIRE-050 EXP-551
 */

// a failure that the client does not catch is a defect, and a browser reports it only as an event
const unhandled: unknown[] = [];
(globalThis as unknown as { addEventListener(type: string, listener: (event: { reason?: unknown }) => void): void }).addEventListener("unhandledrejection", (event) => unhandled.push(event.reason));

const DATABASE = "12sp9";
/** A password that is already a digest, so that IOM 15 sends it as given (WIRE-012) and the capture's token body is the same text. */
const MD5_PASSWORD = "5f4dcc3b5aa765d61d8327deb882cf99";

const created: Scenario[] = [];
async function scenario(spec: WireScenarioSpec): Promise<Scenario> {
  const made = await wireScenario(spec);
  created.push(made);
  return made;
}
afterAll(async () => {
  await Promise.all(created.map((entry) => entry.release()));
  expect(unhandled, "no rejection went unhandled in the page").toEqual([]);
});

const login = (made: Scenario, engine: Engine, extra: Record<string, unknown> = {}) => ({
  url: made.url,
  database: DATABASE,
  userName: "admin",
  password: "secret-pw",
  engine,
  transport: createFetchTransport(),
  ...extra,
});

/** Lets the page's event loop run, so that a rejection that nobody handles is reported before the test looks for one. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The reason a login or a call ended, as the text the engine gives. */
async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return message(error);
  }
  throw new Error("expected the call to fail");
}

const names = (request: SeenRequest): string[] => request.headers.map(([name]) => name.toLowerCase()).sort();

// ----------------------------------------------------------------------------------------------------------- the three logins

interface Shape {
  engine: Engine;
  /** The capture of the reference host, which has the request framing the engine must send. */
  capture: string;
  /** The server whose login this is. */
  label: string;
  /** The requests that make a login: discovery, (the key set,) the grant, `ValidateUser`, (IOM 12's user id,) the user record and the probe. */
  oauthRequests: number;
}

const SHAPES: readonly Shape[] = [
  { engine: "12.0", capture: "12.0-reference-host/capture.jsonl", label: "12.0, OAuth through IOM 12", oauthRequests: 8 },
  { engine: "14.0.7", capture: "14.0.7-reference-host/capture.jsonl", label: "14.0.7, OAuth", oauthRequests: 10 },
  { engine: "14.35", capture: "14.35-reference-host/capture.jsonl", label: "14.35, OAuth through IOM 15", oauthRequests: 10 },
];

/** The exchanges of a capture that the log's requests repeat, in order. */
function alignedWith(requests: readonly SeenRequest[], exchanges: readonly CaptureExchange[]): CaptureExchange[] {
  const out: CaptureExchange[] = [];
  let cursor = 0;
  for (const request of requests) {
    const action = headerOf(request, "SOAPAction");
    const at = exchanges.findIndex(
      (exchange, index) =>
        index >= cursor &&
        exchange.request.method === request.method &&
        exchange.request.url === request.path &&
        exchange.request.headers.find(([name]) => name === "SOAPAction")?.[1] === action &&
        exchange.request.body.replace(/password=[^&]*/, "password=SCRUBBED") === request.body.replace(/password=[^&]*/, "password=SCRUBBED"),
    );
    if (at < 0) throw new Error(`the server received ${request.method} ${request.path} ${action ?? ""}, which the capture does not hold after exchange ${cursor}`);
    out.push(exchanges[at] as CaptureExchange);
    cursor = at + 1;
  }
  return out;
}

/** The headers of a request that are names the page's browser sets itself or refuses to take, which a server sees with the browser's own values. */
const BROWSER_OWN = new Set(["host", "connection", "content-length", "expect", "cookie"]);

/** The hints of the engine's requests that the transport leaves out unless asked, because no server lists them (HOST-232). */
const HINTS = ["aras-request-readonly", "aras-set-httpsessionstate-behavior"];

const headerLists = new Map<string, string[]>();

describe.each(SHAPES)("the login of $label, over HTTP to another origin (HOST-269)", ({ engine, capture, oauthRequests }) => {
  it("sends the recorded requests, with the recorded values of the headers the client chooses", async () => {
    const exchanges = parseCapture(await readFixtureText(`fixtures/wire/${capture}`));
    const made = await scenario({ engine, capture });
    const session = await connect(login(made, engine, { password: MD5_PASSWORD, timeZoneName: "India Standard Time" }));
    expect(session.engine).toBe(engine);
    await session.close();

    const { seen, mismatches } = await made.log();
    expect(mismatches, "requests the capture does not repeat").toEqual([]);
    const sent = requestsOf(seen);
    const recorded = alignedWith(sent, exchanges);
    expect(sent.length, "the requests of the login, the probe and the logoff").toBeGreaterThanOrEqual(oauthRequests);

    for (const [index, request] of sent.entries()) {
      const exchange = recorded[index] as CaptureExchange;
      const where = `#${exchange.seq} ${request.method} ${request.path} ${headerOf(request, "SOAPAction") ?? ""}`;
      // the body is the recorded one, byte for byte but for the digest the capture scrubbed (WIRE-012)
      expect(request.body.replace(/password=[^&]*/, "password=SCRUBBED"), `${where}: the body`).toBe(exchange.request.body.replace(/password=[^&]*/, "password=SCRUBBED"));
      for (const [name, value] of clientHeaders(exchange)) {
        if (BROWSER_OWN.has(name.toLowerCase()) || HINTS.includes(name.toLowerCase())) continue;
        expect(headerOf(request, name), `${where}: the ${name} the server saw`).toBe(value);
      }
      // what a browser refuses to take from the engine is not in the request: no cookie (HOST-233), no expectation, and the length is the body's
      expect(headerOf(request, "cookie"), `${where}: no Cookie`).toBeUndefined();
      expect(headerOf(request, "expect"), `${where}: no Expect`).toBeUndefined();
      for (const hint of HINTS) expect(headerOf(request, hint), `${where}: no ${hint} unless asked for (HOST-232)`).toBeUndefined();
      if (request.method === "POST") expect(Number(headerOf(request, "content-length")), `${where}: Content-Length`).toBe(new TextEncoder().encode(request.body).length);
    }
    // the protocol: the discovery names the token endpoint of this server, and a 14 server's key set is read
    expect(sent.map((request) => request.path.split("/").slice(-1)[0])).toEqual(expect.arrayContaining(["OAuthServerDiscovery.aspx", "openid-configuration", "token"]));
    expect(actionsOf(seen)[0]).toBe("ValidateUser");
    expect(actionsOf(seen).at(-1)).toBe("Logoff");
    if (engine === "12.0") expect(actionsOf(seen)).toContain("GetCurrentUserID");
    else expect(sent.some((request) => request.path.endsWith("/jwks"))).toBe(true);

    // every custom header the client sent was in the preflight's list, or the browser would have refused the request
    for (const preflight of preflightsOf(seen)) {
      expect(headerOf(preflight, "access-control-request-method"), "the preflight asks for POST or GET").toMatch(/^(POST|GET)$/);
    }
    headerLists.set(`${engine} ${capture}`, [...new Set(sent.map((request) => `${request.method} ${request.path.split("/").slice(-1)[0]}${headerOf(request, "SOAPAction") === undefined ? "" : ` ${headerOf(request, "SOAPAction")}`}: ${names(request).join(" ")}`))]);
  });

  it("sends LOCALE as given and TIMEZONE_NAME as the Windows id of the page's own zone, until ValidateUser replaces them (WIRE-005, HOST-242)", async () => {
    const made = await scenario({ engine });
    const session = await connect(login(made, engine, { locale: "de-DE" }));
    await session.close();
    const soap = soapOf((await made.log()).seen);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(WINDOWS_ZONE_IDS[zone], `the table maps ${zone}`).toBeDefined();
    expect(headerOf(soap[0] as SeenRequest, "LOCALE")).toBe("de-DE");
    expect(headerOf(soap[0] as SeenRequest, "TIMEZONE_NAME")).toBe(WINDOWS_ZONE_IDS[zone]);
    // the fake server's session context: locale en-US and the zone "Server Time", which every later call carries
    for (const request of soap.slice(1)) {
      expect(headerOf(request, "LOCALE")).toBe("en-US");
      expect(headerOf(request, "TIMEZONE_NAME")).toBe("Server Time");
    }
  });
});

describe("the legacy login of 12.0, with the header login (HOST-269)", () => {
  // the three headers are in no flavour's list (roadmap/browser-cors-poc.md): a server that has only the legacy login must add them
  const legacyHeaders = `${SP9_ALLOW_HEADERS},AUTHUSER,AUTHPASSWORD,DATABASE`;
  const MD5_SECRET = "d6cd129e0088f82faab428b425f92ac4";
  const SHA256_SECRET = "CCDDF9FD8EEF87A7C43B4D6F164BFC52C6B531D611296EC91A31FD32B306BFAA";

  it("sends AUTHUSER, AUTHPASSWORD as the MD5 digest and DATABASE, and no bearer token, to a server that lists them", async () => {
    const made = await scenario({
      engine: "12.0",
      login: "legacy",
      legacy: { password: "secret-pw", mode: "MD5" },
      cors: { allowOrigin: "echo", allowHeaders: legacyHeaders },
    });
    const session = await connect(login(made, "12.0"));
    await session.close();
    const { seen } = await made.log();
    const soap = soapOf(seen);
    expect(soap.map((request) => headerOf(request, "SOAPAction"))).toEqual(["ValidateUser", "GetCurrentUserID", "ApplyItem", "ApplyAML", "ApplyAML", "Logoff"]);
    for (const request of soap) {
      expect(headerOf(request, "AUTHUSER")).toBe("admin");
      expect(headerOf(request, "AUTHPASSWORD")).toBe(MD5_SECRET);
      expect(headerOf(request, "DATABASE")).toBe(DATABASE);
      expect(headerOf(request, "Authorization")).toBeUndefined();
      expect(headerOf(request, "X-Aras-Authorization")).toBeUndefined();
    }
    // the discovery found no page (a 404), so the client went on without OAuth (WIRE-011); no token was asked for
    expect(requestsOf(seen).some((request) => request.path.endsWith("/connect/token"))).toBe(false);
  });

  it("switches to SHA-256 when the server's challenge asks for it, and sends the digest in capitals (WIRE-016, WIRE-014)", async () => {
    const made = await scenario({
      engine: "12.0",
      login: "legacy",
      legacy: { password: "secret-pw", mode: "SHA256" },
      cors: { allowOrigin: "echo", allowHeaders: legacyHeaders },
    });
    const session = await connect(login(made, "12.0"));
    await session.close();
    const digests = soapOf((await made.log()).seen).map((request) => headerOf(request, "AUTHPASSWORD"));
    expect(digests[0], "the first call is hashed with MD5, the default mode").toBe(MD5_SECRET);
    expect(digests[1], "the challenge's mode, once").toBe(SHA256_SECRET);
    expect(new Set(digests.slice(1))).toEqual(new Set([SHA256_SECRET]));
  });

  it("is refused by a server that does not list the legacy headers, with the text of a failed connection", async () => {
    const made = await scenario({ engine: "12.0", login: "legacy", legacy: { password: "secret-pw", mode: "MD5" } });
    const text = await failureOf(() => connect(login(made, "12.0")));
    expect(text).toContain("System.Net.WebException: Unable to connect to the remote server");
    const { seen } = await made.log();
    expect(soapOf(seen), "the browser refused the request after its preflight").toEqual([]);
    expect(preflightsOf(seen).length).toBeGreaterThan(0);
  });
});

describe("the digest of the grant against a server's challenge (HOST-269)", () => {
  const MD5_SECRET = "d6cd129e0088f82faab428b425f92ac4";
  const SHA256_SECRET = "CCDDF9FD8EEF87A7C43B4D6F164BFC52C6B531D611296EC91A31FD32B306BFAA";
  const tokenBodies = (seen: readonly SeenRequest[]): string[] => requestsOf(seen).filter((request) => request.path.endsWith("/connect/token")).map((request) => request.body);

  it("14.0.7 hashes with MD5 first and sends SHA-256 once the server says incompatible_hash_use_sha256 (WIRE-013)", async () => {
    const made = await scenario({ engine: "14.0.7", tokenHash: { password: "secret-pw", mode: "SHA256" } });
    const session = await connect(login(made, "14.0.7"));
    await session.close();
    expect(tokenBodies((await made.log()).seen).map((body) => new URLSearchParams(body).get("password"))).toEqual([MD5_SECRET, SHA256_SECRET]);
  });

  it("14.35 sends the password as given, and the MD5 digest once the server says incompatible_hash_use_md5", async () => {
    const made = await scenario({ engine: "14.35", tokenHash: { password: "secret-pw", mode: "MD5" } });
    const session = await connect(login(made, "14.35"));
    await session.close();
    expect(tokenBodies((await made.log()).seen).map((body) => new URLSearchParams(body).get("password"))).toEqual(["secret-pw", MD5_SECRET]);
  });

  it("14.35 against the recorded rejection: the grant is sent twice and the server's refusal is the login's error (WIRE-013)", async () => {
    const made = await scenario({ engine: "14.35", capture: "14.35-reference-host/capture-rejected-login.jsonl" });
    const text = await failureOf(() => connect(login(made, "14.35", { userName: "libsjs-no-such-user", password: "libsjs-not-a-password" })));
    expect(text).toContain("Authentication failed for libsjs-no-such-user");
    const { seen, mismatches } = await made.log();
    expect(mismatches).toEqual([]);
    expect(tokenBodies(seen).map((body) => new URLSearchParams(body).get("password"))).toEqual(["libsjs-not-a-password", "e0710f2447d84aa65b44d552f4d459dc"]);
  });
});

describe("the hints that no server lists (HOST-232)", () => {
  const READ_ONLY = '<AML><Item type="Part" action="get" readOnly="1"/></AML>';

  it("leaves Aras-Request-ReadOnly out unless the caller asks and the server lists it", async () => {
    const plain = await scenario({ engine: "14.35" });
    const first = await connect(login(plain, "14.35"));
    await first.helper.inn.connection.callAction("ApplyAML", READ_ONLY);
    expect(requestsOf((await plain.log()).seen).some((request) => headerOf(request, "aras-request-readonly") !== undefined)).toBe(false);

    const listed = await scenario({ engine: "14.35", cors: { allowOrigin: "echo", allowHeaders: `${R35_ALLOW_HEADERS},Aras-Request-ReadOnly` } });
    const second = await connect(login(listed, "14.35", { transport: createFetchTransport({ sendReadOnlyHint: true }) }));
    await second.helper.inn.connection.callAction("ApplyAML", READ_ONLY);
    const hinted = requestsOf((await listed.log()).seen).filter((request) => headerOf(request, "aras-request-readonly") === "1");
    expect(hinted, "the one read-only request carries the hint").toHaveLength(1);

    // a server that does not list the header refuses the whole request, which is why it is left out by default
    const refused = await connect(login(plain, "14.35", { transport: createFetchTransport({ sendReadOnlyHint: true }) }));
    const answer = await refused.helper.inn.connection.callAction("ApplyAML", READ_ONLY);
    expect(answer.errorString).toContain("System.Net.WebException: Unable to connect to the remote server");
  });

  it("leaves IOM 12's Aras-Set-HttpSessionState-Behavior out unless asked, or 12.0's discovery is refused at the preflight", async () => {
    const withHint = await scenario({ engine: "12.0", cors: { allowOrigin: "echo", allowHeaders: `${SP9_ALLOW_HEADERS},Aras-Set-HttpSessionState-Behavior` } });
    await (await connect(login(withHint, "12.0", { transport: createFetchTransport({ sendSessionStateHint: true }) }))).close();
    const discovery = requestsOf((await withHint.log()).seen)[0] as SeenRequest;
    expect(headerOf(discovery, "Aras-Set-HttpSessionState-Behavior")).toBe("switch_to_initial");

    const plain = await scenario({ engine: "12.0" });
    const refused = await failureOf(() => connect(login(plain, "12.0", { transport: createFetchTransport({ sendSessionStateHint: true }) })));
    expect(refused).toContain("System.Net.WebException: Unable to connect to the remote server");
    expect(requestsOf((await plain.log()).seen), "the preflight failed, so the discovery was never sent").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------- an export over HTTP

interface ExportCase {
  engine: Engine;
  name: string;
  unordered?: boolean;
  parallelism?: number;
}

async function exportOverHttp(spec: ExportCase) {
  const base = `fixtures/${spec.engine}/export/${spec.name}`;
  const input = JSON.parse(await readFixtureText(`${base}/case.json`)) as { packages: Array<{ name: string }> };
  const level = /^Export level: (.*)\r$/m.exec(await readFixtureText(`${base}/engine.log`))?.[1] ?? "";
  const made = await scenario({ engine: spec.engine, recorded: { name: spec.name, ...(spec.unordered === true ? { unordered: true } : {}) } });
  const session: Session = await connect(login(made, spec.engine));
  const result = await exportPackages(session, {
    packages: input.packages.map((entry) => entry.name),
    ...(level === "" ? {} : { level }),
    ...(spec.parallelism === undefined ? {} : { parallelism: spec.parallelism }),
  });
  await session.close();
  const log = await made.log();
  const expected = new Map((await loadFixtureTree(`${base}/output`)).map((file) => [file.path, file.bytes] as const));
  return { made, result, log, expected, base };
}

/** The files the run made are the files the recording holds, with the same bytes. */
function expectSameFiles(made: ReadonlyMap<string, Uint8Array>, expected: ReadonlyMap<string, Uint8Array>, label: string): void {
  expect([...made.keys()].sort(), `${label}: the files`).toEqual([...expected.keys()].sort());
  for (const [path, bytes] of expected) expect(made.get(path), `${label}: ${path} byte for byte`).toEqual(bytes);
}

describe("an export through HTTP gives what the recorded replay gives (HOST-269)", () => {
  it.each(["12.0", "14.0.7", "14.35"] as const)("e27-permission on %s: the folder, the messages and every request are the recording's", async (engine) => {
    const { result, log, expected, base } = await exportOverHttp({ engine, name: "e27-permission" });
    expect(log.mismatches, "requests the recording does not hold").toEqual([]);
    expectSameFiles(result.files, expected, `${engine} e27-permission`);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(await readFixtureText(`${base}/messages.jsonl`)));
    expect(actionsOf(log.seen)[0]).toBe("ValidateUser");
    expect(actionsOf(log.seen).at(-1)).toBe("Logoff");
  });

  it.each([6, 12])("14.35 exports two packages with %i items in flight, in whatever order the browser's connections deliver them (EXP-551)", async (parallelism) => {
    const { result, log, expected } = await exportOverHttp({ engine: "14.35", name: "x-par-two-packages-run1", unordered: true, parallelism });
    expect(log.mismatches, "requests the recording does not hold").toEqual([]);
    expectSameFiles(result.files, expected, `14.35 x-par-two-packages-run1 (${parallelism} in flight)`);
    // the export asked for every item: the requests of the items are all in the log
    expect(actionsOf(log.seen).filter((action) => action === "ApplyItem").length).toBeGreaterThan(expected.size - 1);
  });
});

// -------------------------------------------------------------------------------------------------------------- the failures

describe("what the server answers with an error, a stall or nothing (HOST-269)", () => {
  const on = (soapAction: string, action: FaultSpec["action"], extra: Partial<FaultSpec> = {}): FaultSpec[] => [{ match: { soapAction }, action, ...extra }];

  it.each([
    ["a status line with a reason phrase", undefined],
    ["a status line with none, as HTTP/2 has", ""],
  ])("turns an HTTP 500 with %s into (500) Internal Server Error (WIRE-050, HOST-232)", async (_label, reason) => {
    const made = await scenario({ engine: "14.0.7", faults: on("ValidateUser", { status: 500, ...(reason === undefined ? {} : { reason }) }) });
    const text = await failureOf(() => connect(login(made, "14.0.7")));
    expect(text).toContain("System.Net.WebException: The remote server returned an error: (500) Internal Server Error.");
  });

  it("renews the token after a 401 and repeats the call with the new one (WIRE-018)", async () => {
    const made = await scenario({ engine: "14.0.7", faults: on("ValidateUser", { status: 401 }) });
    const session = await connect(login(made, "14.0.7"));
    await session.close();
    const { seen } = await made.log();
    const grants = requestsOf(seen).filter((request) => request.path.endsWith("/connect/token"));
    expect(grants, "the grant was made again for the renewal").toHaveLength(2);
    const validations = soapOf(seen).filter((request) => headerOf(request, "SOAPAction") === "ValidateUser");
    expect(validations.map((request) => headerOf(request, "Authorization"))).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("sends the token in X-Aras-Authorization to a server whose protocol is Custom, and renews it on that protocol's 498 (WIRE-005, WIRE-018)", async () => {
    const made = await scenario({ engine: "14.0.7", oauthProtocol: "Custom", faults: on("ValidateUser", { status: 498 }) });
    await (await connect(login(made, "14.0.7"))).close();
    const { seen } = await made.log();
    const validations = soapOf(seen).filter((request) => headerOf(request, "SOAPAction") === "ValidateUser");
    expect(validations.map((request) => headerOf(request, "X-Aras-Authorization"))).toEqual(["Bearer token-1", "Bearer token-2"]);
    for (const request of soapOf(seen)) expect(headerOf(request, "Authorization")).toBeUndefined();
  });

  it("times out a response that does not come, with the engine's text (HOST-231)", async () => {
    const made = await scenario({ engine: "14.0.7", faults: on("Ping", { delayMs: 1_500 }) });
    const session = await connect(login(made, "14.0.7"));
    (session.helper.inn.connection as unknown as HttpServerConnection).timeout = 250;
    const response = await session.helper.inn.connection.callAction("Ping", "<Item/>");
    expect(response.isError).toBe(true);
    expect(response.errorString).toContain("System.Net.WebException: The operation has timed out");
  });

  it("times out a body that stalls between two chunks (HOST-231)", async () => {
    const made = await scenario({ engine: "14.0.7", faults: [{ match: { pathEnds: "/OAuthServerDiscovery.aspx" }, action: { stallBody: { afterBytes: 10, ms: 1_500 } } }] });
    const response = createFetchTransport().send({
      method: "GET",
      url: `${made.url}/Server/OAuthServerDiscovery.aspx`,
      headers: [],
      responseTimeoutMs: 5_000,
      readTimeoutMs: 250,
    });
    await expect(response).rejects.toMatchObject({ failure: "timeout", message: "The operation has timed out" });
  });

  it("reports a refused connection, a server that went away, in the one class a browser has (HOST-231)", async () => {
    const made = await scenario({ engine: "14.0.7", ownListener: true });
    const session = await connect(login(made, "14.0.7"));
    await made.stop();
    const response = await session.helper.inn.connection.callAction("ApplyAML", "<AML/>");
    expect(response.isError).toBe(true);
    expect(response.errorString).toContain("System.Net.WebException: Unable to connect to the remote server");
  });

  it("reports a dropped connection in the same class, though a browser repeats a request that a reused connection dropped", async () => {
    const made = await scenario({ engine: "14.0.7", faults: on("Ping", { destroy: true }, { times: 10 }) });
    const session = await connect(login(made, "14.0.7"));
    const response = await session.helper.inn.connection.callAction("Ping", "<Item/>");
    expect(response.errorString).toContain("System.Net.WebException: Unable to connect to the remote server");
  });
});

describe("a server that does not answer the page's origin (HOST-269)", () => {
  it("refuses the SOAP endpoint, and the login ends with the text of a failed connection, not an unhandled rejection (HOST-231)", async () => {
    const made = await scenario({ engine: "14.0.7", soapCors: { allowOrigin: "none" } });
    const text = await failureOf(() => connect(login(made, "14.0.7")));
    expect(text).toContain("System.Net.WebException: Unable to connect to the remote server");
    await settled();
    expect(unhandled, "the refusal ended the login and no rejection was left behind").toEqual([]);
    const { seen } = await made.log();
    expect(soapOf(seen), "the browser sent no SOAP request: the preflight failed").toEqual([]);
    expect(preflightsOf(seen).length).toBeGreaterThan(0);
    // the OAuth server answered, so the login got as far as the token
    expect(requestsOf(seen).some((request) => request.path.endsWith("/connect/token"))).toBe(true);
  });

  it("refuses a server with no CORS at all, 12.0's discovery as the same failed connection and 14's as the engine's HttpClient error", async () => {
    const none = { allowOrigin: "none" } as const;
    const iom12 = await scenario({ engine: "12.0", cors: none });
    expect(await failureOf(() => connect(login(iom12, "12.0")))).toContain("System.Net.WebException: Unable to connect to the remote server");
    const iom14 = await scenario({ engine: "14.0.7", cors: none });
    expect(await failureOf(() => connect(login(iom14, "14.0.7")))).toContain("System.Net.Http.HttpRequestException: An error occurred while sending the request.");
    await settled();
    expect(unhandled, "no rejection was left behind").toEqual([]);
    // the request itself reached the server (the browser sent it, and then withheld the answer), or was stopped at the preflight
    expect((await iom14.log()).seen.length).toBeGreaterThan(0);
  });

  it("refuses a request that carries credentials to a server that answers the wildcard, and does not send them by default (HOST-233)", async () => {
    const wildcard = await scenario({ engine: "14.0.7", cors: { allowOrigin: "*", allowCredentials: true, allowHeaders: SP9_ALLOW_HEADERS } });
    await (await connect(login(wildcard, "14.0.7"))).close();
    const credentialed = await failureOf(() => connect(login(wildcard, "14.0.7", { transport: createFetchTransport({ credentials: "include" }) })));
    // the discovery is the first request, and a client's HttpClient error is what the engine says of it (WIRE-011)
    expect(credentialed).toContain("System.Net.Http.HttpRequestException: An error occurred while sending the request.");
  });

  it("does not show a header the server does not expose, and gives the status of a response it does answer (HOST-232)", async () => {
    const made = await scenario({ engine: "14.0.7", capture: "14.0.7-reference-host/capture.jsonl", cors: { allowOrigin: "echo", allowHeaders: SP9_ALLOW_HEADERS } });
    const response = await createFetchTransport().send({
      method: "GET",
      url: `${made.url}/Server/OAuthServerDiscovery.aspx`,
      headers: [],
      responseTimeoutMs: 5_000,
      readTimeoutMs: 5_000,
    });
    expect(response.status).toBe(200);
    expect(response.reason).toBe("OK");
    const exposed = response.headers.map(([name]) => name);
    expect(exposed, "Set-Cookie is never readable by a page (HOST-233)").not.toContain("set-cookie");
    expect(exposed, "Server is not a safelisted header and the server exposes none").not.toContain("server");
    expect(exposed).toContain("content-type");
  });
});

afterAll(() => {
  const lines = [...headerLists].flatMap(([shape, rows]) => [`  ${shape}`, ...rows.map((row) => `    ${row}`)]);
  console.info(`HOST-269 request header names the server saw, per wire shape, in ${navigator.userAgent}\n${lines.join("\n")}`);
});
