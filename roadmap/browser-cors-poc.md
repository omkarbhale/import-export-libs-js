# Browser CORS, cookies and transport: what a real Aras server answers a cross-origin page

Browser wayfinder ticket 15 (the one POC). A throwaway page on `http://localhost:8099`, driven by Playwright in headless Chromium 156, Firefox 157 and WebKit 27.2 (the WPE build), made raw `fetch` calls to an arashouse lease of each server flavour, with the header set of `spec/wire.md`. Read-only calls only: OAuth discovery, the password grant, `ValidateUser`, one `get` of `ItemType` `Part`, three larger `get`s, `Logoff`. No writes. The probe is not in the repository; the findings are.

## Result in one paragraph

**A standalone cross-origin page works against all three server flavours, but only after the server's administrator lists the page's origin.** None of the three flavours answers an unknown origin out of the box for the whole login chain: the OAuth server (discovery document, JWKS, token endpoint) sends no `Access-Control-Allow-Origin` until the origin is in its `allowedCorsOrigins`, and 12 SP9's SOAP endpoint sends no CORS headers at all. R23 and R35's SOAP endpoint ships `Access-Control-Allow-Origin: *`, which is enough for a bearer-token request. With the configuration of section 3 all four steps (discovery, token, SOAP, 30 MB reads) work in all three browsers, with no proxy. The session cookie is **not needed** and **cannot** work cross-origin (it is `SameSite=Lax`), so the fetch transport sends `credentials: "omit"`. `statusText` is filled over HTTP/1.1 and empty over HTTP/2 in Chromium and Firefox. An `https` page cannot reach an `http` server in Firefox and WebKit.

| Question | Standalone cross-origin page |
|---|---|
| 12 SP9 (engine 12.0) | works with configuration (OAuth origin list, and CORS headers on the SOAP endpoint, which has none) |
| R23 (engine 14.0.7) | works with configuration (OAuth origin list only) |
| R35 (engine 14.35) | works with configuration (OAuth origin list; plus `Aras-Request-ReadOnly` in the allowed headers, or the transport leaves that header out) |
| Needs a same-origin proxy? | No flavour needs one. A proxy is the alternative when the administrator cannot edit the OAuth server's `OAuth.config`, because nothing a page can do replaces that edit |
| Embedded in the Aras client (same origin) | works with no configuration |
| Session cookie required? | No, on all three (single-node leases) |

## 1. How it was measured

- Three arashouse leases, one per flavour (`12sp9` slot 02, `23` slot 01, `35` slot 01), taken for this task and returned. The connection reached the probe only through `arashouse run` (the environment); the password never appeared in a flag, a file or an output. The lease servers are at `http://172.19.0.1/ah-<flavor>-<NN>`, plain `http`, HTTP/1.1.
- Each flavour was probed three ways. (1) **Raw from Node** (`node:http`): the preflight a browser would send for each header set, the discovery chain, the token POST, `Set-Cookie`, a read with and without the cookie, and a 29 MB response with and without `Accept-Encoding: gzip, deflate, br`. This gives the raw response headers and the HTTP version, which a page cannot see. (2) **In each browser, as shipped.** (3) **In each browser, with the configuration of section 3 deployed to the lease** (`arashouse deploy-code`, which resets with the lease). Chromium also ran with CDP network events, which show each preflight and the reason a request was refused (`corsError`).
- The page's origin was `http://localhost:8099`. The lease is another origin (a different host, so a different site), which is the standalone case.
- Chromium ran both as the headless shell and as the full build (R23, as shipped): identical results.
- Mixed content and certificates used a local `https` page and local `https` servers with self-signed certificates. Chromium trusted the page's certificate by SPKI pin, because Playwright's "ignore HTTPS errors" can relax the check being measured.
- To measure WebKit on a host without its system libraries, they were unpacked from Ubuntu packages into a scratch folder (no root); the browser binary is Playwright's own build.

## 2. What the servers send as shipped (raw headers)

