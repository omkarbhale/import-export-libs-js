# Browser wire tests: what an HTTP server in another origin sees from the client

Browser wayfinder ticket 26. `src/browser/wire.browser.test.ts` runs the client (`connect`, `HttpServerConnection`, `createFetchTransport`) in headless Chromium 156, Firefox 157 and WebKit 27.2 against the Node test server `src/browser/test-server.ts` (HOST-234, HOST-267), which is a different origin from the page, so every request is a CORS request. The cases and what each asserts are in `spec/browser-host.md` (HOST-267); this record keeps what a reader of the spec cannot get from it: the header lists the server saw, and the one defect the run found.

## One defect found, fixed in the transport

12.0's OAuth discovery (IOM 12, WIRE-010) is the one request that carries `Aras-Set-HttpSessionState-Behavior: switch_to_initial`. No server flavour lists that header in `Access-Control-Allow-Headers` (`roadmap/browser-cors-poc.md`, section 2), so a browser sent a preflight for it and refused the discovery, and with it the whole 12.0 login, with the text `System.Net.WebException: Unable to connect to the remote server`. The POC did not see it because its probe called the discovery with its own headers, not the client's. The wire tests did, in all three browsers, on the first run. `createFetchTransport` now leaves the header out unless the caller sets `sendSessionStateHint`, as it already did `Aras-Request-ReadOnly` (HOST-232); the header only asks the server not to hold a session for the request, and a browser sends no session cookie (HOST-233). The case that proves it fails without the change.

## The headers the server saw

Every request of the three logins (against the proxy captures of the three reference hosts, `fixtures/wire/<engine>-reference-host/capture.jsonl`) and of the legacy 12.0 login, in each browser. A request that carries a header the CORS-safelist does not have is preceded by a preflight (`OPTIONS`, with `Access-Control-Request-Headers`), which the test log keeps apart.

**Chosen by the client** (the same in every browser; the test compares each value with the capture's):

| Request | Headers the client chose |
|---|---|
| 12.0 discovery (`GET OAuthServerDiscovery.aspx`) | none (`Aras-Set-HttpSessionState-Behavior` is left out, above) |
| OpenID configuration and key set (`GET`) | none |
| Password grant (`POST connect/token`) | `Accept`, `Content-Type: application/x-www-form-urlencoded` |
| SOAP call (`POST InnovatorServer.aspx`) | `Authorization: Bearer <token>` (`X-Aras-Authorization` for a `Custom` OAuth server), `Content-Type: text/xml`, `LOCALE`, `TIMEZONE_NAME`, `SOAPAction` |
| SOAP call of the legacy 12.0 login | `AUTHUSER`, `AUTHPASSWORD`, `DATABASE` in place of `Authorization`, with the rest |

`Aras-Request-ReadOnly` (14.35) is not sent unless the caller asks and the server lists it. The engine's `Host`, `Cookie`, `Content-Length` and `Connection` never reach the wire as the engine built them: the browser sets its own `Host`, `Connection` and `Content-Length` (the body's length, asserted), and no `Cookie` or `Expect` arrives.

**Set by the browser** (not compared with the capture; listed so that a server's allow list and logging are not a surprise):

| Browser | Headers on every request |
|---|---|
| Chromium | `accept-encoding`, `cache-control`, `connection`, `host`, `origin`, `pragma`, `referer`, `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `sec-fetch-dest`, `sec-fetch-mode`, `sec-fetch-site`, `user-agent` |
| Firefox | `accept-encoding`, `accept-language`, `cache-control`, `connection`, `host`, `origin`, `pragma`, `priority`, `referer`, `sec-fetch-dest`, `sec-fetch-mode`, `sec-fetch-site`, `user-agent` |
| WebKit | `accept-encoding`, `accept-language`, `cache-control`, `connection`, `host`, `origin`, `pragma`, `referer`, `sec-fetch-dest`, `sec-fetch-mode`, `sec-fetch-site`, `user-agent` |

Plus `content-length` on a `POST`, and `accept` on every request (the client's own for the grant, the browser's for the rest). `cache-control` and `pragma` come from `cache: "no-store"`. The three browsers send the same custom headers, in the same requests, with the same values.

## What the CORS cases showed, per browser

All three browsers agree on every case, so none is a deviation:

- A SOAP endpoint with no CORS, a server with no CORS at all, a server whose preflight does not list a header the client sends (the legacy login's three, `Aras-Request-ReadOnly`, IOM 12's `Aras-Set-HttpSessionState-Behavior`), a wildcard origin with credentials, and a server that went away all end the call with the engine's text for a failed connection (`System.Net.WebException: Unable to connect to the remote server`, or for 14's discovery `System.Net.Http.HttpRequestException: An error occurred while sending the request.`), and no promise is left rejected that nobody handles.
- Chromium repeats a request once when a reused connection was dropped before any answer (a fault that drops one connection was answered by the repeat), so the test that drops a connection drops every such request, in all three browsers.
- The reason phrase is the standard one when the status line has none (HOST-232).

## Not tested here

A mixed-content block and the behaviour of a page that is not a secure context need an `https` page against an `http` server, or a non-localhost origin; the test page is on `localhost`, a secure context. They are in `roadmap/browser-cors-poc.md` (mixed content and certificates) and belong to the documentation of the browser API.
