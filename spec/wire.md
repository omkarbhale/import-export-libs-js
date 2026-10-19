# Wire protocol, login, version probe and gate

This document specifies everything the engine sends to the Aras server and how. The library replaces IOM as well as `Libs.dll` (round 1, Q3), so these rules describe IOM's observable behaviour below `Libs` too: the OAuth login, the request framing, the fault model and the timeout.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`), and of `IOM.dll` 14.0.7.35492 and Aras's `ConsoleUpgrade.exe` 14.0.7 (decompiled locally with the same `ilspycmd`, never committed);
- the proxy capture of the reference host against dev, `fixtures/wire/14.0.7-reference-host/` (WIRE-002). Request headers and bodies quoted below are from that capture;
- for the one 14.35 variant here (WIRE-051): the 14.35 decompile of `CItemException` (`.decomp/14.35/`, never committed) and a run of the real 14.35 `Libs.dll` against a scripted connection (`oracle/export-output-probe/`, `fixtures/export-output/run-export-14.35.txt`). The other wire rules of 14.35 are the 14.35 import and DB patch tickets'.

IOM 14.0.7 targets .NET Framework 4.7.2. Its SOAP calls go through `HttpWebRequest` and its OAuth calls through `HttpClient`, so some wire details (header order, `Expect: 100-continue`) come from the framework rather than from IOM's code. The capture pins them.

The `[12.0]` variants rest on the 12.0 decompile of `Libs.dll` (`.decomp/12.0/`) and of `IOM.dll` 12.0.0.13341, which is a different code base from IOM 14 in its OAuth part (a separate discovery provider, token client and authenticator classes), on Aras's `ConsoleUpgrade.exe` 12.0, and on the proxy capture of that host against dev, `fixtures/wire/12.0-reference-host/` (WIRE-002). IOM 12 targets .NET Framework 4.x; its SOAP calls go through `HttpWebRequest` and its OAuth calls through `HttpClient`, as IOM 14's do, so the transport headers are the same.

- for `[14.35]`: the 14.35 decompile of `Libs.dll` (`.decomp/14.35/`), of IOM 15.0.0.0 with its `Aras.Net.dll` and `Aras.Cryptography.dll` (vendored in `oracle/native/14.35/`) and of Aras's `ConsoleUpgrade.exe` 14.35, decompiled locally with the same `ilspycmd` and never committed; the proxy captures `fixtures/wire/14.35-reference-host/` (WIRE-002); and the stub-connection probe `fixtures/wire/14.35-probe/` (`probe.json`, scenarios `A.probe` to `F.iomHelpers`), which runs the real 14.35 classes against scripted answers. `fixtures/wire/14.0.7-probe/` is the same probe against 14.0.7; it backs the 14.0.7 statements about the refusal's message and the probe's parse errors.

IOM 14.0.7 targets .NET Framework 4.7.2. Its SOAP calls go through `HttpWebRequest` and its OAuth calls through `HttpClient`, so some wire details (header order, `Expect: 100-continue`) come from the framework rather than from IOM's code. The capture pins them.

`[14.35]` runs on IOM 15, also on .NET Framework 4.7.2, with the same transport classes (`HttpWebRequest` for SOAP, `HttpClient` for OAuth), now in `Aras.Net.dll`. IOM 15 rewrote the password handling and the token provider; the requests the engine sends are otherwise the same bytes, which the captures show: exchanges 1 to 10 and the `Logoff` of `fixtures/wire/14.35-reference-host/capture.jsonl` have the same request headers (names and order) and bodies as the 14.0.7 capture's. A rule below says `[14.35] Same as 14.0.7` only where the code compares equal (a `diff` of the two decompiles) or the capture or probe shows it.

## Hosts

### WIRE-001: The engine is driven by a host that owns the connection

[14.0.7] The engine never builds its own connection on the import, export or language-pack paths. A host constructs an IOM `HttpServerConnection` (or a subclass), hands it to `CItemHelper`, which wraps it in an `Innovator` (`IomFactory.CreateInnovator`), and calls `CItemHelper.Login()` before any import or export. `CItemHelper` exposes the `Innovator` it made (`Inn`) and the server version that `Login` read (`InnovatorVersion`, WIRE-020). Its `Cookie` property is set to null at construction and never read. The library's client plays the host's role: it takes the server URL, database, user name and password, logs in (WIRE-010 to WIRE-016), and runs the probe and gate (WIRE-020 to WIRE-024) before the operation.

[12.0] Same as 14.0.7, except for what `CItemHelper.Login` does (WIRE-017). `CItemHelper` has a second constructor, `CItemHelper(url, password, database, userName, folder)`, which builds the `HttpConnectorExtension` itself. Only the GUI hosts `import.exe` and `export.exe` use it. It is not ported: the library's client plays the host's role (WIRE-002).

[14.35] Same contract, with these differences. `CItemHelper` has an `IsConnected` property, true while its `Inn` is set. `Login` sets `Inn` to null when it refuses the server (WIRE-023) and when the login was cancelled (WIRE-017, WIRE-056), and `logout` sets it to null at the end (WIRE-040), so a run in those states has no connection. `HttpConnectorExtension` has a third constructor, which takes an IOM token provider and a protocol type; no host in scope calls it (WIRE-090). The library's client plays the host's role as for 14.0.7, with IOM 15's login (WIRE-010 to WIRE-018).

### WIRE-002: The 14.0.7 reference host is Aras's ConsoleUpgrade.exe

[14.0.7] Connection-level behaviour (headers, login, timeout and logoff) is specified as Aras's own 14.0.7 console tool, `ConsoleUpgrade.exe`, produces it. It:

1. builds an `HttpConnectorExtension` through its nine-argument constructor, passing the URL, database, user name and plain password as given, and its certificate defaults: store location `CurrentUser`, store name `My`, find type `FindBySubjectName`, an empty find value and "valid only" true. With an empty find value the certificate path is skipped (see WIRE-090), and the connection is IOM's `HttpServerConnection` with locale `en-US`. The constructor passes no time zone, so IOM falls back to the machine's own zone (WIRE-005);
2. calls `CItemHelper.Login()` (login, probe and gate);
3. constructs the `ImportExportManager`, which applies `timeout=` (WIRE-031), and runs the export or import;
4. calls `CItemHelper.logout()` in a `finally`, after success or failure of the operation (WIRE-040). When `Login()` itself throws, no logoff is sent, because the connection is built and logged in outside that `try`.

The oracle hosts (`oracle/README.md`) differ on purpose: their recording connection is not exactly an `HttpConnectorExtension`, so their final `logout()` sends nothing. The capture in `fixtures/wire/14.0.7-reference-host/` was recorded with `oracle/wire-capture/`, which reproduces steps 1 to 4 with the vendored 14.0.7 DLLs behind a recording proxy, for a one-item export.

[12.0] The 12.0 reference host is Aras's `ConsoleUpgrade.exe` 12.0 (`Desktop\ImportExport\12\ConsoleUpgrade`). It differs from the 14.0.7 host in four points:

1. it builds the `HttpConnectorExtension` through its four-argument constructor, `(url, database, user name, plain password)`. The constructor passes locale `en-US` and no time zone to IOM's `HttpServerConnection`, so `TIMEZONE_NAME` starts as the machine's own Windows time zone id (WIRE-005). 12.0 has no certificate arguments and no certificate path;
2. `CreateCItemHelper` constructs `CItemHelper(connection)` and calls `Login()`, which logs in because the connection's type is exactly `HttpConnectorExtension` (WIRE-017);
3. it constructs the `ImportExportManager` (WIRE-031) and runs the export or import;
4. it calls `CItemHelper.logout()` in a `finally`, after success or failure, which sends the logoff (WIRE-040). When `CreateCItemHelper` throws, no logoff is sent.

The oracle's 12.0 host differs on purpose: its recording connection is not exactly an `HttpConnectorExtension`, so it logs in itself before the engine runs, and its final `logout()` sends nothing (`oracle/README.md`).

The capture in `fixtures/wire/12.0-reference-host/` was recorded with `oracle/wire-capture/ReferenceHost-12.0.cs` and `capture-12.0.ps1` (the vendored 12.0 `Libs.dll` and `IOM.dll` behind the recording proxy, the same one-item export of the `List` `Report Format Types` as the 14.0.7 capture). It has 32 exchanges: 1 and 2 the discovery and the OpenID configuration, 3 the password grant, 4 `ValidateUser`, 5 `GetCurrentUserID`, 6 the user record, 7 and 8 the version probe, 9 to 31 the export's 23 requests, 32 `Logoff`. The 14.0.7 capture has 35: one request more at login (the key set), two more in the probe, and one more in the export (the float-property lookup of `Value`, EXP-116).

[14.35] The reference host is Aras's `ConsoleUpgrade.exe` 14.35 (Release 35, `PackageImportExportUtilities35\ConsoleUpgrade`), which does the same four steps: the nine-argument `HttpConnectorExtension` with the same certificate defaults (WIRE-090) and locale `en-US`, no time zone; `CItemHelper.Login()` outside any `try`; the `ImportExportManager` (WIRE-031); the operation; `CItemHelper.logout()` in a `finally` (WIRE-040). Its differences from 14.0.7's are all above the wire: a `CItemException` from the operation is printed and ends the run with code 1, and a failing `Login()` escapes as an unhandled exception in both.