Preflight a browser sends for the client's header set (`Access-Control-Request-Headers: authorization,content-type,locale,soapaction,timezone_name`, plus `aras-request-readonly` for IOM 15), `OPTIONS .../Server/InnovatorServer.aspx`:

**12 SP9** (IIS): `200 OK`, headers `Allow: OPTIONS, TRACE, GET, HEAD, POST`, `Public: ...`, `Server: Microsoft-IIS/10.0`, `X-Content-Type-Options: nosniff`, `Content-Length: 0`. **No `Access-Control-*` header at all**, so every cross-origin SOAP request is refused by the browser.

**R23** (Kestrel behind IIS): `204 No Content`
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: content-disposition,content-range,content-type,locale,soapaction,timezone_name,transactionid,vaultid,Aras-Content-Range-Checksum-Type,Aras-Content-Range-Checksum,Authorization,X-Aras-Authorization
X-Content-Type-Options: nosniff
```
**R35**: the same, with `,traceparent,tracestate` added to the allowed headers.

Observations:

- **Allowed request headers.** Allowed: `Content-Type`, `LOCALE`, `TIMEZONE_NAME`, `SOAPAction`, `Authorization`, `X-Aras-Authorization`. **Not allowed on any flavour: `Aras-Request-ReadOnly` (IOM 15, so the 14.35 engine) and the legacy `AUTHUSER`, `AUTHPASSWORD`, `DATABASE`.** A request carrying one is refused as a whole (Chromium: `HeaderDisallowedByPreflightResponse`), which the page sees only as a `TypeError`. All flavours here serve OAuth, so the legacy header login was not exercised beyond its preflight.
- **`Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`** is an invalid pair for a credentialed request. Any request with `credentials: "include"` is refused (Chromium: `WildcardOriginNotAllowed`, `PreflightWildcardOriginNotAllowed`). A request without credentials is fine.
- **No `Access-Control-Allow-Methods`** and none needed: `POST` and `GET` are simple methods.
- **The OAuth server** (`/OAuthServer/`, Kestrel, on all three flavours): `GET .well-known/openid-configuration`, the JWKS and the token POST answer `200` with **no `Access-Control-Allow-Origin`**, only `Vary: Origin`. The browser therefore refuses to hand the page any of the three (`MissingAllowOriginHeader`). The token POST is a simple request (urlencoded body, `Accept`), so it has no preflight, but the response is still withheld. A preflight to the token endpoint (needed only if `Authorization` is added) answers `400`. Only `OAuthServerDiscovery.aspx`, which belongs to the SOAP application, carries the SOAP endpoint's headers and is readable (R23 and R35 as shipped).
- **After the origin is listed** the OAuth server answers with `Access-Control-Allow-Origin: <that origin>` and `Access-Control-Allow-Credentials: true`; the preflight to the token endpoint becomes `204` with `Access-Control-Allow-Headers: authorization` (R35 adds `Access-Control-Allow-Methods: POST`), and `credentials: "include"` works against it.
- **Content-Length.** Every SOAP answer carries `Content-Length` (IIS and Kestrel); OAuth JSON answers are `Transfer-Encoding: chunked`. **No compression** on any flavour, with or without `Accept-Encoding: gzip, deflate, br` (a browser always sends it and a page cannot remove it): the 29 MB answer is the same 29 243 604 bytes both ways, no `Content-Encoding`.
- **`Set-Cookie`** on `ValidateUser`: 12 SP9 `ASP.NET_SessionId; path=/; HttpOnly; SameSite=Lax`. R23 and R35 `Aras.Server.Session` (an ASP.NET Core data-protection cookie, `path=/ah-<..>` on R23 and `path=/` on R35, `samesite=lax; httponly`). `spec/wire.md` names `ASP.NET_SessionId`, which is right for 12 SP9 only.

## 3. Configuration that makes it work

Both edits are server administration, and both were deployed to a lease and verified in all three browsers. `<origin>` is the page's origin exactly (`scheme://host[:port]`), for example `https://tools.example.com`.

