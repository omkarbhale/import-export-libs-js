import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunningProxy, startProxy } from "./proxy.js";

/**
 * The reverse proxy of the browser parity run (HOST-277) against a local server that records what it was sent: the bytes of a body
 * both ways, the status line, the headers with their case and the repeated ones, and what the proxy adds and drops.
 */

interface Seen {
  method: string;
  url: string;
  rawHeaders: string[];
  body: Buffer;
}

let upstream: Server;
let proxy: RunningProxy;
let seen: Seen[] = [];
let folder: string;
/** What the upstream answers next. */
let answer: (request: IncomingMessage, response: ServerResponse, body: Buffer) => void = (_request, response) => response.end("ok");

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

beforeAll(async () => {
  upstream = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: request.method ?? "", url: request.url ?? "", rawHeaders: request.rawHeaders, body });
      answer(request, response, body);
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  folder = mkdtempSync(join(tmpdir(), "libsjs-proxy-test-"));
  writeFileSync(join(folder, "index.html"), "<p>page</p>");
  proxy = await startProxy({ target: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/12sp9`, staticRoot: folder });
});

afterAll(async () => {
  await proxy.close();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

/** A request to the proxy with the raw headers it is given; the answer's raw headers, status line and body. */
function call(
  path: string,
  options: { method?: string; headers?: Record<string, string | string[]>; body?: Buffer } = {},
): Promise<{ status: number; message: string; rawHeaders: string[]; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(proxy.origin);
    const req = httpRequest({ host: url.hostname, port: url.port, path, method: options.method ?? "GET", headers: options.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, message: res.statusMessage ?? "", rawHeaders: res.rawHeaders, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

const headerValues = (raw: readonly string[], name: string): string[] => raw.flatMap((value, at) => (at % 2 === 0 && value.toLowerCase() === name.toLowerCase() ? [raw[at + 1] as string] : []));

describe("the parity proxy: what it passes through", () => {
  it("returns the address a page uses: the proxy's origin with the server's path", () => {
    expect(proxy.url).toBe(`${proxy.origin}/12sp9`);
  });

  it("passes a 5 MB request body to the server and a 5 MB response body back, byte for byte", async () => {
    const out = randomBytes(5 * 1024 * 1024);
    const back = randomBytes(5 * 1024 * 1024 + 17);
    seen = [];
    answer = (_request, response) => response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": back.length }).end(back);
    const got = await call("/12sp9/Server/InnovatorServer.aspx", { method: "POST", headers: { "Content-Type": "text/xml", "Content-Length": String(out.length) }, body: out });
    expect(seen).toHaveLength(1);
    expect(sha256(seen[0]!.body)).toBe(sha256(out));
    expect(sha256(got.body)).toBe(sha256(back));
    expect(got.status).toBe(200);
  });

  it("passes a chunked response of unknown length and a compressed body untouched", async () => {
    const compressed = Buffer.from("1f8b0800000000000003cb48cdc9c9070086a6103605000000", "hex");
    answer = (_request, response) => {
      response.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "text/xml" });
      response.write(compressed.subarray(0, 7));
      response.end(compressed.subarray(7));
    };
    const got = await call("/12sp9/x", { headers: { "Accept-Encoding": "gzip" } });
    expect(got.body.equals(compressed)).toBe(true);
    expect(headerValues(got.rawHeaders, "content-encoding")).toEqual(["gzip"]);
    expect(seen.at(-1)?.rawHeaders).toContain("Accept-Encoding");
  });

  it("keeps the status line, the headers with their case, and a repeated Set-Cookie apart", async () => {
    answer = (_request, response) => {
      response.writeHead(500, "Internal Server Error", [
        ["Set-Cookie", "ASP.NET_SessionId=abc; path=/; HttpOnly"],
        ["Set-Cookie", "other=1; path=/"],
        ["X-Aras-Mixed-Case", "yes"],
        ["Content-Type", "text/xml; charset=utf-8"],
      ]);
      response.end("<fault/>");
    };
    const got = await call("/12sp9/x");
    expect(got.status).toBe(500);
    expect(got.message).toBe("Internal Server Error");
    expect(headerValues(got.rawHeaders, "Set-Cookie")).toEqual(["ASP.NET_SessionId=abc; path=/; HttpOnly", "other=1; path=/"]);
    expect(got.rawHeaders).toContain("X-Aras-Mixed-Case");
    expect(got.body.toString()).toBe("<fault/>");
  });

  it("passes an empty reason phrase on (what HTTP/2 puts on the wire)", async () => {
    answer = (_request, response) => response.writeHead(200, "", { "Content-Length": "0" }).end();
    const got = await call("/12sp9/x");
    expect(got.status).toBe(200);
    expect(got.message).toBe("");
  });

  it("sends the request's headers on with their names' case, and names the server as the host", async () => {
    seen = [];
    answer = (_request, response) => response.end("ok");
    await call("/12sp9/Server/InnovatorServer.aspx", {
      method: "POST",
      headers: { SOAPAction: "ApplyItem", LOCALE: "en-US", TIMEZONE_NAME: "UTC", Authorization: "Bearer test-token", Cookie: "a=1; b=2" },
      body: Buffer.from("<AML/>"),
    });
    const sent = seen[0]!;
    expect(sent.rawHeaders).toEqual(expect.arrayContaining(["SOAPAction", "ApplyItem", "LOCALE", "en-US", "TIMEZONE_NAME", "UTC", "Authorization", "Bearer test-token", "Cookie", "a=1; b=2"]));
    expect(headerValues(sent.rawHeaders, "host")).toEqual([new URL(proxy.origin).hostname === "127.0.0.1" ? `127.0.0.1:${(upstream.address() as AddressInfo).port}` : ""]);
    expect(sent.url).toBe("/12sp9/Server/InnovatorServer.aspx");
    expect(sent.body.toString()).toBe("<AML/>");
  });

  it("drops the hop-by-hop headers in both directions", async () => {
    seen = [];
    answer = (_request, response) => {
      response.writeHead(200, { "Keep-Alive": "timeout=5", "Proxy-Authenticate": "x", "X-Kept": "1" });
      response.end("ok");
    };
    const got = await call("/12sp9/x", { headers: { "Proxy-Authorization": "secret", "TE": "trailers" } });
    expect(headerValues(seen[0]!.rawHeaders, "proxy-authorization")).toEqual([]);
    expect(headerValues(got.rawHeaders, "keep-alive")).toEqual([]);
    expect(headerValues(got.rawHeaders, "proxy-authenticate")).toEqual([]);
    expect(headerValues(got.rawHeaders, "x-kept")).toEqual(["1"]);
  });
});

describe("the parity proxy: what it adds", () => {
  it("answers a preflight itself, with the headers the browser asks for, and does not forward it", async () => {
    seen = [];
    const got = await call("/12sp9/Server/InnovatorServer.aspx", {
      method: "OPTIONS",
      headers: { Origin: "http://page.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,locale,soapaction,timezone_name,authorization" },
    });
    expect(got.status).toBe(204);
    expect(headerValues(got.rawHeaders, "access-control-allow-origin")).toEqual(["http://page.example"]);
    expect(headerValues(got.rawHeaders, "access-control-allow-credentials")).toEqual(["true"]);
    expect(headerValues(got.rawHeaders, "access-control-allow-headers")).toEqual(["content-type,locale,soapaction,timezone_name,authorization"]);
    expect(seen).toEqual([]);
  });

  it("adds Allow-Origin and Allow-Credentials to a response that has none, and nothing to a request without an Origin", async () => {
    answer = (_request, response) => response.end("ok");
    const withOrigin = await call("/12sp9/x", { headers: { Origin: "http://page.example" } });
    expect(headerValues(withOrigin.rawHeaders, "access-control-allow-origin")).toEqual(["http://page.example"]);
    expect(headerValues(withOrigin.rawHeaders, "access-control-allow-credentials")).toEqual(["true"]);
    const without = await call("/12sp9/x");
    expect(headerValues(without.rawHeaders, "access-control-allow-origin")).toEqual([]);
  });

  it("answers 502 with the reason when the server cannot be reached, and counts what it forwarded", async () => {
    const dead = await startProxy({ target: "http://127.0.0.1:1/12sp9" });
    try {
      const url = new URL(dead.origin);
      const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        httpRequest({ host: url.hostname, port: url.port, path: "/12sp9/x", agent: false }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
        })
          .on("error", reject)
          .end();
      });
      expect(result.status).toBe(502);
      expect(result.text).toMatch(/could not reach the server/);
      expect(dead.forwarded()).toBe(1);
    } finally {
      await dead.close();
    }
  });
});

describe("the parity proxy: the upstream's CORS headers", () => {
  it("replaces them, whatever their case, with its own", async () => {
    answer = (_request, response) => {
      response.writeHead(200, [
        ["ACCESS-control-allow-ORIGIN", "*"],
        ["Access-Control-Allow-Headers", "content-type"],
        ["X-Kept", "1"],
      ]);
      response.end("ok");
    };
    const got = await call("/12sp9/Server/InnovatorServer.aspx", { headers: { Origin: "http://page.example" } });
    expect(headerValues(got.rawHeaders, "access-control-allow-origin")).toEqual(["http://page.example"]);
    expect(headerValues(got.rawHeaders, "access-control-allow-headers")).toEqual([]);
    expect(headerValues(got.rawHeaders, "x-kept")).toEqual(["1"]);
  });
});

describe("the parity proxy: the OAuth discovery answers", () => {
  const own = (): string => `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const json = (got: { body: Buffer }): Record<string, unknown> => JSON.parse(got.body.toString()) as Record<string, unknown>;

  it("gives the page the locations of OAuthServerDiscovery.aspx on the proxy's origin, with the right Content-Length", async () => {
    answer = (_request, response) => {
      const body = JSON.stringify({ locations: [{ uri: `${own()}/12sp9/OAuthServer/` }] });
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }).end(body);
    };
    const got = await call("/12sp9/Server/OAuthServerDiscovery.aspx");
    expect(json(got)).toEqual({ locations: [{ uri: `${proxy.origin}/12sp9/OAuthServer/` }] });
    expect(headerValues(got.rawHeaders, "content-length")).toEqual([String(got.body.length)]);
  });

  it("gives the page the endpoints of a chunked OpenID configuration on the proxy's origin, and leaves other hosts alone", async () => {
    answer = (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(`{"token_endpoint":"${own()}/OAuthServer/connect/token",`);
      response.end(`"jwks_uri":"${own().replace(/\//g, "\\/")}/jwks","longer":"${own()}0/x","other":"http://elsewhere.example/x"}`);
    };
    const got = await call("/12sp9/OAuthServer/.well-known/openid-configuration");
    expect(json(got)).toEqual({
      token_endpoint: `${proxy.origin}/OAuthServer/connect/token`,
      jwks_uri: `${proxy.origin}/jwks`,
      longer: `${own()}0/x`,
      other: "http://elsewhere.example/x",
    });
    expect(headerValues(got.rawHeaders, "content-length")).toEqual([String(got.body.length)]);
  });

  it("asks for those answers uncompressed", async () => {
    seen = [];
    answer = (_request, response) => response.end("{}");
    await call("/12sp9/Server/OAuthServerDiscovery.aspx?x=1", { headers: { "Accept-Encoding": "gzip" } });
    expect(headerValues(seen[0]!.rawHeaders, "accept-encoding")).toEqual([]);
  });

  it("leaves a SOAP answer and the key set byte for byte, though they name the server's origin", async () => {
    const body = (): string => `<a href="${own()}/x"/>`;
    answer = (_request, response) => response.end(body());
    expect((await call("/12sp9/Server/InnovatorServer.aspx", { method: "POST", body: Buffer.from("<AML/>") })).body.toString()).toBe(body());
    expect((await call("/12sp9/OAuthServer/.well-known/openid-configuration/jwks")).body.toString()).toBe(body());
  });
});

describe("the parity proxy: the page's files", () => {
  it("serves the harness page below /__parity/ and keeps requests out of the folder above it", async () => {
    const page = await call("/__parity/index.html");
    expect(page.status).toBe(200);
    expect(headerValues(page.rawHeaders, "content-type")).toEqual(["text/html; charset=utf-8"]);
    expect(page.body.toString()).toBe("<p>page</p>");
    expect((await call("/__parity/")).body.toString()).toBe("<p>page</p>");
    expect((await call("/__parity/missing.js")).status).toBe(404);
    expect((await call("/__parity/..%2f..%2fetc%2fpasswd")).status).toBeGreaterThanOrEqual(403);
    seen = [];
    await call("/__parity/index.html");
    expect(seen).toEqual([]);
  });
});
