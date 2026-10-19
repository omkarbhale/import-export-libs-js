import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { HttpConnectorExtension } from "./connection.js";
import { CItemException } from "./fault.js";
import { FakeTransport, bodyText, header, respond } from "./fake-transport.js";
import type { TransportRequest } from "./transport.js";
import { TransportError } from "./transport.js";
import { CItemHelper } from "./item-helper.js";
import { forgetAccessibleOAuthServer } from "./oauth.js";

/**
 * The proxy captures of 14.35's reference host against dev (`fixtures/wire/14.35-reference-host/`, WIRE-002), replayed through
 * the client: the bytes below the AML, which the oracle's transcripts do not hold.
 */
interface Exchange {
  seq: number;
  aborted?: boolean;
  request: { method: string; url: string; headers: [string, string][]; body: string };
  response?: {
    status: number;
    headers: [string, string][];
    body: string | { length: number; sha256: string };
    clientBody?: string;
  };
}

function load(name: string): Exchange[] {
  return readFileSync(new URL(`../../fixtures/wire/14.35-reference-host/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Exchange);
}

const EMPTY_RESULT =
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result /></SOAP-ENV:Body></SOAP-ENV:Envelope>';
/** Headers .NET adds below the contract (WIRE-005's port note). */
const TRANSPORT_ONLY = new Set(["connection", "expect"]);
const MD5_HEX = "098f6bcd4621d373cade4e832627b4f6";

/** The server origin the capture's proxy listened on, which the client must be given for `Host` to match. */
const origin = (exchanges: Exchange[]): string => `http://${exchanges[0]!.request.headers.find(([name]) => name === "Host")![1]}/12sp9`;

/** The password the capture holds as `SCRUBBED` is whatever the test gave; the field order and the rest are real. */
const scrubPassword = (body: string): string => body.replace(/(^|&)password=[^&]*$/, "$1password=SCRUBBED");

/** Compares a request with the capture's: method, path, headers (names, values and order) and body. */
function compare(request: TransportRequest, expected: Exchange): string[] {
  const label = `#${expected.seq}`;
  const mismatches: string[] = [];
  const url = new URL(request.url);
  if (request.method !== expected.request.method) mismatches.push(`${label} method ${request.method}`);
  if (`${url.pathname}${url.search}` !== expected.request.url) mismatches.push(`${label} url ${url.pathname}`);
  const ours = request.headers.filter(([name]) => !TRANSPORT_ONLY.has(name.toLowerCase()));
  const theirs = expected.request.headers.filter(([name]) => !TRANSPORT_ONLY.has(name.toLowerCase()));
  if (JSON.stringify(ours) !== JSON.stringify(theirs)) mismatches.push(`${label} headers ${JSON.stringify(ours)} != ${JSON.stringify(theirs)}`);
  const body = scrubPassword(bodyText(request));
  if (body !== expected.request.body) mismatches.push(`${label} body ${JSON.stringify(body)}`);
  return mismatches;
}

function answer(expected: Exchange) {
  const sent = expected.response!;
  return respond(typeof sent.body === "string" ? (sent.clientBody ?? sent.body) : EMPTY_RESULT, { status: sent.status, headers: sent.headers });
}

describe("the 14.35 reference host's wire capture, replayed through the client", () => {
  beforeEach(() => forgetAccessibleOAuthServer());

  it("sends the capture's requests: discovery, token, ValidateUser, user record, probe, export requests, logoff", async () => {
    const exchanges = load("capture.jsonl");
    const mismatches: string[] = [];
    const transport = new FakeTransport((request, index) => {
      const expected = exchanges[index];
      if (!expected) throw new Error(`unexpected request ${index + 1}: ${request.url}`);
      mismatches.push(...compare(request, expected));
      return answer(expected);
    });
    const connection = new HttpConnectorExtension({
      engine: "14.35",
      url: origin(exchanges),
      database: "12sp9",
      userName: "admin",
      password: MD5_HEX,
      timeZoneName: "India Standard Time",
      transport,
    });
    const helper = new CItemHelper(connection, { engine: "14.35" });
    await helper.login();
    expect(helper.innovatorVersion?.fullString).toBe("12.0 SP9 Build 24090");
    expect(helper.isConnected).toBe(true);

    for (const exchange of exchanges.slice(10, exchanges.length - 1)) {
      const action = exchange.request.headers.find(([name]) => name === "SOAPAction")?.[1] ?? "";
      await connection.callAction(action, exchange.request.body.replace("<?xml version='1.0' encoding='utf-8' ?>", ""));
    }
    await helper.logout();

    expect(transport.requests).toHaveLength(exchanges.length);
    expect(mismatches).toEqual([]);
    expect(helper.isConnected).toBe(false);
  });

  it("sends the password as given, then its MD5 digest, and ends in the rejected login's fault", async () => {
    const exchanges = load("capture-rejected-login.jsonl");
    const mismatches: string[] = [];
    const transport = new FakeTransport((request, index) => {
      const expected = exchanges[index];
      if (!expected) throw new Error(`unexpected request ${index + 1}: ${request.url}`);
      mismatches.push(...compare(request, expected));
      return answer(expected);
    });
    const connection = new HttpConnectorExtension({
      engine: "14.35",
      url: origin(exchanges),
      database: "12sp9",
      userName: "libsjs-no-such-user",
      password: "libsjs-not-a-password",
      timeZoneName: "India Standard Time",
      transport,
    });
    const helper = new CItemHelper(connection, { engine: "14.35" });
    const error = (await helper.login().catch((e: unknown) => e)) as CItemException;
    expect(transport.requests).toHaveLength(5);
    expect(mismatches).toEqual([]);
    // The Content-Length of the capture is the real one (127 for the password as given, 138 for the digest).
    expect(transport.requests.slice(3).map((r) => header(r, "Content-Length"))).toEqual(["127", "138"]);
    expect(bodyText(transport.requests[4]!)).toMatch(/&password=[0-9a-f]{32}$/);
    expect(bodyText(transport.requests[3]!)).toMatch(/&password=libsjs-not-a-password$/);

    expect(error).toBeInstanceOf(CItemException);
    expect(error.faultcode).toBe(-100);
    expect(error.faultstring).toContain("<faultcode>invalid_grant</faultcode>");
    expect(error.faultstring).toContain("<faultstring>Authentication failed for libsjs-no-such-user</faultstring>");
    expect(error.faultstring).toContain("<faultactor>OAuthServer</faultactor>");
    expect(error.faultstring).toContain("<detail>unknown error</detail>");
    expect(helper.isConnected).toBe(true);
  });

  it("gives up on a discovery request that is held for 105 s: the login returns with no connection and nothing follows", async () => {
    const exchanges = load("capture-cancelled-login.jsonl");
    expect(exchanges[0]!.aborted).toBe(true);
    const mismatches: string[] = [];
    const transport = new FakeTransport((request) => {
      mismatches.push(...compare(request, exchanges[0]!));
      expect(request.responseTimeoutMs).toBe(100_000);
      throw new TransportError("timeout", "The operation has timed out", "localhost");
    });
    const connection = new HttpConnectorExtension({
      engine: "14.35",
      url: origin(exchanges),
      database: "12sp9",
      userName: "admin",
      password: MD5_HEX,
      transport,
    });
    const helper = new CItemHelper(connection, { engine: "14.35" });
    await expect(helper.login()).resolves.toBeUndefined();
    expect(mismatches).toEqual([]);
    expect(transport.requests).toHaveLength(1);
    expect([helper.isConnected, helper.innovatorVersion]).toEqual([false, undefined]);
    await expect(helper.applyAML("<Item type='List' action='get'/>")).rejects.toThrow("Object reference not set to an instance of an object.");
    await helper.logout();
    expect(transport.requests).toHaveLength(1);
  });

  it.each(["capture-parallel.jsonl", "capture-parallel-remote.jsonl"])(
    "shares one cookie jar, one token and one locale pair among the requests of %s that run together (WIRE-060)",
    async (file) => {
      const exchanges = load(file);
      const login = exchanges.slice(0, 10);
      const logoff = exchanges.at(-1)!;
      expect(logoff.request.headers.find(([name]) => name === "SOAPAction")?.[1]).toBe("Logoff");
      const items = exchanges.slice(10, -1);
      const key = (action: string | undefined, body: string) => `${action}\n${body}`;
      const bySoap = new Map<string, Exchange>();
      for (const exchange of items) {
        const action = exchange.request.headers.find(([name]) => name === "SOAPAction")?.[1];
        if (!bySoap.has(key(action, exchange.request.body))) bySoap.set(key(action, exchange.request.body), exchange);
      }

      let inFlight = 0;
      let maxInFlight = 0;
      const seen: TransportRequest[] = [];
      const transport = new FakeTransport(async (request, index) => {
        if (index < login.length) return answer(login[index]!);
        seen.push(request);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        const action = header(request, "SOAPAction");
        const expected = bySoap.get(key(action, bodyText(request))) ?? logoff;
        return answer(expected);
      });
      const connection = new HttpConnectorExtension({
        engine: "14.35",
        url: origin(exchanges),
        database: "12sp9",
        userName: "admin",
        password: MD5_HEX,
        timeZoneName: "India Standard Time",
        transport,
      });
      const helper = new CItemHelper(connection, { engine: "14.35" });
      await helper.login();

      const results = await Promise.all(
        [...bySoap.values()].map((exchange) =>
          connection.callAction(
            exchange.request.headers.find(([name]) => name === "SOAPAction")![1],
            exchange.request.body.replace("<?xml version='1.0' encoding='utf-8' ?>", ""),
          ),
        ),
      );
      await helper.logout();

      expect(results.every((r) => !r.isError || r.errorCode === "0")).toBe(true);
      expect(maxInFlight).toBeGreaterThan(2);
      const itemRequests = seen.filter((r) => header(r, "SOAPAction") !== "Logoff");
      expect(itemRequests.length).toBe(bySoap.size);
      const shared = (name: string) => new Set(itemRequests.map((r) => header(r, name)));
      expect([...shared("Cookie")]).toEqual(["ASP.NET_SessionId=SCRUBBED"]);
      expect(shared("Authorization").size).toBe(1);
      expect([...shared("LOCALE")]).toEqual(["en-US"]);
      expect([...shared("TIMEZONE_NAME")]).toEqual(["India Standard Time"]);
    },
  );
});