The capture was recorded with `oracle/wire-capture/ReferenceHost-14.35.cs`, which repeats those steps with the vendored 14.35 `Libs.dll` and IOM 15 behind the recording proxy, for a one-item export (`capture.jsonl`, 37 exchanges), a three-item and a four-item export (WIRE-060), a rejected login (WIRE-013) and a cancelled one (WIRE-056). Like the oracle (`oracle/README.md`, Rules), the host hands IOM the MD5 hex of the dev password, because IOM 15 sends a password as given (WIRE-012); only the rejected-login run sends a password as given, with a user and password that do not exist. The run is otherwise ConsoleUpgrade's: the host differs in catching a failing `Login()` and in running inside Windows PowerShell 5.1.

## Request framing

### WIRE-003: The server URL is normalised to `Server/InnovatorServer.aspx`

[14.0.7] If the given URL does not end with `InnovatorServer.aspx` (compared case-insensitively), the base URL is the given URL, plus `/` unless it already ends with one, plus `Server/`. Otherwise the base is the URL with that suffix removed. The suffix removal is a case-insensitive regular expression in which the `.` matches any character. SOAP requests go to the base plus `InnovatorServer.aspx`. The discovery URL (WIRE-010) is the base plus `OAuthServerDiscovery.aspx`. No other de-duplication happens: `http://h/Innovator/Server` becomes `http://h/Innovator/Server/Server/InnovatorServer.aspx`, and a query string or trailing slash after `InnovatorServer.aspx` defeats the suffix check.

[12.0] The suffix test and the discovery URL differ. IOM 12 tests the given URL for the suffix `Server/InnovatorServer.aspx` (case-insensitively), not for `InnovatorServer.aspx`. When it ends with that suffix, the file name is removed (the same case-insensitive regular expression in which the `.` matches any character) and the rest is the base. Every other URL gets `/` (unless it ends with one) and `Server/` appended. So `http://h/Innovator/Server/InnovatorServer.aspx` and `http://h/Innovator` give the same base, but `http://h/Innovator/InnovatorServer.aspx`, which 14.0.7 takes as it stands, becomes `http://h/Innovator/InnovatorServer.aspx/Server/InnovatorServer.aspx`. The discovery URL is the base plus `OAuthServerDiscovery.aspx`, built with the same test.

[14.35] Same as 14.0.7. IOM 15's `HttpServerConnection` constructor and its OAuth discovery client (`OAuthServerUrlsProvider`) hold the same normalisation, and the capture's requests go to the same paths.

### WIRE-004: Every SOAP call is a POST of the bare XML root, not an envelope

[14.0.7] Each call is an HTTP/1.1 `POST` to the `InnovatorServer.aspx` URL. The body is the UTF-8 bytes, with no BOM, of `<?xml version='1.0' encoding='utf-8' ?>` followed directly, with no newline, by the outer XML of the request document's root element. There is no SOAP envelope on requests; only responses are envelopes.

- `ApplyItem` (from `Item.apply`, used by `CItemHelper.applyAML`, WIRE-006) sends the single `<Item>` element as the root.
- `ApplyAML` (from `Innovator.applyAML`, used by the version probe, WIRE-020, and the cmf query of the export) sends the root the caller wrote, usually `<AML>…</AML>`, with nothing added.
- `ValidateUser` sends `<Item />` (WIRE-015) and `Logoff` sends `<logoff skip_unlock="1" />` (WIRE-040).

The root is re-serialised by .NET's DOM, which is observable: attribute values are written in double quotes, an empty element is written `<X />` with a space, and anything before the root element, such as the leading `\r\n\t\t\t` of the probe's AML literals, is dropped. Whitespace inside the root is kept byte for byte, including CRLF and tab characters (WIRE-007). Values interpolated by the engine are not escaped (AGENTS.md rule 7), so the request is whatever the DOM makes of the engine's string.

[12.0] Same framing and bytes (capture: the bodies of `ApplyItem`, `ApplyAML`, `ValidateUser` and `Logoff` are those of 14.0.7). One more bare body exists: `GetCurrentUserID` sends `<?xml version='1.0' encoding='utf-8' ?><Empty />` (WIRE-015).

[14.35] Same as 14.0.7: the `ValidateUser`, user-record, probe and `Logoff` bodies of the capture (exchanges 5 to 10 and 37) are the 14.0.7 capture's, and `ValidateUser` is `<?xml version='1.0' encoding='utf-8' ?><Item />`. The 14.35 engine also reaches two kinds of request that the 14.0.7 engine does not:

