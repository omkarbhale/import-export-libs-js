import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TransportError, nodeTransport } from "./transport.js";

interface Seen {
  method: string;
  url: string;
  rawHeaders: string[];
  headers: IncomingHttpHeaders;
  body: string;
}

const seen: Seen[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", rawHeaders: req.rawHeaders, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url === "/slow") return; // never answers
    if (req.url === "/cookies") {
      res.writeHead(200, { "Set-Cookie": ["a=1; path=/", "b=2; path=/"] });
      return void res.end("cookies");
    }
    if (req.url === "/error") {
      res.writeHead(500, "Internal Server Error");
      return void res.end("<fault/>");
    }
    res.writeHead(200, "OK", { "Content-Type": "text/xml" });
    res.end("<ok/>");
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

describe("nodeTransport", () => {
  it("sends the headers in the given order, with the given names, and the body", async () => {
    const body = Buffer.from("<?xml version='1.0' encoding='utf-8' ?><Item />");
    const response = await nodeTransport.send({
      method: "POST",
      url: `${base}/Server/InnovatorServer.aspx`,
      headers: [
        ["Content-Type", "text/xml"],
        ["LOCALE", "en-US"],
        ["TIMEZONE_NAME", "UTC"],
        ["SOAPAction", "ValidateUser"],
        ["Authorization", "Bearer t"],
        ["Host", new URL(base).host],
        ["Content-Length", String(body.length)],
      ],
      body,
      responseTimeoutMs: 5000,
      readTimeoutMs: 5000,
    });
    expect([response.status, response.reason, Buffer.from(response.body).toString()]).toEqual([200, "OK", "<ok/>"]);
    const request = seen.at(-1)!;
    expect(request.method).toBe("POST");
    expect(request.body).toBe(body.toString());
    // Node writes Host first; the contract covers the other headers (WIRE-005's port note).
    const names = request.rawHeaders.filter((_, i) => i % 2 === 0).filter((name) => !["Host", "Connection", "Content-Length"].includes(name));
    expect(names).toEqual(["Content-Type", "LOCALE", "TIMEZONE_NAME", "SOAPAction", "Authorization"]);
    expect(request.headers["content-length"]).toBe(String(body.length));
  });

  it("returns an error status as a response, with its body", async () => {
    const response = await nodeTransport.send({ method: "GET", url: `${base}/error`, headers: [], responseTimeoutMs: 5000, readTimeoutMs: 5000 });
    expect([response.status, response.reason, Buffer.from(response.body).toString()]).toEqual([500, "Internal Server Error", "<fault/>"]);
  });

  it("keeps repeated headers apart", async () => {
    const response = await nodeTransport.send({ method: "GET", url: `${base}/cookies`, headers: [], responseTimeoutMs: 5000, readTimeoutMs: 5000 });
    expect(response.headers.filter(([name]) => name.toLowerCase() === "set-cookie").map(([, value]) => value)).toEqual([
      "a=1; path=/",
      "b=2; path=/",
    ]);
  });

  it("fails with a timeout when no response arrives in time", async () => {
    const error = await nodeTransport
      .send({ method: "GET", url: `${base}/slow`, headers: [], responseTimeoutMs: 100, readTimeoutMs: 0 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ failure: "timeout", message: "The operation has timed out" });
  });

  it("fails with 'refused' when nothing listens", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const error = await nodeTransport
      .send({ method: "GET", url: `http://127.0.0.1:${port}/`, headers: [], responseTimeoutMs: 5000, readTimeoutMs: 0 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ failure: "refused", message: "Unable to connect to the remote server" });
  });

  it("fails with 'unresolved' for a name that does not exist", async () => {
    const error = await nodeTransport
      .send({ method: "GET", url: "http://no-such-host.invalid/", headers: [], responseTimeoutMs: 5000, readTimeoutMs: 0 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ failure: "unresolved", message: "The remote name could not be resolved: 'no-such-host.invalid'" });
  });
});
