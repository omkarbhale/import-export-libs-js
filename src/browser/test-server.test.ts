import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TransportRequest } from "../client/transport.js";
import { connect, exportPackages } from "../browser.js";
import { createFetchTransport } from "./fetch-transport.js";
import {
  R23_ALLOW_HEADERS,
  R35_ALLOW_HEADERS,
  SP9_ALLOW_HEADERS,
  type ScenarioCreated,
  type SeenRequest,
  type WireScenarioSpec,
  type WireServer,
  startWireServer,
} from "./test-server.js";
import { LOGIN } from "./api-test-support.js";

/**
 * The HTTP test server of the browser's wire tests, held to its own contract under Node (HOST-234), so that `npm test` fails on a
 * defect of the server and a browser run is not where it is found: the control calls, the framing of the recorded handlers, CORS as
 * configured and the preflight, the scripted faults, a listener that can be stopped, and a recorded export run end to end through
 * `connect`, `exportPackages` and the fetch transport over this server. Node's `fetch` stands in for the page; it enforces no CORS, so
 * what a browser makes of the headers is the browser suite's (`wire.browser.test.ts`).
 *
 * @spec HOST-234
 */

let server: WireServer;
beforeAll(async () => {
  server = await startWireServer();
});
afterAll(async () => {
  await server.close();
});

async function scenario(spec: WireScenarioSpec): Promise<ScenarioCreated> {
  const response = await fetch(`${server.origin}/__control/scenarios`, { method: "POST", body: JSON.stringify(spec) });
  expect(response.status).toBe(200);
  return (await response.json()) as ScenarioCreated;
}

async function seen(created: ScenarioCreated): Promise<{ seen: SeenRequest[]; mismatches: string[] }> {
  return (await (await fetch(`${server.origin}/__control/scenarios/${created.id}/seen`)).json()) as { seen: SeenRequest[]; mismatches: string[] };
}

const request = (url: string, overrides: Partial<TransportRequest> = {}): TransportRequest => ({
  method: "GET",
  url,
  headers: [],
  responseTimeoutMs: 0,
  readTimeoutMs: 0,
  ...overrides,
});

/** The status line the server writes, read off the socket: `fetch` does not show an empty reason phrase. */
function statusLine(url: string): Promise<string> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.hostname, port: Number(target.port) }, () => {
      socket.write(`GET ${target.pathname} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`);
    });
    let text = "";
    socket.on("data", (chunk) => (text += chunk.toString("latin1")));
    socket.on("end", () => resolve(text.split("\r\n")[0] ?? ""));
    socket.on("error", reject);
  });
}

describe("the control calls (HOST-234)", () => {
  it("makes a scenario with a base URL of its own, and gives the log and removes it", async () => {
    const first = await scenario({ engine: "14.0.7" });
    const second = await scenario({ engine: "14.0.7" });
    expect(first.url).toMatch(new RegExp(`^${server.origin}/s/[^/]+/12sp9$`));
    expect(second.id).not.toBe(first.id);
    await fetch(`${first.url}/Server/OAuthServerDiscovery.aspx`);
    expect((await seen(first)).seen.map((entry) => entry.path)).toEqual(["/12sp9/Server/OAuthServerDiscovery.aspx"]);
    expect((await seen(second)).seen).toEqual([]);
    expect((await fetch(`${server.origin}/__control/scenarios/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${first.url}/Server/OAuthServerDiscovery.aspx`)).status).toBe(404);
  });

  it("answers the control calls to a page of another origin", async () => {
    const preflight = await fetch(`${server.origin}/__control/scenarios`, { method: "OPTIONS" });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("content-type");
  });
});