- `ApplySQL`, from `Innovator.applySQL`, on the language-pack path for servers below 14.0 SP22 (`LP-`). The body is `<sql><Query>{sql}</Query></sql>`: the SQL text is the element's text, so `&`, `<` and `>` in it are escaped by the DOM.
- the raw `CallAction` calls of DB patch application (`DBP-`): `ValidateUser`, `GetItem` and `ApplyUpdate`. Each is the bare root the caller wrote (`CallAction` loads the caller's string into a DOM first), re-serialised as above, so a caller's `<Empty/>` goes out as `<Empty />`. What they contain is for the `DBP-` rules. A `ValidateUser` sent this way also resets `LOCALE` and `TIMEZONE_NAME` from its response (WIRE-005), because IOM keys that on the action name.

### WIRE-005: SOAP request headers

[14.0.7] A SOAP request carries these headers, in this order on the wire:

```text
Content-Type: text/xml
LOCALE: <locale>
TIMEZONE_NAME: <time zone>
SOAPAction: <action>
Authorization: Bearer <access token>
Host: <host[:port]>
Cookie: <cookies the server set>
Content-Length: <n>
Expect: 100-continue
```

- `Content-Type` is exactly `text/xml`, with no charset. `SOAPAction` is the bare action name, unquoted: `ApplyItem`, `ApplyAML`, `ValidateUser` or `Logoff`.
- `LOCALE` starts as `en-US`, from the reference host's constructor. `TIMEZONE_NAME` starts as the client machine's Windows time zone id (`TimeZoneInfo.Local.Id`, for example `India Standard Time`), because the constructor passes none. After every `ValidateUser` response, even a fault, both are replaced by the response's `Result/i18nsessioncontext/locale` and `time_zone`, trimmed. When an element is missing or blank the value becomes empty, and the header is then sent with an empty value. Against dev the server returns `en-US` and `India Standard Time`, so the values do not change.
- The library also sends a Windows time zone id as the initial `TIMEZONE_NAME`. On Windows it uses the machine's local id. Elsewhere it maps the local IANA zone to its Windows id through the CLDR `windowsZones` table. That table names zones by CLDR's canonical ids, which are often older IANA names, so the local zone is first resolved through CLDR's time zone aliases (`bcp47/timezone.xml`) to its canonical id: `Asia/Kolkata` becomes `Asia/Calcutta`. The Windows id is then taken from the `mapZone` entry whose space-separated type list contains that id, preferring territory `001`; `Asia/Calcutta` gives `India Standard Time`. The library carries the result as a table generated from CLDR release 47 (`tools/windows-zones/generate.ts`). A `--time-zone <Windows id>` flag overrides the value on any platform. When no flag is given and the local zone has no mapping, the run stops with a usage error that names the zone and the flag. This is not a deviation: the header carries the same value the reference host sends on the same machine.
- The authorization header is `Authorization: Bearer <token>` when the discovery document's `protocol_info.protocol_type` is `Standard`, and `X-Aras-Authorization: Bearer <token>` when it is `Custom`. The header is chosen by the type alone: IOM requires the document's `authorization_header`, `www_authenticate_header` and `unauthorized_status_code` to be present, but does not use their values. Under the legacy login (WIRE-016) it is replaced by `AUTHUSER`, `AUTHPASSWORD` and `DATABASE`. With OAuth there is no `DATABASE` header.
- Cookies: the connection keeps one cookie container and replays what the server sets, in practice `ASP.NET_SessionId`, set by the `ValidateUser` response.
- No `User-Agent`, `Accept`, `Accept-Encoding`, `Cache-Control` or `Content-Encoding` is sent. Compression is off. The first request on a new TCP connection may also carry `Connection: Keep-Alive`; that header belongs to the transport and is not part of the contract.
- Port note: `Host`, `Content-Length` and `Expect` are what .NET writes. A Node client need not match the transport headers (`Host`, `Connection`, `Content-Length`, `Expect`) byte for byte, but sends the others with these names, values and order.

[12.0] Same header block, values and order for SOAP requests (capture exchanges 4 to 32, which have the same header names, in the same order, as the 14.0.7 capture). The differences:

- `LOCALE` starts as `en-US` and `TIMEZONE_NAME` as the machine's Windows time zone id, from the four-argument constructor (WIRE-002); both are replaced after `ValidateUser` as in 14.0.7.
- The discovery request carries a header the SOAP requests do not: `Aras-Set-HttpSessionState-Behavior: switch_to_initial` (WIRE-010). A SOAP request of IOM 12 would carry `Aras-Set-HttpSessionState-Behavior: required` only on a connection used through `UsingParameters` with `ForceWritableSession`, which neither the engine nor the reference host does.
- IOM 12 keeps its cookies in a container that is empty unless the process is a web application (`HttpContext.Current`), which a console host is not. The cookie set by `ValidateUser` is replayed as in 14.0.7.

[14.35] Same as 14.0.7 in every capture: the SOAP headers are `Content-Type`, `LOCALE`, `TIMEZONE_NAME`, `SOAPAction`, `Authorization`, `Host`, `Cookie`, `Content-Length`, `Expect` in that order, the token request's are `Accept`, `Content-Type`, `Host`, `Content-Length`, `Expect`, the discovery GETs carry only `Host` (and `Connection: Keep-Alive` on the first), and `TIMEZONE_NAME` starts as the machine's Windows time zone id. The library's time zone rule is unchanged.

IOM 15 adds one header: `Aras-Request-ReadOnly: 1`, written between `TIMEZONE_NAME` and `SOAPAction`. It is sent when the request is an `ApplyItem` whose root `Item` has the attribute `readOnly` equal to `1`, or an `ApplyAML` in which every `/AML/Item` has `readOnly` equal to `1`. The comparison is exact (`true` does not count) and an `AML` root with no `Item` child counts as read-only (`probe.json`, `F.iomHelpers`). The test is an XPath over the request document, `/Item` for `ApplyItem` and `/AML/Item` for `ApplyAML`, so an `ApplyAML` whose root is not `AML` has no `/AML/Item` either and counts as read-only too. `ValidateUser`, `Logoff`, `ApplySQL` and the raw actions never carry it. The engine does not write `readOnly` itself, so a request carries the header only when the AML it sends happens to match, for example an item from a package file that has the attribute; no request in the captures does.

### WIRE-006: `CItemHelper.applyAML` sends ApplyItem and throws on any fault

[14.0.7] `CItemHelper.applyAML(aml)` loads the AML string into a new IOM item (`Innovator.newItem().loadAML(aml)`) and applies it, which is one `ApplyItem` call (WIRE-004). `Item.apply` sends the one `Item` the string holds, found as `Item`, `AML/Item` or `//Result/Item`, so an `<AML>` wrapper around exactly one item sends that item bare. A string with no such item or with several is refused by IOM before anything is sent, with a plain `System.Exception` whose message is `Not a single item`. When the response is a fault it throws a `CItemException` built from the request AML and the response (WIRE-051), whatever the faultcode, including `0` ("no items"). Callers that treat faultcode `0` as an empty result catch that exception and test its `faultcode` (WIRE-052). Otherwise it returns the whole response document, envelope included.

[12.0] Same, except for the exception it throws. `applyAML` throws `CItemException(item)` (WIRE-051), built from the response alone: the exception's `faultstring` and message are the response document's whole outer XML, with no `Server error`, `Request:` and `Responce:` parts. The request AML is not in the message. Observed (a `List` that does not exist): the logged `faultstring` starts `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault …>` and the `faultdetail` is the server's detail text, as in 14.0.7.

[14.35] Same as 14.0.7, except that the `CItemException` it throws has the indented text of WIRE-051.

### WIRE-007: The AML string literals are part of the request bytes

[14.0.7] Every AML literal the engine sends is reproduced with its exact whitespace. Where a literal contains CR LF and tab characters inside the root element, they reach the wire unchanged, as the version probe's requests show (WIRE-020). Whitespace before the root is dropped (WIRE-004). Each area document that defines a request literal gives it with its whitespace; this rule is the framing that all of them rely on.

The oracle's transcripts hold a request as the loaded document's outer XML, not as the wire bytes: quotes are already double and empty elements already `<X />`, but the whitespace before the root is kept, so a probe request starts with `\r\n\t\t\t` there and not on the wire. The library's client reports each call in the same form to anything that records it.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7: the probe literals of the capture (exchanges 7 to 10) carry the same CRLF and tab whitespace.

## Login

### WIRE-010: Login starts with OAuth server discovery

[14.0.7] `HttpServerConnection.Login()` resolves the authenticator first. On a new connection that is three GET requests, made with a fresh cookie container each and no custom headers:

1. `GET <base>OAuthServerDiscovery.aspx`. The JSON body's `locations[*].uri` values are the OAuth server URLs, reordered so that those whose host equals the discovery URL's host (case-insensitively) come first, keeping their order otherwise. A missing `locations` gives an empty list.
2. `GET <uri>.well-known/openid-configuration` for each location in turn (a `/` is added to the uri when missing), until one succeeds. The document must have non-empty `issuer`, `jwks_uri`, `authorization_endpoint`, `token_endpoint` and `end_session_endpoint`, and a `protocol_info` object with `protocol_type` (`Standard` or `Custom`), `authorization_header`, `www_authenticate_header` and `unauthorized_status_code`. `protocol_version` is optional; when it is absent or does not parse it counts as `0.0`. IOM also remembers the last URL that worked, process-wide, and tries it first on a later login in the same process.
3. `GET <jwks_uri>`, on every login. A non-success status or an empty body fails login.

The capture records the three requests; against dev the discovery answer is `{"locations":[{"uri":"http://localhost/12sp9/OAuthServer/"}]}`. The server builds that uri from the request's host without its port.

[12.0] Discovery is two requests, not three, and IOM 12 asks less of the documents:

1. `GET <base>OAuthServerDiscovery.aspx` with the extra header `Aras-Set-HttpSessionState-Behavior: switch_to_initial` (it comes before `Host`; there is no other custom header). The JSON body's `locations[*].uri` values are the OAuth server URLs, reordered so that those whose host equals the discovery URL's host (ignoring case) come first, keeping their order otherwise. A missing `locations` gives an empty list; an empty body means "no discovery endpoint" (WIRE-011).
2. For each location in turn, `GET <uri>.well-known/openid-configuration` (a `/` is added to the uri when missing). The first location whose answer is received and parses wins. The document is read for two things only: `protocol_info.protocol_type` (`Standard` or `Custom`, case-sensitive) and `protocol_version`, which counts as `0.0` when it is absent or does not parse. `issuer`, `jwks_uri`, the endpoints and the other `protocol_info` fields are neither required nor read. A location that does not answer, or whose document is not JSON or has a missing or unknown `protocol_type`, is skipped and the next is tried. IOM also remembers the last location that worked, process-wide, and tries it first on a later login in the same process, as in 14.0.7.
3. There is no key-set request. IOM 12 never fetches `jwks_uri`.

The token endpoint is `<uri>connect/token` of the location that won, built by IOM; the `token_endpoint` field is not read (against dev the two are the same). The capture records exchanges 1 and 2; the discovery answer is `{"locations":[{"uri":"http://localhost/12sp9/OAuthServer/"}]}` and the OpenID configuration has the fields above and more.

[14.35] Same as 14.0.7: the capture's exchanges 1 to 3 have the same requests and headers, and the discovery answer is the same. IOM 15's `HttpServerConnection` password constructor uses the plain `DiscoveryDocumentProvider`, so nothing is cached between logins on a connection; the process-wide last-working-URL memory of the resolver is unchanged. Failures become the same `999` fault (WIRE-015).

### WIRE-011: Protocol version 1.0 or later selects the OAuth password grant

[14.0.7] When the discovery document's `protocol_version` is 1.0 or more, IOM authenticates with a bearer token from the password grant (WIRE-012), sent in the header WIRE-005 names. When it is below 1.0 or missing, IOM uses the legacy headers (WIRE-016).

Only a discovery that "is not there" falls back to the legacy headers: a 404 from `OAuthServerDiscovery.aspx`, or an empty body. Every other discovery failure fails login with a fault (WIRE-015): another HTTP error status, a connection failure, a body that is not JSON, an empty `locations` list, every OpenID configuration request failing, a missing required field, or a failed key set request. A failed discovery is not remembered, so the next call on the connection tries discovery again.

The texts of these faults are IOM's. A non-404 error status from `OAuthServerDiscovery.aspx` is `System.Net.Http.HttpRequestException: Cannot get OAuthServer urls from '<discovery url>' url: (<status>) <reason>.`. A body that is not a JSON object is a `Newtonsoft.Json.JsonReaderException`. Each OpenID configuration request, together with the reading of its document (a missing required field, a `protocol_type` that is neither `Standard` nor `Custom`, an `unauthorized_status_code` that is not an integer), is tried inside a loop that discards the failure and goes to the next location, so when no location works, or there are none, the fault is `System.AggregateException: Cannot get OAuthServer discovery document.` The key set request is outside that loop: its failure fails login as `System.InvalidOperationException: Cannot get key set: (<status>) <reason>.`, or `…: Cannot get key set: Response content is empty.` for a blank body, without trying another location. A request that cannot be sent at all (connection refused, a name that does not resolve) is `System.Net.Http.HttpRequestException: An error occurred while sending the request.`, and a request that times out is `System.Threading.Tasks.TaskCanceledException: A task was canceled.`; these two texts come from the .NET Framework's `HttpClient` and are not in the capture.

[12.0] Same threshold: a `protocol_version` of 1.0 or more selects the OAuth password grant (WIRE-012), anything below selects the legacy headers (WIRE-016). Only "no discovery endpoint" falls back to the legacy headers: a 404 from `OAuthServerDiscovery.aspx`, or an empty body. The other discovery failures are IOM 12's own and are not caught by the authenticator choice, so they become the general IOM fault (WIRE-050), faultcode `999` and faultstring `<exception type>: <message>`:

- another HTTP error status or a connection failure on the discovery request: `System.Net.WebException: <message>`;
- a discovery body that is not JSON: `Newtonsoft.Json.JsonReaderException: <message>`;
- no location answered with a usable document, or the `locations` list was empty: `System.AggregateException: Cannot require OAuth server discovery information.` followed, when there are locations, by the inner messages in parentheses (`Cannot require OAuth server discovery information based on '<uri>' url.` for each, on .NET Framework 4.7.2 and later).

These faults come out of the first SOAP request (`ValidateUser`), because IOM 12 chooses its authenticator when the first request is prepared; no `ValidateUser` is sent. The texts of the exception types are .NET's and IOM's; they are from the decompile and not observed on dev, which serves OAuth.

[14.35] Same as 14.0.7 (the factory that chooses between the bearer token and the legacy headers is the same code, and a failed discovery is not remembered). IOM 15 also has a constructor that takes a token provider and protocol type and skips discovery and the password grant; no host in scope uses it.

### WIRE-012: The password grant request

[14.0.7] The token is fetched lazily, when the first SOAP call (`ValidateUser`) is about to be sent:

```text
POST <token_endpoint>
Accept: application/json
Content-Type: application/x-www-form-urlencoded
Host: <host[:port]>
Content-Length: <n>
Expect: 100-continue

grant_type=password&client_id=IOMApp&scope=Innovator&database=<db>&username=<user>&password=<digest>
```

- The fields are form-encoded in that order (spaces as `+`, other reserved characters percent-encoded).
- `<digest>` is the password's hash (WIRE-014): the lowercase MD5 hex of its ASCII bytes. The committed capture has this value replaced by `SCRUBBED` (AGENTS.md rule 6), so its form rests on IOM's hashing as WIRE-014 states, not on the capture.
- An empty database or user name fails login (faultstring `System.ArgumentException: Database`, or `…: UserName`) when IOM creates the token provider, which is after the three discovery requests and before the token request or `ValidateUser`. The database is checked first.
- A 200 or 400 response is read as JSON. A body with a non-blank `error` is an OAuth error whose code is `error` and whose message is `error_description` (looked up case-insensitively), or `error` when there is no description. Any other status is an OAuth error with code `server_error` and message `(<status name>) <reason phrase>`, for example `(InternalServerError) Internal Server Error`. A body that is not JSON is an OAuth error whose code and message are both the JSON parser's message.
- Otherwise the token is `access_token`; a response without one fails as `System.ArgumentException: Token value can not be null or empty.`. `expires_in` is ignored: the token is kept for the life of the connection, with no expiry tracking and no refresh.

[12.0] The token is fetched lazily, when the first SOAP call (`ValidateUser`) is about to be sent, with the same request line and headers as 14.0.7 (`Accept: application/json`, `Content-Type: application/x-www-form-urlencoded`, `Host`, `Content-Length`, `Expect: 100-continue`). The body differs in field order and in what is optional:

```text
client_id=IOMApp&grant_type=password&scope=Innovator&username=<user>&database=<db>&password=<digest>
```

- The fields are form-encoded in that order (the capture: `client_id=IOMApp&grant_type=password&scope=Innovator&username=admin&database=12sp9&password=SCRUBBED`). `username` is left out when the user name is empty. `<digest>` is as in 14.0.7 (WIRE-014).
- An empty database fails with `System.ArgumentException: Database`, and a missing password with `…: Password`, after the two discovery requests and before any token request. An empty user name is not an error: the request is sent without `username`.
- A 200 or 400 response is read as JSON; any other status is an OAuth error with code `server_error` and message `(<status name>) <reason phrase>`. A body with a non-blank `error` is an OAuth error whose code is `error` and whose message is `error_description` (looked up case-insensitively) or `error`. A body that is not JSON does not become an OAuth error: the client throws `InvalidOperationException("Invalid JSON response")` inside the task, and the general IOM fault is `System.AggregateException: One or more errors occurred.` followed by ` (Invalid JSON response)` on .NET Framework 4.7.2 and later. A transport failure is the same shape with the inner exception's message.
- Otherwise the token is `access_token`. `expires_in` is ignored, as in 14.0.7: the token is kept for the life of the connection.

[14.35] The request is the same as 14.0.7's, with one change: IOM 15 puts the password in the `password` field **as given**, not its MD5 digest.

```text
grant_type=password&client_id=IOMApp&scope=Innovator&database=<db>&username=<user>&password=<password as given>
```

The headers, the field order and the form encoding are unchanged, and so are the checks before the request (a null password is refused with `System.ArgumentException: Password`; an empty one is accepted) and the reading of the answer: a 200 or 400 JSON body, an `error` field, `server_error` with `(<status name>) <reason phrase>` for other statuses, `access_token` as the token. Two things differ from 14.0.7:

- Evidence of "as given": `capture-rejected-login.jsonl` sends the 21-character password `libsjs-not-a-password` and the request's `Content-Length` is 127; the retried request (WIRE-013) with the 32-character MD5 digest has 138. The password fields are scrubbed, as in every committed capture. `capture.jsonl` carries an MD5 hex (the host's choice, WIRE-002) and has the same `Content-Length`, 124, as the 14.0.7 capture, whose digest was always an MD5.
- `refresh_token`: when the answer has a non-empty `refresh_token`, the provider remembers it and uses it for later renewals (WIRE-018). Dev's answer has none (`capture.jsonl`, exchange 4: `access_token`, `expires_in`, `token_type`, `scope`).

