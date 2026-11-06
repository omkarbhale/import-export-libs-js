import { type IncomingMessage, type Server, type ServerResponse, createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

/**
 * The same-origin reverse proxy of the browser parity run (HOST-277): the page and the Aras server it talks to are on one origin, so the
 * page needs nothing of the server's own CORS configuration, which a lease may lack (`roadmap/browser-cors-poc.md`). It forwards each
 * request to the server and each response back byte for byte: the body untouched (compressed stays compressed, a 5 MB body is not
 * buffered), the status line and every header as received with their names' case and repeated headers (`Set-Cookie`) kept apart. What it
 * changes is the hop-by-hop headers and `Host`, and the CORS headers: the upstream's `Access-Control-*` are replaced by those of a server
 * that allows the page's origin. A preflight is answered here, with the headers the browser asks for, and never forwarded. One kind of
 * body does change: the OAuth discovery answers (`OAuthServerDiscovery.aspx`, `.well-known/openid-configuration`) name the server's own
 * origin in absolute URLs, which the engine follows, so there that origin becomes the proxy's and the login stays on one origin.
 * It also serves the files of the parity page, below `/__parity/`, so that one origin holds both.
 *
 * It reads no credential: the page's requests carry theirs, and nothing is logged.
 *
 * @spec HOST-277
 */

/** The headers a proxy must not forward (RFC 9110, section 7.6.1), and `Host`, which names the proxy. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host"]);

export interface ProxyOptions {
  /** The server's address, such as `http://172.19.0.1/12sp9`; its origin is where requests go, and its path is the one the page uses. */
  target: string;
  /** A folder of static files served below `/__parity/` (the harness page). */
  staticRoot?: string;
}

export interface RunningProxy {
  /** `http://127.0.0.1:<port>`: the origin of the page and of the proxied server. */
  origin: string;
  /** The server's URL as the page reaches it: the proxy's origin with the target's path. */
  url: string;
  /** The page's URL. */
  pageUrl: string;
  /** The count of requests forwarded, for the report. */
  forwarded(): number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json" };

/** The request headers the browser says it will send, echoed, plus the ones the engine always sends. */
function allowedHeaders(request: IncomingMessage): string {
  const asked = request.headers["access-control-request-headers"];
  return typeof asked === "string" && asked !== "" ? asked : "content-type,locale,timezone_name,soapaction,authorization,x-aras-authorization";
}

function corsHeaders(request: IncomingMessage, preflight: boolean): Record<string, string> {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return {};
  const headers: Record<string, string> = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" };
  if (preflight) {
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = allowedHeaders(request);
    headers["Access-Control-Max-Age"] = "600";
  } else {
    headers["Access-Control-Expose-Headers"] = "Content-Length, Content-Type, Content-Encoding";
  }
  return headers;
}

const isDiscovery = (url: string): boolean => /\/(?:oauthserverdiscovery\.aspx|\.well-known\/openid-configuration)$/.test((url.split("?")[0] ?? "").toLowerCase());

/** The target's origin in a body: with JSON's optional `\/`, with its default port spelled or not, and not as the prefix of a longer host. */
function originPattern(target: URL): RegExp {
  const quote = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const defaultPort = target.port !== "" ? "" : `(?::${target.protocol === "https:" ? 443 : 80})?`;
  return new RegExp(`${quote(target.protocol)}\\\\?/\\\\?/${quote(target.host)}${defaultPort}(?![\\w.:-])`, "gi");
}

/** The pairs of a raw header list, with the hop-by-hop ones left out. */
function forwardable(raw: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let at = 0; at + 1 < raw.length; at += 2) {
    const name = raw[at] as string;
    if (!HOP_BY_HOP.has(name.toLowerCase())) pairs.push([name, raw[at + 1] as string]);
  }
  return pairs;
}

async function serveStatic(root: string, rest: string, response: ServerResponse): Promise<void> {
  const clean = normalize(rest === "" || rest === "/" ? "/index.html" : rest).replace(/^([/\\])+/, "");
  const full = join(root, clean);
  if (clean.startsWith("..") || !full.startsWith(root + sep)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  try {
    const bytes = await readFile(full);
    response.writeHead(200, { "Content-Type": MIME[extname(full)] ?? "application/octet-stream", "Content-Length": bytes.length, "Cache-Control": "no-store" });
    response.end(bytes);
  } catch {
    response.writeHead(404).end("not found");
  }
}

/** Starts the proxy. */
export async function startProxy(options: ProxyOptions): Promise<RunningProxy> {
  const target = new URL(options.target);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  const targetOrigin = originPattern(target);
  let origin = "";
  let count = 0;
  const server: Server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (options.staticRoot !== undefined && url.startsWith("/__parity/")) {
      void serveStatic(options.staticRoot, url.slice("/__parity".length).split("?")[0] ?? "", response);
      return;
    }
    if (request.method === "OPTIONS" && typeof request.headers["access-control-request-method"] === "string") {
      response.writeHead(204, corsHeaders(request, true));
      response.end();
      return;
    }
    count += 1;
    const discovery = isDiscovery(url);
    const sent = forwardable(request.rawHeaders).filter(([name]) => !discovery || name.toLowerCase() !== "accept-encoding");
    const upstream = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === "" ? undefined : target.port,
        method: request.method,
        path: url,
        // the raw pairs, so that a header keeps its case and a repeated one stays repeated
        headers: Object.fromEntries(
          sent.reduce<Map<string, string[]>>((map, [name, value]) => map.set(name, [...(map.get(name) ?? []), value]), new Map()),
        ),
        setHost: false,
        agent: false,
      },
      (answer) => {
        const received = forwardable(answer.rawHeaders).filter(([name]) => !name.toLowerCase().startsWith("access-control-"));
        const writeHead = (pairs: readonly [string, string][]): void => {
          const lines: Record<string, string[]> = {};
          for (const [name, value] of [...pairs, ...Object.entries(corsHeaders(request, false))]) (lines[name] ??= []).push(value);
          response.writeHead(answer.statusCode ?? 502, answer.statusMessage ?? "", lines);
        };
        answer.on("error", () => response.destroy());
        if (!discovery || answer.headers["content-encoding"] !== undefined) {
          writeHead(received);
          answer.pipe(response);
          return;
        }
        const chunks: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => chunks.push(chunk));
        answer.on("end", () => {
          const body = Buffer.from(Buffer.concat(chunks).toString("latin1").replace(targetOrigin, () => origin), "latin1");
          writeHead([...received.filter(([name]) => name.toLowerCase() !== "content-length"), ["Content-Length", String(body.length)]]);
          response.end(body);
        });
      },
    );
    // the server sees its own address as the host, as it would from a client that reached it directly
    upstream.setHeader("Host", target.host);
    upstream.on("error", (error) => {
      if (response.headersSent) response.destroy();
      else response.writeHead(502, "Bad Gateway", { "Content-Type": "text/plain", ...corsHeaders(request, false) }).end(`the proxy could not reach the server: ${error.message}`);
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    url: `${origin}${target.pathname.replace(/\/$/, "")}`,
    pageUrl: `${origin}/__parity/index.html`,
    forwarded: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