**a. The OAuth server, every flavour.** In `OAuthServer/OAuth.config` add the origin to the `allowedCorsOrigins` element, whose commented example ships empty, under `InnovatorClient` (the element's documented place):

```xml
<allowedCorsOrigins>
    <origin value="<origin>" />
</allowedCorsOrigins>
```

The list is global to the OAuth server: the password grant uses `client_id=IOMApp`, and the origin listed under `InnovatorClient` is accepted for it. One `<origin>` per embedding origin. A wildcard was not tried. The deploy restarted the slot; a real server needs the OAuth application to reload.

**b. The SOAP endpoint.**

- **R23 and R35:** nothing is needed for the standard header set: `Server/web.config` ships `Access-Control-Allow-Origin: *` and the six headers the client sends. R35 additionally needs `Aras-Request-ReadOnly` added to `Access-Control-Allow-Headers` if the 14.35 engine's header is to be sent (see section 5 for the alternative). Narrowing `*` to the page's origin was also verified and is what Aras's own comment recommends; it is not required, because the transport sends no credentials.
- **12 SP9:** `Server/web.config` has an `<httpProtocol><customHeaders>` block with only `X-Content-Type-Options`. Add the block R23 ships:

```xml
<httpProtocol>
  <customHeaders>
    <remove name="Access-Control-Allow-Origin" />
    <remove name="Access-Control-Allow-Headers" />
    <remove name="Access-Control-Allow-Credentials" />
    <add name="Access-Control-Allow-Origin" value="<origin>" />   <!-- or "*" -->
    <add name="Access-Control-Allow-Headers" value="content-type,locale,soapaction,timezone_name,Authorization,X-Aras-Authorization" />
    <add name="X-Content-Type-Options" value="nosniff" />
  </customHeaders>
</httpProtocol>
```

IIS answers `OPTIONS` itself with `200`, and these headers then ride on that answer and on every response (verified: the preflight became `Access-Control-Allow-Origin: <origin>` with the allowed list). The value `*` was verified on R23 and R35 as shipped; on 12 SP9 the specific origin was verified, and `*` goes through the same mechanism.

`Access-Control-Allow-Credentials: true` can stay or go; nothing here needs it.

For the record, the full configuration that produced the "with configuration" tables: (a) on all three, and (b) with the origin set explicitly and `Aras-Request-ReadOnly,AUTHUSER,AUTHPASSWORD,DATABASE` appended to the allowed headers, so every probe could run.

No flavour lacks the means: each has a documented header block and an origin list. What does not exist is a way to make it work **without** an administrator editing those two files.

## 4. Results by flavour and browser

"blocked: TypeError" is what the page sees whatever the cause (CORS, mixed content, certificate, network); the cause is in the browser console and in Chromium's CDP events, quoted in section 2. Sizes are of the full body read with `arrayBuffer()`; "= Content-Length" means the byte count equals the header. Rows are the ticket's questions: Q1 preflight, Q2 OAuth chain, Q3 credentials and cookie, Q4 readable headers and `statusText`, Q5 mixed content and certificates, Q6 large bodies. The Q5 `https`-page rows come from R23 and R35 as shipped, whose `Access-Control-Allow-Origin: *` lets the CORS check pass so the mixed-content check is what decides (12 SP9 answers no CORS before the configuration, and the configuration names the `http` page's origin, so it cannot show it).

### Tables
#### 12.0 / 12 SP9, as shipped

| Probe | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
|---|---|---|---|
| Q2 GET `OAuthServerDiscovery.aspx` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 GET `.well-known/openid-configuration` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 GET JWKS | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 POST token, urlencoded (simple request) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 POST token + `Authorization` (preflight) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 SOAP `ValidateUser`, client header set (preflight) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 SOAP `ApplyItem` read of `Part` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 + `Aras-Request-ReadOnly: 1` (IOM 15) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 legacy `AUTHUSER`/`AUTHPASSWORD`/`DATABASE` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q3 SOAP `ValidateUser`, `credentials: include` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q3 token POST, `credentials: include` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q4 refused token: status, `statusText` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q6 0.8 MB (`PackageDefinition` levels=1) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q6 3.7 MB (`Method` get) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q6 6.9 MB (`PackageDefinition` levels=2) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q6 29 MB (`ItemType` levels=1) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q3 `Set-Cookie` readable from the page | n/a | n/a | n/a |
| Q5 self-signed `https` server, default / errors ignored | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" |
| Q4 readable response headers of a SOAP answer | n/a | n/a | n/a |

#### 12.0 / 12 SP9, with the configuration of section 3

| Probe | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
|---|---|---|---|
| Q2 GET `OAuthServerDiscovery.aspx` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET `.well-known/openid-configuration` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET JWKS | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 POST token, urlencoded (simple request) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 POST token + `Authorization` (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ValidateUser`, client header set (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ApplyItem` read of `Part` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 + `Aras-Request-ReadOnly: 1` (IOM 15) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 legacy `AUTHUSER`/`AUTHPASSWORD`/`DATABASE` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q3 SOAP `ValidateUser`, `credentials: include` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q3 token POST, `credentials: include` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q4 refused token: status, `statusText` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q6 0.8 MB (`PackageDefinition` levels=1) | 200 "OK", 0.8 MB = Content-Length | 200 "OK", 0.8 MB = Content-Length | 200 "OK", 0.8 MB = Content-Length |
| Q6 3.7 MB (`Method` get) | 200 "OK", 3.9 MB = Content-Length | 200 "OK", 3.9 MB = Content-Length | 200 "OK", 3.9 MB = Content-Length |
| Q6 6.9 MB (`PackageDefinition` levels=2) | 200 "OK", 7.0 MB = Content-Length | 200 "OK", 7.0 MB = Content-Length | 200 "OK", 7.0 MB = Content-Length |
| Q6 29 MB (`ItemType` levels=1) | 200 "OK", 30.5 MB = Content-Length | 200 "OK", 30.5 MB = Content-Length | 200 "OK", 30.5 MB = Content-Length |
| Q3 `Set-Cookie` readable from the page | no (null) | no (null) | no (null) |
| Q3 session cookie stored / sent on a credentialed sequence | stored: 0, sent on 0 of 3 | stored: 0, sent on 0 of 3 | stored: 0, sent on 0 of 3 |
| Q5 self-signed `https` server, default / errors ignored | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" |
| Q4 readable response headers of a SOAP answer | cache-control, content-length, content-type, expires | cache-control, content-length, content-type, expires | cache-control, content-length, content-type, expires |

#### 14.0.7 / R23, as shipped

| Probe | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
|---|---|---|---|
| Q2 GET `OAuthServerDiscovery.aspx` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET `.well-known/openid-configuration` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 GET JWKS | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 POST token, urlencoded (simple request) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 POST token + `Authorization` (preflight) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 SOAP `ValidateUser`, client header set (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ApplyItem` read of `Part` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 + `Aras-Request-ReadOnly: 1` (IOM 15) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 legacy `AUTHUSER`/`AUTHPASSWORD`/`DATABASE` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q3 SOAP `ValidateUser`, `credentials: include` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q3 token POST, `credentials: include` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q4 refused token: status, `statusText` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q6 0.8 MB (`PackageDefinition` levels=1) | 200 "OK", 0.8 MB = Content-Length | 200 "OK", 0.8 MB = Content-Length | 200 "OK", 0.8 MB = Content-Length |
| Q6 3.7 MB (`Method` get) | 200 "OK", 3.7 MB = Content-Length | 200 "OK", 3.7 MB = Content-Length | 200 "OK", 3.7 MB = Content-Length |
| Q6 6.9 MB (`PackageDefinition` levels=2) | 200 "OK", 6.9 MB = Content-Length | 200 "OK", 6.9 MB = Content-Length | 200 "OK", 6.9 MB = Content-Length |
| Q6 29 MB (`ItemType` levels=1) | 200 "OK", 29.2 MB = Content-Length | 200 "OK", 29.2 MB = Content-Length | 200 "OK", 29.2 MB = Content-Length |
| Q3 `Set-Cookie` readable from the page | no (null) | no (null) | no (null) |
| Q5 https page → `http://` lease (ValidateUser) | 200 "OK" | blocked: TypeError | blocked: TypeError |
| Q5 https page → `http://127.0.0.1` server | 200 "OK" | 200 "OK" | blocked: TypeError |
| Q5 self-signed `https` server, default / errors ignored | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" |
| Q4 readable response headers of a SOAP answer | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma |

#### 14.0.7 / R23, with the configuration of section 3

| Probe | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
|---|---|---|---|
| Q2 GET `OAuthServerDiscovery.aspx` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET `.well-known/openid-configuration` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET JWKS | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 POST token, urlencoded (simple request) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 POST token + `Authorization` (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ValidateUser`, client header set (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ApplyItem` read of `Part` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 + `Aras-Request-ReadOnly: 1` (IOM 15) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 legacy `AUTHUSER`/`AUTHPASSWORD`/`DATABASE` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q3 SOAP `ValidateUser`, `credentials: include` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q3 token POST, `credentials: include` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q4 refused token: status, `statusText` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q6 0.8 MB (`PackageDefinition` levels=1) | 200 "OK", 0.8 MB = Content-Length | 200 "OK", 0.8 MB = Content-Length | 200 "OK", 0.8 MB = Content-Length |
| Q6 3.7 MB (`Method` get) | 200 "OK", 3.7 MB = Content-Length | 200 "OK", 3.7 MB = Content-Length | 200 "OK", 3.7 MB = Content-Length |
| Q6 6.9 MB (`PackageDefinition` levels=2) | 200 "OK", 6.9 MB = Content-Length | 200 "OK", 6.9 MB = Content-Length | 200 "OK", 6.9 MB = Content-Length |
| Q6 29 MB (`ItemType` levels=1) | 200 "OK", 29.2 MB = Content-Length | 200 "OK", 29.2 MB = Content-Length | 200 "OK", 29.2 MB = Content-Length |
| Q3 `Set-Cookie` readable from the page | no (null) | no (null) | no (null) |
| Q3 session cookie stored / sent on a credentialed sequence | stored: 0, sent on 0 of 3 | stored: 0, sent on 0 of 3 | stored: 0, sent on 0 of 3 |
| Q5 self-signed `https` server, default / errors ignored | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" |
| Q4 readable response headers of a SOAP answer | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma |

#### 14.35 / R35, as shipped

| Probe | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
|---|---|---|---|
| Q2 GET `OAuthServerDiscovery.aspx` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET `.well-known/openid-configuration` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 GET JWKS | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 POST token, urlencoded (simple request) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q2 POST token + `Authorization` (preflight) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 SOAP `ValidateUser`, client header set (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ApplyItem` read of `Part` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 + `Aras-Request-ReadOnly: 1` (IOM 15) | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q1 legacy `AUTHUSER`/`AUTHPASSWORD`/`DATABASE` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q3 SOAP `ValidateUser`, `credentials: include` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q3 token POST, `credentials: include` | blocked: TypeError | blocked: TypeError | blocked: TypeError |
| Q4 refused token: status, `statusText` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q6 0.8 MB (`PackageDefinition` levels=1) | 200 "OK", 0.9 MB = Content-Length | 200 "OK", 0.9 MB = Content-Length | 200 "OK", 0.9 MB = Content-Length |
| Q6 3.7 MB (`Method` get) | 200 "OK", 4.0 MB = Content-Length | 200 "OK", 4.0 MB = Content-Length | 200 "OK", 4.0 MB = Content-Length |
| Q6 6.9 MB (`PackageDefinition` levels=2) | 200 "OK", 7.5 MB = Content-Length | 200 "OK", 7.5 MB = Content-Length | 200 "OK", 7.5 MB = Content-Length |
| Q6 29 MB (`ItemType` levels=1) | 200 "OK", 30.3 MB = Content-Length | 200 "OK", 30.3 MB = Content-Length | 200 "OK", 30.3 MB = Content-Length |
| Q3 `Set-Cookie` readable from the page | no (null) | no (null) | no (null) |
| Q5 https page → `http://` lease (ValidateUser) | 200 "OK" | blocked: TypeError | blocked: TypeError |
| Q5 https page → `http://127.0.0.1` server | 200 "OK" | 200 "OK" | blocked: TypeError |
| Q5 self-signed `https` server, default / errors ignored | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" |
| Q4 readable response headers of a SOAP answer | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma |

#### 14.35 / R35, with the configuration of section 3

| Probe | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
|---|---|---|---|
| Q2 GET `OAuthServerDiscovery.aspx` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET `.well-known/openid-configuration` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 GET JWKS | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 POST token, urlencoded (simple request) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q2 POST token + `Authorization` (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ValidateUser`, client header set (preflight) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 SOAP `ApplyItem` read of `Part` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 + `Aras-Request-ReadOnly: 1` (IOM 15) | 200 "OK" | 200 "OK" | 200 "OK" |
| Q1 legacy `AUTHUSER`/`AUTHPASSWORD`/`DATABASE` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q3 SOAP `ValidateUser`, `credentials: include` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q3 token POST, `credentials: include` | 200 "OK" | 200 "OK" | 200 "OK" |
| Q4 refused token: status, `statusText` | 401 "Unauthorized" | 401 "Unauthorized" | 401 "Unauthorized" |
| Q6 0.8 MB (`PackageDefinition` levels=1) | 200 "OK", 0.9 MB = Content-Length | 200 "OK", 0.9 MB = Content-Length | 200 "OK", 0.9 MB = Content-Length |
| Q6 3.7 MB (`Method` get) | 200 "OK", 4.0 MB = Content-Length | 200 "OK", 4.0 MB = Content-Length | 200 "OK", 4.0 MB = Content-Length |
| Q6 6.9 MB (`PackageDefinition` levels=2) | 200 "OK", 7.5 MB = Content-Length | 200 "OK", 7.5 MB = Content-Length | 200 "OK", 7.5 MB = Content-Length |
| Q6 29 MB (`ItemType` levels=1) | 200 "OK", 30.3 MB = Content-Length | 200 "OK", 30.3 MB = Content-Length | 200 "OK", 30.3 MB = Content-Length |
| Q3 `Set-Cookie` readable from the page | no (null) | no (null) | no (null) |
| Q3 session cookie stored / sent on a credentialed sequence | stored: 0, sent on 0 of 3 | stored: 0, sent on 0 of 3 | stored: 0, sent on 0 of 3 |
| Q5 self-signed `https` server, default / errors ignored | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" | blocked: TypeError / 200 "OK" |
| Q4 readable response headers of a SOAP answer | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma | cache-control, content-length, content-type, expires, pragma |

### Q4 Readable headers, `statusText`, and HTTP/2

- **Readable on a SOAP answer in every browser:** `Cache-Control`, `Content-Length`, `Content-Type`, `Expires`, `Pragma` (the CORS-safelisted set; `Pragma` is absent on 12 SP9). `Set-Cookie` is never readable (`headers.get("set-cookie")` is `null`). No `Access-Control-Expose-Headers` is sent by any flavour, so nothing else is visible: not `Content-Encoding`, `Server`, `Vary`.
- **`statusText` is filled** on every flavour here because the leases speak HTTP/1.1 (`OK`, `Unauthorized`, `Method Not Allowed`). Over HTTP/2 it is empty in Chromium and Firefox and filled by WebKit, measured against a local HTTP/2 server and an HTTP/1.1 one:

| | Chromium 156 | Firefox 157 | WebKit 27.2 |
|---|---|---|---|
| HTTP/1.1, 500 | `Internal Server Error` | `Internal Server Error` | `Internal Server Error` |
| HTTP/2, 500 | empty | empty | `Internal Server Error` |

A production server behind IIS or a reverse proxy with HTTP/2 will therefore show an empty `statusText` in two of the three browsers.

### Q5 Mixed content and certificates (R23 and R35 as shipped, an `https` page, `http` targets)

| Target | Chromium | Firefox | WebKit |
|---|---|---|---|
| `http://172.19.0.1/...` (private address, the lease) | allowed, console warning | blocked | blocked |
| `http://127.0.0.1:<port>` (loopback) | allowed | allowed | blocked |
| a public `http` host (`http://example.com/`, measured in Chromium only) | blocked ("This request has been blocked; the content must be served over HTTPS") | not measured | not measured |

So a page served over `https` can reach an `http` Aras server in Chromium only, and only because the server is on a private or loopback address. A public `http` server is unreachable from an `https` page in all three browsers. The reverse (an `http` page to an `http` server) has no restriction beyond CORS.

Self-signed certificate on the **server**: `fetch` fails in all three browsers with the same opaque `TypeError` and no way to continue from script; the same request succeeds when the browser is told to ignore certificate errors. The user must first trust the certificate in the browser (browse to the server once and accept it, or install the certificate); an `https` Aras server with a certificate the browser trusts needs nothing.

## 5. What the fetch transport (ticket 16) must do

1. **`credentials: "omit"` on every request, cross-origin or not.** The session cookie is not needed: after `ValidateUser`, a read of `Part` with the bearer token succeeds **without** the cookie on all three flavours (Node, a single-node lease) and in all three browsers (`credentials: "omit"`, no cookie reachable). It also cannot work cross-origin: with `credentials: "include"`, shipped R23 and R35 and every flavour behind `Access-Control-Allow-Origin: *` fail outright; with the origin named and credentials allowed the request succeeds but the browser **rejects the cookie** (`SameSite=Lax`, a cross-site context; Firefox logs "Cookie "Aras.Server.Session" has been rejected because it is in a cross-site context") and sends none on the next request. Result with the configuration of section 3 in all three browsers: stored 0 cookies, sent on 0 of 3 requests. The `CookieJar` stays inert in the browser (D12): `Set-Cookie` is invisible and `Cookie` is forbidden. An embedding host that is same-origin may pass `"same-origin"`; the transport takes the mode as an option, default `"omit"`.
   - Not probed (no writes are allowed in this ticket): whether a write sequence (lock, update, unlock) depends on the server session. It is expected not to, because locks are per user, but ticket 26 and the live parity run (33) should assert it.
2. **Drop `Host`, `Cookie`, `Content-Length` and `Expect`.** They are forbidden header names in the Fetch standard. All three browsers silently ignore them (verified for `Cookie`, `Host` and `Content-Length`: the request is sent and answered normally; `Expect` was not probed); the recorded request keeps them (D12).
3. **`Aras-Request-ReadOnly` is the one header that can break a request.** If the server's allowed list lacks it (as shipped on R35), the whole request is refused with an opaque `TypeError`. The browser build must not send it unless the caller says the server allows it: an option `sendReadOnlyHint`, default off. The header is a hint that no recorded exchange sets, and it does not change the request AML. The legacy login headers (`AUTHUSER`, `AUTHPASSWORD`, `DATABASE`) are likewise refused on all three flavours as shipped; a legacy-only server needs them in its allowed list, and none of the three leases uses them.
4. **Fill `statusText` from the standard reason-phrase table when it is empty** (HTTP/2 in Chromium and Firefox), so `(500) Internal Server Error` and the OAuth `(InternalServerError)` texts come out as in Node. Use the status number, not `statusText`, for every decision.
5. **A refused request is one error class.** CORS, mixed content, a certificate and a dead host all arrive as `TypeError` with no detail (the browser console has it). The transport reports "Unable to connect to the remote server" as D12 says; the facade should say, in its message, that the cause may be CORS and name the section 3 configuration, because the first thing every integrator hits is a missing origin entry. A cheap diagnostic is the `OAuthServerDiscovery.aspx` GET: readable as shipped on R23 and R35 but not on 12 SP9, and the openid-configuration GET after it is the one that fails when the OAuth origin is missing.
6. **Read whole bodies with `arrayBuffer()`.** 0.8, 3.9, 7.0 and 30 MB answers arrive complete in all three browsers, equal to `Content-Length`, ending in the closing envelope. 30 MB took 8 to 17 s on the lease (the lease, not the browser, is the limit). `Accept-Encoding` is out of the page's control and no flavour compresses, so there is no decompression concern. OAuth JSON answers have no `Content-Length`; the transport must not require one.
7. **Timeouts and abort** use `AbortSignal` (`AbortSignal.timeout`), which exists in all three browsers; there is no read timeout hook.
8. **Preflight cost.** Every SOAP request preflights (`Content-Type: text/xml` and the custom headers), one extra round trip per call, unless the server sends `Access-Control-Max-Age` (none does). Export on 14.35 is capped by the browser's connection limit (6 per host on HTTP/1.1), as the map says; the preflights share that limit.

## 6. Recommendation on Q1 (the captain accepts or overrules)

**Keep Q1 = (b): the library plus a standalone reference page, with (c) embedding as the zero-configuration route.** The captain answered (b) already; the POC does not change it, but it adds a prerequisite that the reference page's documentation must state:

- A **standalone page works against all three flavours, but only against a server whose administrator has listed the page's origin** (OAuth server `allowedCorsOrigins`, and on 12 SP9 the SOAP CORS headers). There is no flavour that works from an arbitrary origin out of the box, and nothing a page does replaces the `OAuth.config` edit.
- **Embedded in the Aras client (same origin) needs no configuration and no CORS at all**, and it is the route that works on a server nobody is willing to reconfigure. It is also where the captain's "take the session from a signed-in Aras client" option (Q2) applies.
- The alternative to editing `OAuth.config` is a **same-origin reverse proxy** in front of the Aras server, that serves the page and the Aras paths from one origin. That needs no Aras edit at all and makes the page same-origin. It is deployment work outside the library, so the reference page should document it as the third option and not build it.
- The reference page (ticket 30) should therefore ship a short "server prerequisites" section, with the XML of section 3, and a "Test connection" step that makes the discovery GET, so a missing entry is reported as CORS and not as a dead server.
  - Done differently: the page has no "Test connection" step; a failed connect names the prerequisite, and `examples/browser/README.md` holds the section (HOST-281).

Suggested wording for Q1 in `map.md` (not edited by this ticket): "(b) stands. Standalone works against all three server flavours only once the server lists the page's origin in the OAuth server's `allowedCorsOrigins` (and, on 12 SP9, sends CORS headers from the SOAP endpoint); embedded in the Aras client needs nothing. See `roadmap/browser-cors-poc.md`."

## 7. What this result changes in the plan

- **Ticket 16 (fetch transport):** the five rules of section 5, in particular `credentials: "omit"`, no `Aras-Request-ReadOnly` by default, the reason-phrase table, and a single opaque error class. New host rules to write there (`HOST-23x`): omit credentials, drop forbidden headers, reason phrase from the table, optional read-only hint.
- **Ticket 26 (wire end to end) and 33 (live parity):** run against leases configured as in section 3; also assert that a write sequence works with no session cookie.
- **Ticket 30 (reference page):** the prerequisites section and the connection test above.
- **`spec/wire.md` line 104** names `ASP.NET_SessionId`; R23 and R35 set `Aras.Server.Session`. The engine replays whatever it is given, so no behaviour changes; the sentence could be amended when `spec/` is next touched.
- Nothing in this result changes the design decisions D1 to D14 or the ticket graph.

## 8. Caveats

- Leases are single-node and `http`; a production farm behind a load balancer may treat the session differently, and a TLS front end changes mixed-content and HTTP/2 behaviour (measured here on local servers, not on Aras).
- WebKit is Playwright's WPE build on Linux, not Safari; its CORS and mixed-content behaviour is that of the WebKit engine.
- Chromium and Firefox were Playwright's builds, headless. Chromium's permissiveness towards `http` private addresses from an `https` page is a property of that version (156).
- The OAuth server accepts one exact origin per `<origin>` entry; wildcards and `null` origins (a page opened from `file://`) were not tried. A `file://` page has the origin `null` and would need its own entry if that works at all.
- The 20 MB case of the ticket was a 29 to 30 MB `ItemType` `levels=1` read; the 2.7 MB `PackageDefinition` answer of the fixtures is bracketed by the 0.8 MB and 3.9 MB reads.
