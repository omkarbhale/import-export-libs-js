import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TransportError, type TransportRequest } from "../client/transport.js";
import { nodeTransport } from "../host/node-transport.js";
import { createFetchTransport, FORBIDDEN_REQUEST_HEADERS, reasonPhrase } from "./fetch-transport.js";

/**
 * The browser's transport, run under Node's own `fetch` against a local server, as `client/transport.test.ts` runs `nodeTransport`.
 * The same code runs in the browsers in the browser suites.
 * @spec HOST-230 HOST-231 HOST-232 HOST-233
 */
interface Seen {
  method: string;
  url: string;
  rawHeaders: string[];
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const seen: Seen[] = [];
const BIG = Buffer.alloc(5 * 1024 * 1024);
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 31 + (i >> 8)) & 0xff;

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", rawHeaders: req.rawHeaders, headers: req.headers, body: Buffer.concat(chunks) });
    switch (req.url) {
      case "/slow": // never answers
        return;
      case "/late": // answers after a while
        return void setTimeout(() => res.writeHead(200, "OK").end("late"), 250);
      case "/stall": // sends the headers and the start of a body, then stops
        res.writeHead(200, "OK", { "Content-Length": "100" });
        return void res.write("start");
      case "/drip": // keeps sending, slower than the whole read timeout but faster than a stall
        res.writeHead(200, "OK", { "Content-Type": "text/plain" });
        for (let i = 1; i <= 5; i++) setTimeout(() => (i < 5 ? res.write(`${i},`) : res.end("5")), i * 60);
        return;
      case "/cut": // promises more than it sends, then drops the connection
        res.writeHead(200, "OK", { "Content-Length": "1000" });
        res.write("partial");
        return void setTimeout(() => res.socket?.destroy(), 30);
      case "/cookies":
        res.writeHead(200, { "Set-Cookie": ["a=1; path=/", "b=2; path=/"], "X-Twice": "one" });
        return void res.end("cookies");
      case "/bad":
        res.writeHead(400, "Bad Request", { "Content-Type": "text/xml" });
        return void res.end("<bad/>");
      case "/error":
        res.writeHead(500, "Internal Server Error", { "Content-Type": "text/xml" });
        return void res.end("<fault/>");
      case "/teapot":
        res.writeHead(418, "I'm a teapot");
        return void res.end("tea");
      case "/redirect":
        res.writeHead(302, { Location: "/target" });
        return void res.end();
      case "/target":
        res.writeHead(200, "OK");
        return void res.end("landed");
      case "/big":
        res.writeHead(200, "OK", { "Content-Type": "application/octet-stream" });
        return void res.end(BIG);
      case "/empty":
        res.writeHead(204, "No Content");
        return void res.end();
      default:
        res.writeHead(200, "OK", { "Content-Type": "text/xml" });
        res.end("<ok/>");
    }
  });
});
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function get(path: string, over: Partial<TransportRequest> = {}): TransportRequest {
  return { method: "GET", url: `${base}${path}`, headers: [], responseTimeoutMs: 5000, readTimeoutMs: 5000, ...over };
}
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString();

