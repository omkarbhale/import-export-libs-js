// Recording reverse proxy for wire captures (ticket 09). It forwards every
// request to the dev server unchanged and appends one JSON line per exchange:
// the request line, raw headers in wire order and body, then the response.
// Bodies are recorded as received; a gzip or deflate response is also
// recorded decoded.
//
// Aras's OAuthServerDiscovery.aspx answers with the OAuth server's absolute
// uri built from the request host without its port, so a client behind the
// proxy would reach the OAuth server directly. The proxy therefore rewrites
// that one response's uri to its own origin, so the token exchange is
// recorded too; the record keeps the server's original body, and
// `clientBody` holds what the client received.
//
// Each record also carries `startedMs` and `endedMs` (milliseconds since the
// proxy started, request headers read to response sent) and `connection` (the
// client's TCP source port), so overlapping requests and connection reuse show.
//
// PROXY_DELAY_MS=<path substring>=<ms> holds the matching requests that long
// before forwarding them, so a client's own timeout can be provoked (ticket 69).
//
// Usage: node proxy.mjs <listenPort> <upstreamHost:port> <out.jsonl>
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";

const [port, upstream, out] = process.argv.slice(2);
if (!port || !upstream || !out) throw new Error("usage: node proxy.mjs <listenPort> <upstreamHost:port> <out.jsonl>");
const [upHost, upPort = "80"] = upstream.split(":");
let seq = 0;
const started = Date.now();
const [delayPath, delayMs] = (process.env.PROXY_DELAY_MS ?? "").split(/=(?=\d+$)/);

function text(buf, encoding) {
  try {
    if (encoding === "gzip") return zlib.gunzipSync(buf).toString("utf8");
    if (encoding === "deflate") return zlib.inflateSync(buf).toString("utf8");
  } catch {
    return null;
  }
  return buf.toString("utf8");
}

http
  .createServer((req, res) => {
    const startedMs = Date.now() - started;
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      let aborted = false;
      const n = ++seq;
      // A client that gives up before the answer is sent leaves a record with `aborted` and no response.
      res.on("close", () => {
        if (res.writableEnded) return;
        const request = { method: req.method, url: req.url, httpVersion: req.httpVersion, rawHeaders: req.rawHeaders, body: body.toString("utf8") };
        fs.appendFileSync(out, JSON.stringify({ seq: n, startedMs, endedMs: Date.now() - started, connection: req.socket.remotePort, aborted: true, request }) + "\n");
        aborted = true;
      });
      if (delayPath && req.url.includes(delayPath)) await new Promise((r) => setTimeout(r, Number(delayMs)));
      const fwd = http.request(
        { host: upHost, port: Number(upPort), method: req.method, path: req.url, headers: req.headers },
        (up) => {
          const parts = [];
          up.on("data", (c) => parts.push(c));
          up.on("end", () => {
            let rbody = Buffer.concat(parts);
            let clientBody;
            if (/OAuthServerDiscovery\.aspx/i.test(req.url) && !up.headers["content-encoding"]) {
              const own = `http://${req.headers.host}`;
              const rewritten = rbody.toString("utf8").replace(/"uri":"https?:\/\/[^/"]+/g, `"uri":"${own}`);
              if (rewritten !== rbody.toString("utf8")) clientBody = rewritten;
            }
            const record = {
              seq: n,
              startedMs,
              endedMs: Date.now() - started,
              connection: req.socket.remotePort,
              request: {
                method: req.method,
                url: req.url,
                httpVersion: req.httpVersion,
                rawHeaders: req.rawHeaders,
                body: body.toString("utf8"),
              },
              response: {
                status: up.statusCode,
                rawHeaders: up.rawHeaders,
                body: text(rbody, up.headers["content-encoding"]),
                bodyBase64: up.headers["content-encoding"] ? rbody.toString("base64") : undefined,
                clientBody,
              },
            };
            if (clientBody !== undefined) rbody = Buffer.from(clientBody, "utf8");
            const headers = [...up.rawHeaders];
            for (let i = 0; i < headers.length; i += 2) {
              if (headers[i].toLowerCase() === "content-length") headers[i + 1] = String(rbody.length);
            }
            fs.appendFileSync(out, JSON.stringify(record) + "\n");
            if (aborted || res.destroyed) return;
            res.writeHead(up.statusCode, headers);
            res.end(rbody);
          });
        },
      );
      fwd.on("error", (e) => {
        fs.appendFileSync(out, JSON.stringify({ seq: n, error: String(e) }) + "\n");
        res.writeHead(502);
        res.end();
      });
      fwd.end(body);
    });
  })
  .listen(Number(port), "0.0.0.0", () => console.log(`proxy ${port} -> ${upstream}, recording to ${out}`));
