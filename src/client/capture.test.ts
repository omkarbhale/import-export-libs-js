import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { HttpConnectorExtension } from "./connection.js";
import { FakeTransport, respond } from "./fake-transport.js";
import { CItemHelper } from "./item-helper.js";
import { forgetAccessibleOAuthServer } from "./oauth.js";

interface Exchange {
  seq: number;
  request: { method: string; url: string; headers: [string, string][]; body: string };
  response: {
    status: number;
    headers: [string, string][];
    body: string | { length: number; sha256: string };
    clientBody?: string;
  };
}

/** What differs between the captures: the engine, the exchange of the token request, and the span of the export's requests. */
const CAPTURES = [
  { engine: "14.0.7", tokenSeq: 4, exportRequests: [10, 34], version: "12.0 SP9 Build 24090" },
  { engine: "12.0", tokenSeq: 3, exportRequests: [8, 31], version: undefined },
] as const;

function readExchanges(engine: string): Exchange[] {
  return readFileSync(new URL(`../../fixtures/wire/${engine}-reference-host/capture.jsonl`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Exchange);
}

const EMPTY_RESULT =
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result /></SOAP-ENV:Body></SOAP-ENV:Envelope>';
/** Headers .NET adds below the contract (WIRE-005's port note). */
const TRANSPORT_ONLY = new Set(["connection", "expect"]);

describe.each(CAPTURES)("the $engine reference host's wire capture, replayed through the client", ({ engine, tokenSeq, exportRequests, version }) => {
  const exchanges = readExchanges(engine);
  beforeEach(() => forgetAccessibleOAuthServer());

  it("sends the capture's requests: discovery, token, ValidateUser, user record, probe, export requests, logoff", async () => {
    const mismatches: string[] = [];
    const transport = new FakeTransport((request, index) => {
      const expected = exchanges[index];
      if (!expected) throw new Error(`unexpected request ${index + 1}: ${request.url}`);
      const label = `#${expected.seq}`;
      const url = new URL(request.url);
      if (request.method !== expected.request.method) mismatches.push(`${label} method ${request.method}`);
      if (`${url.pathname}${url.search}` !== expected.request.url) mismatches.push(`${label} url ${url.pathname}`);
      // The token request's length differs only because the capture holds the digest as SCRUBBED.
      const skipped = (name: string) => TRANSPORT_ONLY.has(name.toLowerCase()) || (expected.seq === tokenSeq && name === "Content-Length");
      const ours = request.headers.filter(([name]) => !skipped(name));
      const theirs = expected.request.headers.filter(([name]) => !skipped(name));
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        mismatches.push(`${label} headers ${JSON.stringify(ours)} != ${JSON.stringify(theirs)}`);
      }
      const body = Buffer.from(request.body ?? new Uint8Array()).toString("utf8");
      // The capture holds the password digest as SCRUBBED; the form field order and the rest are real.
      const comparable = expected.seq === tokenSeq ? body.replace(/password=[0-9a-f]+$/, "password=SCRUBBED") : body;
      if (comparable !== expected.request.body) mismatches.push(`${label} body ${JSON.stringify(comparable)}`);
      const sent = expected.response;
      return respond(typeof sent.body === "string" ? (sent.clientBody ?? sent.body) : EMPTY_RESULT, {
        status: sent.status,
        headers: sent.headers,
      });
    });

    const connection = new HttpConnectorExtension({
      url: "http://localhost:18089/12sp9",
      database: "12sp9",
      userName: "admin",
      password: "not-the-real-password",
      timeZoneName: "India Standard Time",
      transport,
      engine,
    });
    const helper = new CItemHelper(connection, { engine });
    await helper.login();
    if (version) expect(helper.innovatorVersion?.fullString).toBe(version);
    expect(helper.innovatorVersion).toMatchObject({ major: 12, minor: 0, servicePack: 9 });

    for (const exchange of exchanges.slice(...exportRequests)) {
      const action = exchange.request.headers.find(([name]) => name === "SOAPAction")?.[1] ?? "";
      const aml = exchange.request.body.replace("<?xml version='1.0' encoding='utf-8' ?>", "");
      await connection.callAction(action, aml);
    }
    await helper.logout();

    expect(transport.requests).toHaveLength(exchanges.length);
    expect(mismatches).toEqual([]);
  });
});