So a login with a password that is not a hash costs a token request that the server refuses, and the first request carries the password in the clear. The library does the same in `[14.35]` mode.

### WIRE-013: The SHA-256 retry on `incompatible_hash_use_sha256`

[14.0.7] When the token request fails with the OAuth error code `incompatible_hash_use_sha256` exactly, IOM switches the digest to SHA-256 (WIRE-014) and sends the same request once more. No other code is retried; `incompatible_hash_use_md5` is not. When the password was given already as a 32-character hex string (taken as an MD5 hash), the switch is impossible and the original error stands.

[12.0] Same as 14.0.7.

[14.35] The retry is rewritten. IOM 15 reacts to two OAuth error codes, both on the token request, and the password it sends is the one the user gave, not a previous digest:

- `incompatible_hash_use_md5`: when the password given looks like a SHA-256 hash (64 hex characters, WIRE-014), the error stands. Otherwise the password becomes its MD5 digest (WIRE-014) and the same request is sent once more.
- `incompatible_hash_use_sha256`: when the password given looks like an MD5 hash (32 hex characters), the error stands. Otherwise the password becomes its SHA-256 digest and the request is sent once more.

The digest is kept: later token requests of the connection (renewals, WIRE-018) send it too. The second request is final: its error, whatever its code, is the login's error, and there is no third request. Any other first error code is final at once.