describe("the framing of a login (HOST-234)", () => {
  it("serves the OAuth discovery with the scenario's own address, so that the client's next request comes back here", async () => {
    const created = await scenario({ engine: "14.0.7" });
    const discovery = (await (await fetch(`${created.url}/Server/OAuthServerDiscovery.aspx`)).json()) as { locations: Array<{ uri: string }> };
    expect(discovery.locations[0]?.uri).toBe(`${created.url}/OAuthServer/`);
  });

  it("hands out a new token for each grant, and a legacy server has no discovery page", async () => {
    const created = await scenario({ engine: "14.0.7" });
    const grant = async (): Promise<string> =>
      ((await (await fetch(`${created.url}/OAuthServer/connect/token`, { method: "POST", body: "grant_type=password" })).json()) as { access_token: string }).access_token;
    expect([await grant(), await grant()]).toEqual(["token-1", "token-2"]);
    const legacy = await scenario({ engine: "12.0", login: "legacy" });
    expect((await fetch(`${legacy.url}/Server/OAuthServerDiscovery.aspx`)).status).toBe(404);
  });

  it("answers a wrong digest with a challenge for the mode it wants, and a right one with the login", async () => {
    const created = await scenario({ engine: "12.0", login: "legacy", legacy: { password: "test", mode: "SHA256" } });
    const call = async (digest: string): Promise<string> =>
      (
        await fetch(`${created.url}/Server/InnovatorServer.aspx`, {
          method: "POST",
          headers: { SOAPAction: "ValidateUser", AUTHPASSWORD: digest },
          body: "<Item />",
        })
      ).text();
    expect(await call("098f6bcd4621d373cade4e832627b4f6")).toContain('<schema mode="SHA256"/>');
    expect(await call("9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08")).toContain("<login_name>admin</login_name>");
  });

  it("refuses the grant of a server that wants the digest, with the code the engine's retry reads", async () => {
    const created = await scenario({ engine: "14.0.7", tokenHash: { password: "test", mode: "MD5" } });
    const post = (password: string) => fetch(`${created.url}/OAuthServer/connect/token`, { method: "POST", body: `password=${password}` });
    const refused = await post("test");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "incompatible_hash_use_md5" });
    expect((await post("098f6bcd4621d373cade4e832627b4f6")).status).toBe(200);
  });

  it("repeats the recorded login of a capture, and notes a request the capture does not hold", async () => {
    const created = await scenario({ engine: "14.35", capture: "14.35-reference-host/capture.jsonl" });
    const discovery = await fetch(`${created.url}/Server/OAuthServerDiscovery.aspx`);
    expect(discovery.status).toBe(200);
    expect(((await discovery.json()) as { locations: Array<{ uri: string }> }).locations[0]?.uri).toBe(`${created.url}/OAuthServer/`);
    const unknown = await fetch(`${created.url}/Server/Nothing.aspx`);
    expect(unknown.status).toBe(501);
    expect((await seen(created)).mismatches).toEqual(["GET /12sp9/Server/Nothing.aspx  "]);
  });
});