describe("createFetchTransport: the request (HOST-232, HOST-233)", () => {
  it("sends the headers in the order given and the body as it is", async () => {
    const transport = createFetchTransport();
    const body = new TextEncoder().encode("<?xml version='1.0' encoding='utf-8' ?><Item />");
    const response = await transport.send({
      method: "POST",
      url: `${base}/Server/InnovatorServer.aspx`,
      headers: [
        ["Content-Type", "text/xml"],
        ["LOCALE", "en-US"],
        ["TIMEZONE_NAME", "UTC"],
        ["SOAPAction", "ValidateUser"],
        ["Authorization", "Bearer t"],
      ],
      body,
      responseTimeoutMs: 5000,
      readTimeoutMs: 5000,
    });
    expect([response.status, response.reason, text(response.body)]).toEqual([200, "OK", "<ok/>"]);
    const request = seen.at(-1)!;
    expect(request.method).toBe("POST");
    expect(request.body.equals(Buffer.from(body))).toBe(true);
    const sent = ["Content-Type", "LOCALE", "TIMEZONE_NAME", "SOAPAction", "Authorization"].map((name) => name.toLowerCase());
    const names = request.rawHeaders.filter((_, i) => i % 2 === 0).map((name) => name.toLowerCase());
    expect(names.filter((name) => sent.includes(name))).toEqual(sent);
    expect(request.headers["locale"]).toBe("en-US");
    expect(request.headers["soapaction"]).toBe("ValidateUser");
  });

  it("drops the forbidden header names from the wire, in any case, and leaves the recorded request as it was", async () => {
    const body = new TextEncoder().encode("<Item/>");
    const headers: [string, string][] = [
      ["Content-Type", "text/xml"],
      ["Host", "evil.example"],
      ["cookie", "ASP.NET_SessionId=abc"],
      ["Content-Length", "9999"],
      ["CONNECTION", "close"],
      ["Expect", "100-continue"],
      ["accept-encoding", "br"],
      ["User-Agent", "not-a-browser"],
      ["LOCALE", "en-US"],
    ];
    const request: TransportRequest = { method: "POST", url: `${base}/x`, headers, body, responseTimeoutMs: 5000, readTimeoutMs: 5000 };
    const recorded = structuredClone({ ...request, body: [...body] });
    await createFetchTransport().send(request);
    expect(request.headers).toBe(headers);
    expect(structuredClone({ ...request, body: [...body] })).toEqual(recorded);
    expect(headers).toHaveLength(9);

    const wire = seen.at(-1)!;
    expect(wire.headers.cookie).toBeUndefined();
    expect(wire.headers.host).toBe(new URL(base).host);
    expect(wire.headers["content-length"]).toBe(String(body.length));
    expect(wire.headers.connection).not.toBe("close");
    expect(wire.headers.expect).toBeUndefined();
    expect(wire.headers["accept-encoding"]).not.toBe("br");
    expect(wire.headers["user-agent"]).not.toBe("not-a-browser");
    expect(wire.headers.locale).toBe("en-US");
  });

  it("lists exactly the seven forbidden names", () => {
    expect([...FORBIDDEN_REQUEST_HEADERS].sort()).toEqual(["accept-encoding", "connection", "cookie", "content-length", "expect", "host", "user-agent"].sort());
  });

  it("sends the read-only hint only when asked to", async () => {
    const headers: [string, string][] = [["Aras-Request-ReadOnly", "1"]];
    await createFetchTransport().send(get("/x", { headers }));
    expect(seen.at(-1)!.headers["aras-request-readonly"]).toBeUndefined();
    await createFetchTransport({ sendReadOnlyHint: true }).send(get("/x", { headers }));
    expect(seen.at(-1)!.headers["aras-request-readonly"]).toBe("1");
  });

  it("calls fetch with redirect follow, no cache, cors, and omitted credentials by default", async () => {
    const inits: RequestInit[] = [];
    const fake: typeof fetch = async (_input, init) => {
      inits.push(init ?? {});
      return new Response("", { status: 200, statusText: "OK" });
    };
    await createFetchTransport({ fetch: fake }).send(get("/x"));
    await createFetchTransport({ fetch: fake, credentials: "same-origin" }).send(get("/x"));
    await createFetchTransport({ fetch: fake, credentials: "include" }).send(get("/x"));
    expect(inits.map((init) => init.credentials)).toEqual(["omit", "same-origin", "include"]);
    for (const init of inits) {
      expect(init).toMatchObject({ method: "GET", redirect: "follow", cache: "no-store", mode: "cors" });
      expect(init.body).toBeUndefined();
    }
  });

  it("follows a redirect", async () => {
    const response = await createFetchTransport().send(get("/redirect"));
    expect([response.status, text(response.body)]).toEqual([200, "landed"]);
  });
});