Observed (`capture-rejected-login.jsonl`, exchanges 4 and 5): the server answers a password that is not a hash with `400 {"error":"incompatible_hash_use_md5","error_description":"Incompatible password hash algorithm. Please use MD5 algorithm."}`; IOM sends the request again with the MD5 digest; the server answers `400 {"error":"invalid_grant","error_description":"Authentication failed for libsjs-no-such-user"}`, which is the fault `Login()` returns (WIRE-015). So against dev a plain password always takes two requests. With an MD5 hex as the password (the host's choice) there is one, and the retry never happens. The SHA-256 retry was not provoked: dev answers `incompatible_hash_use_md5`. `incompatible_hash_use_md5` is retried in 14.35 and was not in 14.0.7.

### WIRE-014: Password digests

[14.0.7] The password reaches the server only as a digest:

- A password that already looks like a hash is used verbatim: 32 hex characters (any case) as MD5, 64 hex characters as SHA-256.
- Otherwise the MD5 digest is the lowercase hex of MD5 over the password's ASCII bytes, and the SHA-256 digest is the uppercase hex of SHA-256 over the same bytes.
- ASCII encoding turns every non-ASCII character into `?` (0x3F) before hashing, so two passwords that differ only in non-ASCII characters have the same digest. This is reproduced (WIRE-055).

A password that already is the other kind of hash cannot be switched to that mode. Switching a 32-hex password to SHA-256 throws `System.InvalidOperationException: Parole already contains Md5 hash.`, and switching a 64-hex one to MD5 throws `…: Parole already contains Sha256 hash.`. A mode other than exactly `MD5` or `SHA256` throws `…: Unknown hashing mode.`

The same digest is used in the token request (WIRE-012) and in the legacy `AUTHPASSWORD` header (WIRE-016). The reference host passes the password plain; the library takes it from `ARAS_PASSWORD` or stdin (AGENTS.md) and never puts it on a command line.

[12.0] Same as 14.0.7.

[14.35] The same functions with the same results (`probe.json`, `F.iomHelpers`): the MD5 digest is the lowercase hex of MD5 over the ASCII bytes, the SHA-256 digest the uppercase hex of SHA-256 over the same bytes, and a password already of the right shape is used verbatim. The shape tests are `^[0-9A-F]{32}$` and `^[0-9A-F]{64}$` ignoring case, and `$` also matches before a final line feed, so 32 hex characters plus `\n` counts as an MD5 hash (the same in 14.0.7). What changes is when they are used:

- on the token path only at the retry (WIRE-013), never for the first request (WIRE-012);
- on the legacy header path as in 14.0.7: `AUTHPASSWORD` is the MD5 digest first, and a challenge naming a mode switches it (WIRE-016).

### WIRE-015: ValidateUser, the user record, and login faults

[14.0.7] After authentication is resolved, `Login()` sends `ValidateUser` with the body `<Item />`. The response must hold `Result/id`; it also gives `database`, `login_name` and the `i18nsessioncontext` that WIRE-005 applies. IOM then reads the user's record with one `ApplyItem`:

```xml
<Item type="User" action="get" select="default_vault" expand="1"><id>USER-ID</id><Relationships><Item type="ReadPriority" action="get" select="priority, related_id" expand="1" orderBy="priority" /></Relationships></Item>
```

When that request returns a fault, a second `ApplyItem` follows with the same item and no `<Relationships>`. A successful login is therefore discovery, the OpenID configuration, the key set, the token request, `ValidateUser` and the user record, in that order, as the capture shows.

`Login()` returns a fault item, and never throws, when:

- discovery fails (WIRE-011): IOM's own fault (WIRE-050) with faultcode `999` and faultstring `<exception type>: <message>`;
- the token request fails (WIRE-012): an IOM fault with faultactor `OAuthServer`, faultcode the OAuth error code (or `999` when it has none) and faultstring its message. For `incompatible_hash_use_md5` and `incompatible_hash_use_sha256` the detail is `<message key="password_hash_algorithm" value="MD5" />` or `value="SHA256"` instead of `unknown error`. No `ValidateUser` is sent;
- `ValidateUser` returns a fault, which is returned as received, or a response without `Result/id`, which returns IOM's "Unknown error" item (WIRE-050);
- the user record request fails twice: the second fault is returned.

[12.0] `Login()` sends `ValidateUser` with the body `<Item />` as in 14.0.7 and needs `Result/id` in the answer (capture exchange 4), but it does not take the user id from it. It then reads the user's record with two requests, not one, in `getUserInfo`:

1. `GetCurrentUserID`, a SOAP call with `SOAPAction: GetCurrentUserID` and the body `<?xml version='1.0' encoding='utf-8' ?><Empty />` (exchange 5). The answer's `Result` text is the user id, as `<GetCurrentUserIDResponse><Result>…</Result></GetCurrentUserIDResponse>`. A response without a `Result` element throws `System.Exception` with the message `Cannot obtain user id`, which is not a fault item: it leaves `Login()` and `CItemHelper.Login()` as it is.
2. The user record, `ApplyItem`, with the same item as 14.0.7 (exchange 6), and the same second attempt without `<Relationships>` when the first answer is a fault.

`getUserInfo` caches its result; `Login()` calls it once. `Login()` returns a fault item, and never throws, in the cases of 14.0.7 with these differences: discovery faults are WIRE-011's and OAuth faults WIRE-012's; the item returned for a login answer that has neither a fault nor an id has the `faultstring` `Failed to login` (faultcode `1`, empty faultactor) instead of `Unknown error`; and a failing second request of step 1 or 2 returns that fault. The user's database and login name are not kept.

[14.35] Same sequence and results as 14.0.7: discovery, the OpenID configuration, the key set, the token request (two when the password is not a hash, WIRE-013), `ValidateUser` and the user record (the capture's exchanges 5 and 6 equal the 14.0.7 capture's). `Login()` returns the same faults and never throws. An OAuth error is the fault of WIRE-050 with faultactor `OAuthServer`: the capture's rejected login ends in faultcode `invalid_grant`, faultstring `Authentication failed for libsjs-no-such-user`, detail `unknown error`, and no `ValidateUser` follows. Its `<message key="password_hash_algorithm" …/>` detail appears only when the final error is itself `incompatible_hash_use_md5` or `incompatible_hash_use_sha256`, for example when the retry was impossible (WIRE-013).

### WIRE-016: Legacy header login

[14.0.7] Under the legacy authenticator (WIRE-011) there is no token request. Every SOAP request, `ValidateUser` included, carries `AUTHUSER: <user>`, `AUTHPASSWORD: <digest>` (WIRE-014, MD5 first) and `DATABASE: <db>` in place of the authorization header. When a fault's `detail/supported_authentication_schema/schema` names a hashing mode other than the current one, IOM switches to that mode and resends the call; a mode other than exactly `MD5` or `SHA256` becomes a `999` fault. Dev serves OAuth, so this path is specified from the decompile only.

[12.0] Same as 14.0.7. IOM 12's legacy authenticator sends the same `AUTHUSER`, `AUTHPASSWORD` and `DATABASE` headers and switches hashing mode on the same `supported_authentication_schema` answer. Dev serves OAuth, so this is specified from the decompile only.

[14.35] Same as 14.0.7 (`AuthHeadersAuthenticator`, `ParoleHash` and the mode switch are the same code). Dev serves OAuth, so this path is specified from the decompile only.

### WIRE-017: CItemHelper.Login turns a login fault into faultcode -100

[14.0.7] `CItemHelper.Login()` calls `Login()` on the connection only when it is an IOM `HttpServerConnection` (any subclass). When the result is a fault it throws a `CItemException` with faultcode `-100`, and with faultstring and message both `Failed login to Innovator; original error: {0}`, where `{0}` is the whole fault document's outer XML (envelope included). A connection that is not an `HttpServerConnection` is assumed to be logged in already, and only the probe and gate run.

[12.0] `CItemHelper.Login()` calls `Login()` on the connection only when the connection's type is **exactly** `HttpConnectorExtension`. A plain IOM `HttpServerConnection`, such as the one `IomFactory.CreateHttpServerConnection` makes, and any subclass of `HttpConnectorExtension` are never sent `ValidateUser` and nothing reads the user record; the probe and the gate (WIRE-020 to WIRE-023) run straight away over IOM's per-request authentication, so the first probe request starts discovery and the token request. The failure case is the same as in 14.0.7: a fault from `Login()` throws `CItemException` with faultcode `-100`, and with faultstring and message both `Failed login to Innovator; original error: {0}`, `{0}` the whole fault document's outer XML. The library's client always logs in, as the reference host does (WIRE-002). The oracle's 12.0 host logs in itself for the same reason.

[14.35] Same as 14.0.7 for a login fault: `CItemHelper.Login()` throws a `CItemException` with faultcode `-100` and the text `Failed login to Innovator; original error: {fault outer XML}`, the fault written as IOM made it, not indented (`probe.json`, `C.loginFaults`). It also looks only at `HttpServerConnection` connections. One case is new: when the login fault's faultstring contains `System.Threading.Tasks.TaskCanceledException` (an ordinal, case-sensitive substring test, wherever the fault came from), `Login()` treats the login as cancelled. It sets `Inn` to null and returns with no error, before the version probe, so `InnovatorVersion` stays null and `IsConnected` is false. With a password login this happens when one of the OAuth requests exceeds its 100-second limit (WIRE-030), whose fault is `System.Threading.Tasks.TaskCanceledException: A task was canceled.`. WIRE-056 registers the consequence.

### WIRE-018: One token renewal on an unauthorized status

[14.0.7] Under OAuth, when a SOAP request is answered with the protocol type's refusal status (401 for `Standard`, 498 for `Custom`; the document's own `unauthorized_status_code` is not used), IOM fetches a new token with a fresh password grant (WIRE-012) and resends the request once. A second refusal becomes an IOM `999` fault (WIRE-050). The legacy login never retries. IOM's re-login on session-timeout faults is off by default and neither the engine nor the reference host turns it on, so it does not happen.

[12.0] Same as 14.0.7.

[14.35] Same trigger as 14.0.7: a SOAP request answered with the protocol type's refusal status (401 for `Standard`, 498 for `Custom`; IOM 15 holds the two in a fixed table by type and does not read the document's own `unauthorized_status_code`) gets one new token and one resend, and a second refusal is the `999` fault `System.Net.WebException: The remote server returned an error: (401) Unauthorized.`. What the renewal sends differs:

- when the provider holds a refresh token (WIRE-012), the renewal is `grant_type=refresh_token&client_id=IOMApp&refresh_token=<token>`, form-encoded with the token request's headers. The answer must hold a `refresh_token` and an `access_token`; otherwise the fault is `System.InvalidOperationException: Refresh token is missing.` or `…: Access token is missing.`. Each success replaces the stored refresh token;
- otherwise it is a fresh password grant (WIRE-012) with the password as WIRE-013 left it. Dev issues no refresh token, so this is what a renewal against dev sends.

Nothing serialises renewals: requests running at the same time (WIRE-060) that are each refused each renew. Not provoked against dev; specified from the decompile.

## Version probe and gate

### WIRE-020: The version probe is four ApplyAML requests

[14.0.7] Right after login, `CItemHelper.Login()` reads the server version (`GetInnovatorServerVersion`) with four `ApplyAML` calls on a new `Innovator` over the same connection. The literals carry CRLF and tab whitespace, which reaches the wire inside `<AML>` (WIRE-007). The first request body is:

```text
<?xml version='1.0' encoding='utf-8' ?><AML>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionMajor</name>\r\n\t\t\t\t</Item>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionMinor</name>\r\n\t\t\t\t</Item>\r\n\t\t\t</AML>
```

The next three each get one Variable, `VersionServicePack`, `VersionBuild` and `VersionServiceUpdate` in that order, with the same shape:

```text
<?xml version='1.0' encoding='utf-8' ?><AML>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionServicePack</name>\r\n\t\t\t\t</Item>\r\n\t\t\t</AML>
```

(`\r\n` and `\t` stand for CR LF and tab.) The engine's literals use single-quoted attributes and start with `\r\n\t\t\t`; WIRE-004 explains the double quotes and the dropped leading whitespace.

[12.0] The version probe is two `ApplyAML` requests: the first, with `VersionMajor` and `VersionMinor`, and the second, with `VersionServicePack`, each with the literal and whitespace of 14.0.7 (capture exchanges 7 and 8, whose bodies are the first two probe bodies of the 14.0.7 capture). There are no `VersionBuild` and `VersionServiceUpdate` requests.

[14.35] Same as 14.0.7: four `ApplyAML` requests with the same bytes (the capture's exchanges 7 to 10 equal the 14.0.7 capture's), and `probe.json` (`A.probe`) shows the engine's literals unchanged.

### WIRE-021: Reading the probe results

[14.0.7] The probe reads its results as follows. Every other fault throws a `CItemException` built from the response alone (WIRE-051), not a login error.

- **Major and minor.** A fault on the first request throws. When both Variables come back, `value` of the `VersionMajor` and `VersionMinor` items are read and parsed as invariant integers at the end of the probe. When only one of them exists, the probe throws `System.IndexOutOfRangeException` (WIRE-054). A missing `value` or a non-integer fails the parse with `FormatException` (`Input string was not in a correct format.`; IOM's `getProperty` answers an empty string for a missing element).
- **Service pack.** A fault with faultcode exactly `0` gives 0. On success, `value` with every `SP` removed is parsed as an integer; an empty or missing value, or one that still does not parse (for example `SP9 SU1`), gives 0. Dev answers `SP9`, which gives 9.
- **Build and service update.** A fault with faultcode exactly `0` gives 0. On success `value` is parsed as an invariant integer and a missing or non-integer value throws.

The result is the server version (major, minor, service pack, build, service update), kept as `CItemHelper.InnovatorVersion` for the rest of the run.

[12.0] Major, minor and service pack are read exactly as in 14.0.7 (a fault on the first request throws, a single Variable crashes the probe, WIRE-054; service pack: faultcode exactly `0` gives 0, `SP` is removed before parsing, a value that does not parse gives 0). Build and service update do not exist: the version is `(major, minor, servicePack)`, kept as `CItemHelper.InnovatorVersion`, and `ArasVersion` has no `Build`, `ServiceUpdate` or full-string members.

[14.35] Same results as 14.0.7 (`probe.json`, `A.probe`). The code differs only in how it reads the service pack (a null-safe chain that gives the same answers). Observed with scripted answers:

- dev's four answers give `12.0 SP9 Build 24090` (service pack 9, service update 0);
- the service pack `SP9 SU1`, an empty value and a fault with faultcode `0` all give 0; a fault with another faultcode throws a `CItemException` with that faultcode after the second request;
- build and service update: a fault with faultcode `0` gives 0; another faultcode throws; a missing or non-integer `value` throws `System.FormatException`;
- only one of `VersionMajor` and `VersionMinor` in the first answer throws `System.IndexOutOfRangeException` (WIRE-054), and a first-request fault throws a `CItemException`.

A `CItemException` thrown here is built from the response alone, so its text is the indented one of WIRE-051.

### WIRE-022: Version text

[14.0.7] The server version is written as text in two ways. `InnovatorVersionFullString` is `{major}.{minor} SP{servicePack} Build {build}` when the major version is below 14, and `{major}.{minor}.{serviceUpdate}.{build}` otherwise (dev: `12.0 SP9 Build <build>`). The engine's log of its input parameters writes it as `Innovator version: {0}`. The engine's own version for the gate (WIRE-023) is its assembly's major and minor version with the other parts 0: `14.0` for 14.0.7.35492. The version type has no text form of its own, which WIRE-024 reproduces.

[12.0] There is no `InnovatorVersionFullString`, and nothing logs the server version (EXP-506). The engine's own version for the gate (WIRE-023) is its assembly's major and minor version with service pack 0: `12.0` for 12.0.0.13341. The version type has no text form (WIRE-024).

[14.35] Same formula as 14.0.7: `{major}.{minor} SP{servicePack} Build {build}` below 14 and `{major}.{minor}.{serviceUpdate}.{build}` from 14 (`probe.json`: `12.0 SP9 Build 24090`, `14.0.5.77`, `14.35.5.77`). The engine's own version is `14.35` (the assembly's major and minor, other parts 0), whose text is `14.35.0.0`. Unlike 14.0.7, the gate's message uses this text for both versions (WIRE-024).

### WIRE-023: The version gate accepts servers 12 to 14

[14.0.7] After the probe, `CItemHelper.Login()` compares major versions only. With the engine's major version 14:

- a server major above 14 is refused;
- a server major more than 2 below 14 (below 12) is refused;
- a server major of 12, 13 or 14 is accepted, whatever its minor version or service pack.

The engine also refuses a 9.x server whose minor version is not 4 when its own major version is 11. That branch can never apply to 14.0.7 and is not reproduced.

A refusal throws a `CItemException` with faultcode `0` (WIRE-024), faultstring `You are trying to use incompatible utility of version {0} with innovator version {1}.` (WIRE-024 gives the values), and no detail. With no detail the exception has no message of its own, so its `Message` is .NET's default text, `Exception of type 'Aras.Tools.SolutionUpgrade.CItemException' was thrown.`.

The library adds `--skip-version-check`, which skips this comparison (the probe still runs) and is recorded in the log and the JSON summary. A refusal from the library also names the engines whose window fits the server (round 3, Q3). Both are additions; the engine has neither.

The windows are each engine's own comparison (the engine's major version is its assembly's): 12.0 accepts server majors 10 to 12, and 14.0.7 and 14.35 accept 12 to 14. The refusal is the engine's exception unchanged, with the library's text kept apart from it, so the fault code, text and message stay the engine's. That text reads `Engine {engine} does not accept Aras server {major}.{minor}. Engines that accept it: {list}. Use --engine with one of them, or --skip-version-check to run {engine} anyway.`, or, when no engine accepts the server, `Engine {engine} does not accept Aras server {major}.{minor}, and no engine of this library does. Use --skip-version-check to run {engine} anyway.`. A server let through by the flag is recorded as skipped, and one inside the window is never marked skipped.

[12.0] The same comparison with the engine's major version 12:

- a server major above 12 is refused;
- a server major more than 2 below 12 (below 10) is refused;
- a server major of 10, 11 or 12 is accepted, whatever its minor version or service pack.

The engine's 9.x branch needs its own major version to be 11, so it can never apply. A refusal is the same `CItemException` with faultcode `0` and no detail (WIRE-024). Unlike 14.0.7, the window includes servers 10 and 11, so the older ItemType body (EXP-024) and the omitted default `select` (EXP-023) are reachable. Dev is Aras 12.0 SP9, inside the window; 10 and 11 servers are not available to test, so those two branches are specified from the decompile. `--skip-version-check` and the engines named in a refusal are the library's additions, as in 14.0.7.

[14.35] The same comparison as 14.0.7, with the engine's major version 14: a server major above 14 is refused, one more than 2 below (below 12) is refused, and 12, 13 and 14 are accepted whatever their minor version or service pack (`probe.json`, `B.gate`: 9.4, 9.0, 10.0, 11.12, 15.0 and 16.2 refused; 12.0, 13.0, 14.0 and 14.35 accepted). The 11/9.4 branch cannot apply. A refusal now also sets `Inn` to null before it throws, so `IsConnected` is false afterwards and `logout` sends nothing (WIRE-040). The exception is a `CItemException` with faultcode `0`, the text of WIRE-024, no detail, and the default message `Exception of type 'Aras.Tools.SolutionUpgrade.CItemException' was thrown.`. `--skip-version-check` and the engine list in the refusal are the library's additions, as for 14.0.7.

### WIRE-024: The version refusal has faultcode 0 and names no versions (bug)

[14.0.7] Two defects of the refusal are reproduced:

- Its faultcode is `0`, the code that means "no items found" everywhere else. A caller that treats faultcode `0` as an empty result would take a refused server for an empty one.
- Its text interpolates the two version objects, which have no text form, so both placeholders read as the type name: `You are trying to use incompatible utility of version Aras.Tools.SolutionUpgrade.ArasVersion with innovator version Aras.Tools.SolutionUpgrade.ArasVersion.`

Registered in `bugs.md`.

[12.0] Same two defects: faultcode `0`, and a text that names the type of `ArasVersion`, which has no `ToString` in 12.0 either (`You are trying to use incompatible utility of version Aras.Tools.SolutionUpgrade.ArasVersion with innovator version Aras.Tools.SolutionUpgrade.ArasVersion.`). Registered in `bugs.md`.

[14.35] Half of the bug is fixed. The faultcode is still `0`, the code that means "no items found" everywhere else, so a caller that treats faultcode `0` as an empty result still takes a refused server for an empty one. The text now names both versions, with WIRE-022's text: `You are trying to use incompatible utility of version 14.35.0.0 with innovator version {server version}.`, for example `…with innovator version 15.0.5.77.` (`probe.json`, `B.gate`). Registered in `bugs.md` for the faultcode.

## Timeout

### WIRE-030: IOM's timeout defaults