describe("CORS as a server configures it (HOST-234)", () => {
  const preflight = async (created: ScenarioCreated, path: string, origin = "http://page.example"): Promise<Response> =>
    fetch(`${created.url}${path}`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "locale" },
    });

  it("echoes the page's origin and lists the flavour's headers, as each shipped", async () => {
    for (const [engine, list] of [
      ["12.0", SP9_ALLOW_HEADERS],
      ["14.0.7", R23_ALLOW_HEADERS],
      ["14.35", R35_ALLOW_HEADERS],
    ] as const) {
      const response = await preflight(await scenario({ engine }), "/Server/InnovatorServer.aspx");
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://page.example");
      expect(response.headers.get("access-control-allow-headers")).toBe(list);
      expect(response.headers.get("vary")).toBe("Origin");
    }
    expect(R35_ALLOW_HEADERS.endsWith(",traceparent,tracestate")).toBe(true);
    expect(SP9_ALLOW_HEADERS.toLowerCase()).not.toContain("aras-request-readonly");
    expect(R35_ALLOW_HEADERS.toLowerCase()).not.toContain("aras-request-readonly");
  });

  it("sends a wildcard, credentials and exposed headers when it is told to, and no CORS header when it has none", async () => {
    const wildcard = await scenario({ engine: "14.0.7", cors: { allowOrigin: "*", allowCredentials: true, exposeHeaders: "x-one" } });
    const response = await fetch(`${wildcard.url}/Server/OAuthServerDiscovery.aspx`, { headers: { Origin: "http://page.example" } });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-expose-headers")).toBe("x-one");
    const none = await scenario({ engine: "14.0.7", cors: { allowOrigin: "none" } });
    const bare = await fetch(`${none.url}/Server/OAuthServerDiscovery.aspx`, { headers: { Origin: "http://page.example" } });
    const bareNames: string[] = [];
    bare.headers.forEach((_value, name) => bareNames.push(name));
    expect(bareNames.filter((name) => name.startsWith("access-control"))).toEqual([]);
    expect((await preflight(none, "/Server/InnovatorServer.aspx")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("configures the SOAP endpoint apart from the OAuth server", async () => {
    const created = await scenario({ engine: "14.0.7", soapCors: { allowOrigin: "none" } });
    expect((await preflight(created, "/Server/InnovatorServer.aspx")).headers.get("access-control-allow-origin")).toBeNull();
    expect((await preflight(created, "/OAuthServer/connect/token")).headers.get("access-control-allow-origin")).toBe("http://page.example");
  });

  it("is never sent the session state hint, and is sent the read-only hint only when the caller asks (HOST-232)", async () => {
    const created = await scenario({ engine: "12.0" });
    const hints: [string, string][] = [
      ["Aras-Set-HttpSessionState-Behavior", "switch_to_initial"],
      ["Aras-Request-ReadOnly", "1"],
    ];
    const url = `${created.url}/Server/OAuthServerDiscovery.aspx`;
    await createFetchTransport().send(request(url, { headers: hints }));
    await createFetchTransport({ sendReadOnlyHint: true }).send(request(url, { headers: hints }));
    const [plain, asked] = (await seen(created)).seen;
    expect(plain?.headers.map(([name]) => name.toLowerCase())).not.toContain("aras-set-httpsessionstate-behavior");
    expect(plain?.headers.map(([name]) => name.toLowerCase())).not.toContain("aras-request-readonly");
    expect(asked?.headers.map(([name]) => name.toLowerCase())).not.toContain("aras-set-httpsessionstate-behavior");
    expect(asked?.headers.find(([name]) => name.toLowerCase() === "aras-request-readonly")?.[1]).toBe("1");
  });

  it("records the preflights apart from the requests", async () => {
    const created = await scenario({ engine: "14.0.7" });
    await preflight(created, "/Server/InnovatorServer.aspx");
    await fetch(`${created.url}/Server/OAuthServerDiscovery.aspx`);
    expect((await seen(created)).seen.map((entry) => [entry.method, entry.preflight])).toEqual([
      ["OPTIONS", true],
      ["GET", false],
    ]);
  });
});

describe("the scripted faults (HOST-234)", () => {
  it("answers a status with its reason phrase, or with none, as HTTP/2 does", async () => {
    const created = await scenario({
      engine: "14.0.7",
      faults: [{ match: { pathEnds: "/a" }, action: { status: 500 } }, { match: { pathEnds: "/b" }, action: { status: 500, reason: "" } }],
    });
    expect(await statusLine(`${created.url}/a`)).toBe("HTTP/1.1 500 Internal Server Error");
    expect(await statusLine(`${created.url}/b`)).toBe("HTTP/1.1 500 ");
  });

  it("applies a fault to the matching requests it was told to, once by default", async () => {
    const created = await scenario({
      engine: "14.0.7",
      faults: [{ match: { pathEnds: "/OAuthServerDiscovery.aspx" }, skip: 1, action: { status: 503 } }],
    });
    const get = async (): Promise<number> => (await fetch(`${created.url}/Server/OAuthServerDiscovery.aspx`)).status;
    expect([await get(), await get(), await get()]).toEqual([200, 503, 200]);
  });

  it("matches on the SOAP action and the method", async () => {
    const created = await scenario({ engine: "14.0.7", faults: [{ match: { soapAction: "ApplyAML", method: "POST" }, times: 2, action: { status: 401 } }] });
    const call = async (action: string): Promise<number> =>
      (await fetch(`${created.url}/Server/InnovatorServer.aspx`, { method: "POST", headers: { SOAPAction: action }, body: "<AML/>" })).status;
    expect([await call("ApplyAML"), await call("Logoff"), await call("ApplyAML"), await call("ApplyAML")]).toEqual([401, 200, 401, 200]);
  });

  it("delays the headers, and the transport times out on them", async () => {
    const created = await scenario({ engine: "14.0.7", faults: [{ match: {}, action: { delayMs: 600 } }] });
    const transport = createFetchTransport();
    await expect(transport.send(request(`${created.url}/Server/OAuthServerDiscovery.aspx`, { responseTimeoutMs: 100 }))).rejects.toMatchObject({
      failure: "timeout",
      message: "The operation has timed out",
    });
  });

  it("stalls the body, and the transport's read timer fires, while a long enough timer reads it whole", async () => {
    const created = await scenario({ engine: "14.0.7", faults: [{ match: {}, times: 2, action: { stallBody: { afterBytes: 5, ms: 500 } } }] });
    const transport = createFetchTransport();
    const url = `${created.url}/Server/OAuthServerDiscovery.aspx`;
    await expect(transport.send(request(url, { readTimeoutMs: 100 }))).rejects.toMatchObject({ failure: "timeout" });
    const whole = await transport.send(request(url, { readTimeoutMs: 5_000 }));
    expect(new TextDecoder().decode(whole.body)).toContain(`${created.url}/OAuthServer/`);
  });

  it("drops the connection, and the transport reports the one class of a browser", async () => {
    const created = await scenario({ engine: "14.0.7", faults: [{ match: {}, action: { destroy: true } }] });
    await expect(createFetchTransport().send(request(`${created.url}/Server/OAuthServerDiscovery.aspx`))).rejects.toMatchObject({
      failure: "refused",
      message: "Unable to connect to the remote server",
    });
  });
});

describe("a listener of its own (HOST-234)", () => {
  it("is served until it is stopped, and then refuses connections", async () => {
    const created = await scenario({ engine: "14.0.7", ownListener: true });
    expect(created.origin).not.toBe(server.origin);
    expect((await fetch(`${created.url}/Server/OAuthServerDiscovery.aspx`)).status).toBe(200);
    expect((await fetch(`${server.origin}/__control/scenarios/${created.id}/stop`, { method: "POST" })).status).toBe(200);
    await expect(createFetchTransport().send(request(`${created.url}/Server/OAuthServerDiscovery.aspx`))).rejects.toMatchObject({
      failure: "refused",
      message: "Unable to connect to the remote server",
    });
  });
});

describe("a recorded export run, end to end over HTTP (HOST-234)", () => {
  it.each(["12.0", "14.0.7", "14.35"] as const)("exports e32-item-report on %s through connect, the fetch transport and this server", async (engine) => {
    const created = await scenario({ engine, recorded: { name: "e32-item-report" } });
    const dir = new URL(`../../fixtures/${engine}/export/e32-item-report/`, import.meta.url);
    const input = JSON.parse(readFileSync(new URL("case.json", dir), "utf8")) as { packages: Array<{ name: string }> };
    const level = /^Export level: (.*)\r$/m.exec(readFileSync(new URL("engine.log", dir), "utf8"))?.[1] ?? "";
    const session = await connect({ ...LOGIN, url: created.url, engine, transport: createFetchTransport() });
    const result = await exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...(level === "" ? {} : { level }) });
    await session.close();
    const log = await seen(created);
    expect(log.mismatches).toEqual([]);
    expect(result.files.size).toBeGreaterThan(0);
    const soap = log.seen.filter((entry) => entry.path.endsWith("/InnovatorServer.aspx"));
    expect(soap.at(-1)?.headers.find(([name]) => name === "SOAPAction")?.[1]).toBe("Logoff");
  });
});