describe("createFetchTransport: the response (HOST-232, HOST-233)", () => {
  it("returns 200, 400 and 500 with their reasons and bodies", async () => {
    const transport = createFetchTransport();
    const results = await Promise.all(["/ok", "/bad", "/error"].map((path) => transport.send(get(path))));
    expect(results.map((r) => [r.status, r.reason, text(r.body)])).toEqual([
      [200, "OK", "<ok/>"],
      [400, "Bad Request", "<bad/>"],
      [500, "Internal Server Error", "<fault/>"],
    ]);
  });

  it("keeps the server's own reason phrase, a status the table does not know included", async () => {
    const response = await createFetchTransport().send(get("/teapot"));
    expect([response.status, response.reason]).toEqual([418, "I'm a teapot"]);
  });

  it("fills an empty statusText from the standard phrase of the status", async () => {
    const answer =
      (status: number, statusText: string): typeof fetch =>
      async () =>
        new Response(status === 204 ? null : "body", { status, statusText });
    const reasons = async (status: number, statusText: string) =>
      (await createFetchTransport({ fetch: answer(status, statusText) }).send(get("/x"))).reason;
    expect(await reasons(500, "")).toBe("Internal Server Error");
    expect(await reasons(400, "")).toBe("Bad Request");
    expect(await reasons(401, "")).toBe("Unauthorized");
    expect(await reasons(204, "")).toBe("No Content");
    expect(await reasons(599, "")).toBe("");
    expect(await reasons(500, "Server Fault")).toBe("Server Fault");
  });

  it("has a phrase for each of the 40 final statuses a server answers with, and none for the rest", () => {
    const known = Array.from({ length: 600 }, (_, status) => status).filter((status) => reasonPhrase(status) !== "");
    expect(known).toHaveLength(40);
    expect(known.every((status) => status >= 200)).toBe(true);
    expect(reasonPhrase(200)).toBe("OK");
    expect(reasonPhrase(500)).toBe("Internal Server Error");
    expect(reasonPhrase(505)).toBe("HTTP Version Not Supported");
  });

  it("returns lower-case header names, repeated values combined, and no body for a 204", async () => {
    const response = await createFetchTransport().send(get("/cookies"));
    expect(response.headers.every(([name]) => name === name.toLowerCase())).toBe(true);
    expect(response.headers.find(([name]) => name === "x-twice")).toEqual(["x-twice", "one"]);
    const empty = await createFetchTransport().send(get("/empty"));
    expect([empty.status, empty.reason, empty.body.length]).toEqual([204, "No Content", 0]);
  });

  it("reads a body of 5 MB, whole and byte for byte, with and without a read timeout", async () => {
    const withTimeout = await createFetchTransport().send(get("/big"));
    expect(withTimeout.body.length).toBe(BIG.length);
    expect(Buffer.from(withTimeout.body).equals(BIG)).toBe(true);
    const without = await createFetchTransport().send(get("/big", { readTimeoutMs: 0 }));
    expect(Buffer.from(without.body).equals(BIG)).toBe(true);
  });
});