[14.0.7] A new connection has timeout 0, which means "not applied": SOAP requests use .NET's defaults of 100 seconds to get a response and 300 seconds to read its body. A timeout set on the connection, in milliseconds, applies to getting the response; `-1` means no limit; any other negative value is refused. The read timeout is never changed. The OAuth requests (WIRE-010, WIRE-012) ignore the connection timeout and have a 100-second limit. A request that times out becomes the IOM fault `System.Net.WebException: The operation has timed out` with faultcode `999` (WIRE-050).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7: the code that sets the request timeout is unchanged, and so are the 100-second limits of the OAuth `HttpClient` requests. An OAuth request that exceeds its limit makes the fault `System.Threading.Tasks.TaskCanceledException: A task was canceled.` (`HttpClient` reports a timeout that way), which `CItemHelper.Login()` takes for a cancelled login (WIRE-017, WIRE-056). `capture-cancelled-login.jsonl` holds the discovery request for 105 s: the client gives up after about 100 s (the record is `aborted`, `startedMs` 3956 to `endedMs` 101916) and `Login()` returns with no error. A SOAP request that times out is still the `System.Net.WebException` fault of 14.0.7.

### WIRE-031: The context timeout is applied after login

[14.0.7] The `ImportExportManager` constructor copies `SolutionUpgradeContext.Timeout` to the connection when it is above 0 or exactly `-1`, and when the connection is an IOM `HttpServerConnection`. Any other value (0, or a negative other than `-1`) leaves IOM's default. The manager is constructed after `CItemHelper.Login()` (WIRE-002), so login and the version probe always run with the default timeout. The reference host's `timeout=` option defaults to 0; a value that does not parse as an integer prints `\nfailed to parse  TIMEOUT <value>\n` (two spaces) and also gives 0.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7: the `ImportExportManager` constructor copies a context timeout above 0, or exactly `-1`, to an `HttpServerConnection` after login. When `Login()` returned with no connection (WIRE-017), a timeout above 0 or exactly `-1` makes the constructor throw `System.NullReferenceException`, because it reads `Inn.getConnection()` first; with any other timeout the constructor succeeds and the run fails at its first use of the connection (`capture-cancelled-login.jsonl`'s host ended with `System.NullReferenceException`).

## Logoff

### WIRE-040: logout sends Logoff only for an HttpConnectorExtension connection

[14.0.7] `CItemHelper.logout()` logs off only when the connection's type is exactly `HttpConnectorExtension`; for any other type, subclasses of it included, it sends nothing. The reference host's connection is one (WIRE-002), so its run ends with:

```text
SOAPAction: Logoff

<?xml version='1.0' encoding='utf-8' ?><logoff skip_unlock="1" />
```

with the usual headers (WIRE-005). The response is ignored, and a transport failure is swallowed. No token is revoked and no end-session request is made. Under OAuth, an expired token is renewed once (WIRE-018) before the logoff is resent. The library always sends this logoff at the end of a run whose `CItemHelper.Login()` completed (WIRE-002), like the reference host. It sends none when any step of `CItemHelper.Login()` failed: a login fault (WIRE-017), a probe error (WIRE-021, WIRE-054) or a version refusal (WIRE-023), even though IOM's password login and `ValidateUser` may already have succeeded.

[12.0] `CItemHelper.logout()` sends `Logoff` when the connection's type is exactly `HttpConnectorExtension`, through the connection's `Logout()`, for any other type it sends nothing. The reference host's connection is one (WIRE-002), so its run ends with the same request as in 14.0.7: `SOAPAction: Logoff`, body `<?xml version='1.0' encoding='utf-8' ?><logoff skip_unlock="1" />` and the usual headers (capture exchange 32; the answer is `<LogOffResponse><Result>ok</Result></LogOffResponse>`). The rest is as in 14.0.7: the response is ignored, a transport failure is swallowed, no token is revoked, and the library sends the logoff at the end of every run whose `CItemHelper.Login()` completed.

[14.35] `CItemHelper.logout()` first checks `IsConnected` (`Inn` is set); a helper with no connection does nothing. Otherwise it logs off only when the connection's type is exactly `HttpConnectorExtension` (any other type sends nothing), then sets `Inn` to null whatever the type, so a second `logout()` does nothing (`probe.json`, `E.logout`). The `Logoff` request is the 14.0.7 one, byte for byte (`capture.jsonl`, exchange 37: `<logoff skip_unlock="1" />`, headers as WIRE-005). IOM 15 sends it directly rather than through `CallAction`, which changes nothing observable, since re-login on session faults is off (WIRE-018). After it IOM asks the authenticator to log out of its authorization session only when the token provider has one, which the password provider does not, so no token is revoked and no end-session request is made. A transport failure is swallowed (`E.logout`, `http-connector-extension-unreachable`). The library sends the logoff at the end of a run whose `CItemHelper.Login()` completed with a connection, and none after a login fault, a probe error, a version refusal or a cancelled login (WIRE-017, WIRE-021, WIRE-023, WIRE-056).

## Faults

### WIRE-050: Faults IOM writes itself

[14.0.7] IOM never throws for HTTP or transport problems; it writes its own fault into the response document:

```text
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><SOAP-ENV:Fault>\r\n\t<faultcode>999</faultcode>\r\n\t<faultstring>MESSAGE</faultstring>\r\n\t<faultactor>HttpServerConnection</faultactor>\r\n\t<detail>unknown error</detail>\r\n</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>
```

- For any exception (connection failure, timeout, a 4xx or 5xx status other than WIRE-018's retry, a body that is not XML) the faultstring is `<exception type full name>: <message>`, for example `System.Net.WebException: The remote server returned an error: (500) Internal Server Error.`. The body of an error response is discarded. The .NET message texts are reproduced in English.
- A body that is not XML gives `System.Xml.XmlException: <message>`, with .NET's message and its line and position, for example `Root element is missing.` for an empty body and `Data at the root level is invalid. Line 1, position 1.` for text.
- A request the caller gives that is not XML is not a fault: loading it fails with the same `XmlException` before any request is made.
- For an OAuth error (WIRE-015) the faultcode, faultstring, faultactor `OAuthServer` and detail are as WIRE-015 says.
- When a login response has no fault and no user id, the fault is IOM's "Unknown error" item: faultcode `1`, an empty faultactor and faultstring `Unknown error`.

The server itself returns faults with HTTP 200 (the capture's "No items" faults), so they reach the engine as received.

[12.0] Same as 14.0.7 for the faults IOM writes itself (the same envelope, faultcode `999`, faultactor `HttpServerConnection`, faultstring `<exception type full name>: <message>`, and the OAuth errors with faultactor `OAuthServer`). The exceptions behind them differ from 14.0.7's where WIRE-011 and WIRE-012 say so, and the item returned by `Login()` for a missing id is `Failed to login` (WIRE-015).

[14.35] Same as 14.0.7 (`SetError` and the OAuth variant are the same code, and the capture's rejected login shows the OAuth fault: faultcode `invalid_grant`, faultactor `OAuthServer`, detail `unknown error`).

### WIRE-051: CItemException carries the fault

[14.0.7] An engine error is a `CItemException` with a `faultcode` (an integer), `faultstring` and `faultdetail`. Built from a fault response:

- `faultcode` is the response's `faultcode` text parsed as an integer, or `1` when it does not parse (for example IOM's OAuth codes such as `invalid_grant`, or `SOAP-ENV:Server`);
- `faultdetail` is the concatenated text of the whole `detail` element (an Aras fault's `af:legacy_detail` and `af:legacy_faultstring` texts run together), or empty;
- built from the response alone, `faultstring` and the message are the whole response document's outer XML;
- built from a request and its response (`applyAML`, WIRE-006), `faultstring` and the message are `Server error\r\n\r\nRequest: {request AML}\r\n\r\nResponce: {response outer XML}`, with Aras's spelling `Responce`.

The engine's own errors use the four-part constructor: an explicit faultcode, faultstring, detail and inner exception, with the detail as the message. A null detail leaves the exception without a message, so its `Message` is .NET's default text (WIRE-023).

[12.0] `CItemException` has the constructors of 14.0.7 except the one that takes a request and a response. Built from a fault response (`CItemException(item)`): `faultcode` is the response's `faultcode` text parsed as an integer, or `1` when it does not parse; `faultdetail` is the concatenated text of the whole `detail` element, or empty; `faultstring` and the message are the whole response document's outer XML. `applyAML` uses this form (WIRE-006), so every engine error that comes from a failed request carries the response only. The four-part constructor is as in 14.0.7.

[14.35] The same fields from the same parts of a fault. The texts that carry the response, and the request when there is one, are pretty-printed:

- built from the response alone, `faultstring` and the message are `GetPrettyXml` of the response document;
- built from a request and its response, `faultstring` and the message are `Server error\r\n\r\nRequest (formatted):\r\n{GetPrettyXml(request AML)}\r\n\r\nResponse (formatted):\r\n{GetPrettyXml(response)}`. The spelling `Responce` is corrected.

`GetPrettyXml(text)` is the empty string for a null text. Otherwise it loads the text into a new `XmlDocument` (whitespace-only text nodes of the input are dropped, because that document does not preserve whitespace) and writes the document to a string with an `XmlWriter` that has `Indent = true`, two spaces of indent, `\r\n` line ends, `NewLineOnAttributes = false` and `OmitXmlDeclaration = true`. The result has no line end after the last tag. An element with only text, CDATA or no content is written on one line; the escaping of text and attributes is that of EXP-424. A text that is not well-formed XML throws `XmlException` from the exception's constructor, so the caller sees that instead of the fault. The request is a document the engine has just parsed (`loadAML`) and the response is a document IOM built, so this does not happen in practice.

*Observed* (`S3` in `fixtures/export-output/run-export-14.35.txt`, a scripted fault with faultcode 1): the `faultstring` of the logged block is

```text
Server error

Request (formatted):
<Item isNew="1" isTemp="1" type="List" action="get">
  <id>A05</id>
</Item>

Response (formatted):
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N">
  <SOAP-ENV:Body>
    <SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault">
      <faultcode>1</faultcode>
      <faultstring><![CDATA[scripted failure for A05]]></faultstring>
      <detail>
        <af:legacy_detail><![CDATA[scripted failure for A05]]></af:legacy_detail>
      </detail>
    </SOAP-ENV:Fault>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>
```

and the log block reads `faultdetail: scripted failure for A05` and `faultcode:   1` after it.

The stub-connection probe agrees (`fixtures/wire/14.35-probe/probe.json`, `D.applyAML`: faultcodes 0, 1 and `SOAP-ENV:Server` all give the indented text above, with `faultdetail` the text of `detail`). The login failure of WIRE-017 is the exception: its text is the fault as IOM wrote it, not indented. Through `applyAML` a request that is not well-formed never reaches the constructor, because IOM has already parsed it (`malformed-request` throws `XmlException` from `loadAML`).

### WIRE-052: Faultcode 0 means "no items"

[14.0.7] Throughout the engine a fault whose `faultcode` is `0` means "no items matched". The server answers a `get` that finds nothing with faultcode `0` and faultstring `No items of type {type} found.`, as the capture shows. Each request's own rule says whether faultcode `0` is an empty result or an error; the probe's rule is WIRE-021. The version refusal reuses the code (WIRE-024).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7: faultcode `0` is "no items", and the server's answer is the one in the probe (`No items of type {type} found.`). The version refusal still reuses the code (WIRE-024).

### WIRE-053: Error-item accessors

[14.0.7] A response is a fault when it has `Envelope/Body/Fault`, matched by local name in the SOAP envelope namespace or in no namespace. The fault's code, string, detail and actor are the inner text of its `faultcode`, `faultstring`, `detail` and `faultactor` children, or empty when absent. The text of a fault item is the response document's whole outer XML, envelope included, with its whitespace.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7 (IOM's `Item.XPathFault` and the accessors are unchanged).

### WIRE-054: The probe crashes when only one of VersionMajor and VersionMinor exists (bug)

[14.0.7] When the first probe request (WIRE-020) returns exactly one Variable, IOM narrows the result to that item, and the engine's lookups, written from the envelope down, then find nothing for either Variable. Reading the first match throws `System.IndexOutOfRangeException` with the message `IndexOutOfRangeException`, even for the Variable that exists. It is not a `CItemException`, so it escapes login as an unexpected error. A correct engine would read the Variable that exists and report the missing one. Registered in `bugs.md`.

[12.0] Same crash with the same text: the first probe request and its lookups are written the same way (`System.IndexOutOfRangeException`, message `IndexOutOfRangeException`). Registered in `bugs.md`.

[14.35] Still present. With one of the two Variables in the first answer, the probe throws `System.IndexOutOfRangeException` with the message `IndexOutOfRangeException`, for `VersionMajor` alone and for `VersionMinor` alone (`probe.json`, `A.probe`, `only-major-row`, `only-minor-row`); only the first request has been sent. Registered in `bugs.md`.

### WIRE-055: Non-ASCII password characters hash as `?` (bug)

[14.0.7] IOM hashes the password's ASCII bytes (WIRE-014), so every non-ASCII character becomes `?` first. A password with non-ASCII characters is sent as the digest of a different password, and passwords that differ only in those characters are interchangeable. A correct client would hash the UTF-8 bytes. Registered in `bugs.md`.

[12.0] Same: IOM 12 hashes the ASCII bytes of the password with the same code (`Md5`, `Sha256` and `ParoleHash` are identical in both IOMs). Registered in `bugs.md`.

[14.35] Narrower. IOM 15 hashes the ASCII bytes only when it computes a digest, which is at the retry (WIRE-013) and in the legacy login; the first token request carries the password as given, UTF-8 form-encoded. `probe.json` (`F.iomHelpers`) shows `p` `ä` `ss` `€` hashing as `p?ss?` for both functions. A password with non-ASCII characters is therefore refused as a plain password and sent on retry as the digest of a different password.

### WIRE-056: A cancelled login returns without error and the run goes on with no connection (bug)

[14.0.7] Does not apply: the engine has no such test, and a login fault with that text throws the `-100` login failure like any other (WIRE-017), as the same probe against the 14.0.7 classes shows (`fixtures/wire/14.0.7-probe/probe.json`, `C.loginFaults`).

[14.35] `CItemHelper.Login()` returns with no error when the login fault's faultstring contains `System.Threading.Tasks.TaskCanceledException` (WIRE-017). The helper then has no connection (`IsConnected` is false, `Inn` is null) and no server version. A host that goes on, as ConsoleUpgrade does, builds its `ImportExportManager`, which reads the connection when a timeout is set (WIRE-031) and otherwise fails at the first request or at the first read of `InnovatorVersion`: an unhandled `System.NullReferenceException` with the text `Object reference not set to an instance of an object.` (`capture-cancelled-login.jsonl` and the host output). Nothing is sent after the aborted request: not a probe, not a logoff. The test is on the text, so a server fault that merely quotes the exception name takes the same path (`probe.json`, `C.loginFaults`, `cancelled-text-elsewhere`). The library reproduces it: its login returns no connection, and the first use fails with that exception text. Registered in `bugs.md`.

## Concurrency

### WIRE-060: Export issues requests on one connection concurrently

[14.0.7] The engine is single-threaded: its export loops over the items in turn, so it sends one request at a time.

[14.35] The export fetches a package's items with `Parallel.ForEach`, so several items' requests are in flight together. They all share the one `Innovator` and its connection: one cookie container, one stored token, and one `LOCALE` and `TIMEZONE_NAME` pair, and the connection's timeout applies to each (WIRE-030). Nothing in the engine or IOM limits the number of connections; the limit is the runtime's. Observed (`fixtures/wire/14.35-reference-host/`):

- three items, the proxy on `localhost` (`capture-parallel.jsonl`): the item and type lookups run on 3 TCP connections with up to 3 requests in flight (the runtime does not cap connections to a loopback host);
- four items, the proxy reached through a non-loopback address (`capture-parallel-remote.jsonl`): 2 connections and never more than 2 requests in flight, which is .NET Framework's default of two connections per host for a console application.

What is sent before the items (login, probe, package definition and dependency lookups) and after them (the unknown-package lookups and `Logoff`) is sequential, and the order of the requests of different items is not fixed. In these runs the status line reads `Item 1 of N` for every item. A library client sends the same requests with at most the configured parallelism (ticket 59) and need not match the runtime's connection cap; it must keep one cookie jar, one token and one pair of locale headers for all of them.

## Not ported

### WIRE-090: Client-certificate login is held

[14.0.7] `HttpConnectorExtension.Login()` picks a client certificate from the Windows certificate store and installs it for every later request, but only when the host set a certificate find value; otherwise it is IOM's password login (WIRE-010 to WIRE-016). `CertificateUtils` (finding the certificate, and probing over TLS whether the server requires one) and the certificate accessors of `HttpConnectorExtension` and `SolutionUpgradeContext` serve only that path, and are not ported. The constructor and `Login()` themselves are in scope (to be ported) for their password path (WIRE-002, WIRE-005, WIRE-010 to WIRE-016, WIRE-040); only their certificate branch is held: see `roadmap/hold/certificate-login.md`. The library never selects a certificate, which is what the reference host does with its defaults.

[12.0] There is no certificate code in 12.0, so nothing is held. `HttpConnectorExtension` has only the four-argument constructor and no `Login` override, `SolutionUpgradeContext` has no certificate settings, and there is no `CertificateUtils`. The constructor is in scope (WIRE-002, WIRE-005); the library never selects a certificate (`roadmap/hold/certificate-login.md`).

[14.35] Held, and the held surface grew. `HttpConnectorExtension` is the same (the nine-argument constructor with its certificate defaults, whose find value is empty, and `Login()` that installs a certificate only when one is set) plus a constructor taking an IOM token provider and a protocol type. `CertificateUtils` changes how it selects certificates: `GetClientCertificates` now takes the certificates in the current user's `My` store that are valid at the current time and have a private key, and keeps those whose key usage includes non-repudiation or whose enhanced key usage includes client authentication (1.3.6.1.5.5.7.3.2); 14.0.7 took the ones with key usage non-repudiation that were valid. `IsCertificateRequired` now refuses a null URI, and `FindCertificate` is unchanged. `SolutionUpgradeContext` keeps the five certificate settings. None is ported: see `roadmap/hold/certificate-login.md`, which records the selection rules for the day they are. `ConsoleUpgrade.exe.config` has its client-certificate provider section commented out in both builds.