describe("createFetchTransport: failures (HOST-231)", () => {
  it("fails with a timeout when no response arrives in time", async () => {
    const error = await createFetchTransport().send(get("/slow", { responseTimeoutMs: 100, readTimeoutMs: 0 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ failure: "timeout", message: "The operation has timed out", host: "127.0.0.1" });
  });

  it("fails with a timeout when the body stalls between chunks", async () => {
    const started = Date.now();
    const error = await createFetchTransport().send(get("/stall", { responseTimeoutMs: 5000, readTimeoutMs: 150 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ failure: "timeout", message: "The operation has timed out" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("does not time out a body that keeps arriving, however long it takes in all", async () => {
    const response = await createFetchTransport().send(get("/drip", { readTimeoutMs: 200 }));
    expect([response.status, text(response.body)]).toEqual([200, "1,2,3,4,5"]);
  });

  it("waits for ever when a timeout is 0 or less", async () => {
    const response = await createFetchTransport().send(get("/late", { responseTimeoutMs: 0, readTimeoutMs: -1 }));
    expect([response.status, text(response.body)]).toEqual([200, "late"]);
  });

  it("does not let a timer outlive an exchange", async () => {
    const before = process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
    await createFetchTransport().send(get("/ok", { responseTimeoutMs: 60_000, readTimeoutMs: 60_000 }));
    await createFetchTransport().send(get("/big", { responseTimeoutMs: 60_000, readTimeoutMs: 60_000 }));
    expect(process.getActiveResourcesInfo().filter((name) => name === "Timeout").length).toBeLessThanOrEqual(before);
  });

  it("fails with 'refused' when nothing listens", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const error = await createFetchTransport().send({ method: "GET", url: `http://127.0.0.1:${port}/`, headers: [], responseTimeoutMs: 5000, readTimeoutMs: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ failure: "refused", message: "Unable to connect to the remote server", host: "127.0.0.1" });
  });

  it("reports a name that does not resolve as 'refused' too, as a browser cannot tell the two apart", async () => {
    const error = await createFetchTransport().send(get("/", { url: "http://no-such-host.invalid/" })).catch((e: unknown) => e);
    expect(error).toMatchObject({ failure: "refused", message: "Unable to connect to the remote server", host: "no-such-host.invalid" });
  });

  it("reports any TypeError of fetch as 'refused'", async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const error = await createFetchTransport({ fetch: failing }).send(get("/x")).catch((e: unknown) => e);
    expect(error).toMatchObject({ failure: "refused", message: "Unable to connect to the remote server" });
  });

  it("reports a connection dropped in the middle of the body as 'other'", async () => {
    const error = await createFetchTransport().send(get("/cut")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ failure: "other" });
  });

  it("rethrows the abort of a caller's signal as it is, not as a TransportError", async () => {
    const controller = new AbortController();
    const pending = createFetchTransport({ signal: controller.signal }).send(get("/slow", { responseTimeoutMs: 0 }));
    setTimeout(() => controller.abort(), 50);
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ name: "AbortError" });

    const already = new AbortController();
    already.abort();
    const early = await createFetchTransport({ signal: already.signal }).send(get("/ok")).catch((e: unknown) => e);
    expect(early).toMatchObject({ name: "AbortError" });

    const midBody = new AbortController();
    const reading = createFetchTransport({ signal: midBody.signal }).send(get("/stall", { readTimeoutMs: 0 }));
    setTimeout(() => midBody.abort(new Error("cancelled by the page")), 80);
    expect(await reading.catch((e: unknown) => e)).toMatchObject({ message: "cancelled by the page" });
  });
});

describe("createFetchTransport and nodeTransport", () => {
  it("answer the same status, reason and body for the same server", async () => {
    for (const path of ["/ok", "/bad", "/error", "/teapot", "/empty", "/big"]) {
      const request = get(path);
      const [fetched, node] = await Promise.all([createFetchTransport().send(request), nodeTransport.send(request)]);
      expect([fetched.status, fetched.reason, Buffer.from(fetched.body).equals(Buffer.from(node.body))], path).toEqual([node.status, node.reason, true]);
      const content = (headers: TransportRequest["headers"]) => headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
      expect(content(fetched.headers), path).toBe(content(node.headers));
    }
  });

  it("fail with a timeout in the same way, and with 'refused' for a closed port", async () => {
    const slow = get("/slow", { responseTimeoutMs: 80, readTimeoutMs: 0 });
    const [a, b] = await Promise.all([createFetchTransport().send(slow).catch((e: unknown) => e), nodeTransport.send(slow).catch((e: unknown) => e)]);
    expect([a, b].map((e) => [(e as TransportError).failure, (e as TransportError).message])).toEqual([
      ["timeout", "The operation has timed out"],
      ["timeout", "The operation has timed out"],
    ]);
  });
});
