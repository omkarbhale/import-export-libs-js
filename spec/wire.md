# Wire protocol, login, version probe and gate

This document specifies everything the engine sends to the Aras server and how. The library replaces IOM as well as `Libs.dll` (round 1, Q3), so these rules describe IOM's observable behaviour below `Libs` too: the OAuth login, the request framing, the fault model and the timeout.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`), and of `IOM.dll` 14.0.7.35492 and Aras's `ConsoleUpgrade.exe` 14.0.7 (decompiled locally with the same `ilspycmd`, never committed);
- the proxy capture of the reference host against dev, `fixtures/wire/14.0.7-reference-host/` (WIRE-002). Request headers and bodies quoted below are from that capture.

IOM 14.0.7 targets .NET Framework 4.7.2. Its SOAP calls go through `HttpWebRequest` and its OAuth calls through `HttpClient`, so some wire details (header order, `Expect: 100-continue`) come from the framework rather than from IOM's code. The capture pins them.

## Hosts

### WIRE-001: The engine is driven by a host that owns the connection

[14.0.7] The engine never builds its own connection on the import, export or language-pack paths. A host constructs an IOM `HttpServerConnection` (or a subclass), hands it to `CItemHelper`, which wraps it in an `Innovator` (`IomFactory.CreateInnovator`), and calls `CItemHelper.Login()` before any import or export. `CItemHelper` exposes the `Innovator` it made (`Inn`) and the server version that `Login` read (`InnovatorVersion`, WIRE-020). Its `Cookie` property is set to null at construction and never read. The library's client plays the host's role: it takes the server URL, database, user name and password, logs in (WIRE-010 to WIRE-016), and runs the probe and gate (WIRE-020 to WIRE-024) before the operation.

### WIRE-002: The 14.0.7 reference host is Aras's ConsoleUpgrade.exe

[14.0.7] Connection-level behaviour (headers, login, timeout and logoff) is specified as Aras's own 14.0.7 console tool, `ConsoleUpgrade.exe`, produces it. It:

1. builds an `HttpConnectorExtension` through its nine-argument constructor, passing the URL, database, user name and plain password as given, and its certificate defaults: store location `CurrentUser`, store name `My`, find type `FindBySubjectName`, an empty find value and "valid only" true. With an empty find value the certificate path is skipped (see WIRE-090), and the connection is IOM's `HttpServerConnection` with locale `en-US`. The constructor passes no time zone, so IOM falls back to the machine's own zone (WIRE-005);
2. calls `CItemHelper.Login()` (login, probe and gate);
3. constructs the `ImportExportManager`, which applies `timeout=` (WIRE-031), and runs the export or import;
4. calls `CItemHelper.logout()` in a `finally`, after success or failure of the operation (WIRE-040). When `Login()` itself throws, no logoff is sent, because the connection is built and logged in outside that `try`.

The oracle hosts (`oracle/README.md`) differ on purpose: their recording connection is not exactly an `HttpConnectorExtension`, so their final `logout()` sends nothing. The capture in `fixtures/wire/14.0.7-reference-host/` was recorded with `oracle/wire-capture/`, which reproduces steps 1 to 4 with the vendored 14.0.7 DLLs behind a recording proxy, for a one-item export.

## Request framing

### WIRE-003: The server URL is normalised to `Server/InnovatorServer.aspx`

[14.0.7] If the given URL does not end with `InnovatorServer.aspx` (compared case-insensitively), the base URL is the given URL, plus `/` unless it already ends with one, plus `Server/`. Otherwise the base is the URL with that suffix removed. The suffix removal is a case-insensitive regular expression in which the `.` matches any character. SOAP requests go to the base plus `InnovatorServer.aspx`. The discovery URL (WIRE-010) is the base plus `OAuthServerDiscovery.aspx`. No other de-duplication happens: `http://h/Innovator/Server` becomes `http://h/Innovator/Server/Server/InnovatorServer.aspx`, and a query string or trailing slash after `InnovatorServer.aspx` defeats the suffix check.

### WIRE-004: Every SOAP call is a POST of the bare XML root, not an envelope

[14.0.7] Each call is an HTTP/1.1 `POST` to the `InnovatorServer.aspx` URL. The body is the UTF-8 bytes, with no BOM, of `<?xml version='1.0' encoding='utf-8' ?>` followed directly, with no newline, by the outer XML of the request document's root element. There is no SOAP envelope on requests; only responses are envelopes.

- `ApplyItem` (from `Item.apply`, used by `CItemHelper.applyAML`, WIRE-006) sends the single `<Item>` element as the root.
- `ApplyAML` (from `Innovator.applyAML`, used by the version probe, WIRE-020, and the cmf query of the export) sends the root the caller wrote, usually `<AML>…</AML>`, with nothing added.
- `ValidateUser` sends `<Item />` (WIRE-015) and `Logoff` sends `<logoff skip_unlock="1" />` (WIRE-040).

The root is re-serialised by .NET's DOM, which is observable: attribute values are written in double quotes, an empty element is written `<X />` with a space, and anything before the root element, such as the leading `\r\n\t\t\t` of the probe's AML literals, is dropped. Whitespace inside the root is kept byte for byte, including CRLF and tab characters (WIRE-007). Values interpolated by the engine are not escaped (AGENTS.md rule 7), so the request is whatever the DOM makes of the engine's string.

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
- The library also sends a Windows time zone id as the initial `TIMEZONE_NAME`. On Windows it uses the machine's local id. Elsewhere it maps the local IANA zone to its Windows id through the CLDR `windowsZones` table. That table names zones by CLDR's canonical ids, which are often older IANA names, so the local zone is first resolved through CLDR's time zone aliases (`bcp47/timezone.xml`) to its canonical id: `Asia/Kolkata` becomes `Asia/Calcutta`. The Windows id is then taken from the `mapZone` entry whose space-separated type list contains that id, preferring territory `001`; `Asia/Calcutta` gives `India Standard Time`. A `--time-zone <Windows id>` flag overrides the value on any platform. When no flag is given and the local zone has no mapping, the run stops with a usage error that names the zone and the flag. This is not a deviation: the header carries the same value the reference host sends on the same machine.
- The authorization header is `Authorization: Bearer <token>` when the discovery document's `protocol_info.protocol_type` is `Standard`. For `Custom` the header is named by `protocol_info.authorization_header` (Aras uses `X-Aras-Authorization`). Under the legacy login (WIRE-016) it is replaced by `AUTHUSER`, `AUTHPASSWORD` and `DATABASE`. With OAuth there is no `DATABASE` header.
- Cookies: the connection keeps one cookie container and replays what the server sets, in practice `ASP.NET_SessionId`, set by the `ValidateUser` response.
- No `User-Agent`, `Accept`, `Accept-Encoding`, `Cache-Control` or `Content-Encoding` is sent. Compression is off. The first request on a new TCP connection may also carry `Connection: Keep-Alive`; that header belongs to the transport and is not part of the contract.
- Port note: `Host`, `Content-Length` and `Expect` are what .NET writes. A Node client need not match the transport headers (`Host`, `Connection`, `Content-Length`, `Expect`) byte for byte, but sends the others with these names, values and order.

### WIRE-006: `CItemHelper.applyAML` sends ApplyItem and throws on any fault

[14.0.7] `CItemHelper.applyAML(aml)` loads the AML string into a new IOM item (`Innovator.newItem().loadAML(aml)`) and applies it, which is one `ApplyItem` call (WIRE-004). Because `Item.apply` requires a single `<Item>` root, a string with a different root is refused by IOM before anything is sent. When the response is a fault it throws a `CItemException` built from the request AML and the response (WIRE-051), whatever the faultcode, including `0` ("no items"). Callers that treat faultcode `0` as an empty result catch that exception and test its `faultcode` (WIRE-052). Otherwise it returns the whole response document, envelope included.

### WIRE-007: The AML string literals are part of the request bytes

[14.0.7] Every AML literal the engine sends is reproduced with its exact whitespace. Where a literal contains CR LF and tab characters inside the root element, they reach the wire unchanged, as the version probe's requests show (WIRE-020). Whitespace before the root is dropped (WIRE-004). Each area document that defines a request literal gives it with its whitespace; this rule is the framing that all of them rely on.

## Login

### WIRE-010: Login starts with OAuth server discovery

[14.0.7] `HttpServerConnection.Login()` resolves the authenticator first. On a new connection that is three GET requests, made with a fresh cookie container each and no custom headers:

1. `GET <base>OAuthServerDiscovery.aspx`. The JSON body's `locations[*].uri` values are the OAuth server URLs, reordered so that those whose host equals the discovery URL's host (case-insensitively) come first, keeping their order otherwise. A missing `locations` gives an empty list.
2. `GET <uri>.well-known/openid-configuration` for each location in turn (a `/` is added to the uri when missing), until one succeeds. The document must have non-empty `issuer`, `jwks_uri`, `authorization_endpoint`, `token_endpoint` and `end_session_endpoint`, and a `protocol_info` object with `protocol_type` (`Standard` or `Custom`), `authorization_header`, `www_authenticate_header` and `unauthorized_status_code`. `protocol_version` is optional; when it is absent or does not parse it counts as `0.0`. IOM also remembers the last URL that worked, process-wide, and tries it first on a later login in the same process.
3. `GET <jwks_uri>`, on every login. A non-success status or an empty body fails login.

The capture records the three requests; against dev the discovery answer is `{"locations":[{"uri":"http://localhost/12sp9/OAuthServer/"}]}`. The server builds that uri from the request's host without its port.

### WIRE-011: Protocol version 1.0 or later selects the OAuth password grant

[14.0.7] When the discovery document's `protocol_version` is 1.0 or more, IOM authenticates with a bearer token from the password grant (WIRE-012), sent in the header WIRE-005 names. When it is below 1.0 or missing, IOM uses the legacy headers (WIRE-016).

Only a discovery that "is not there" falls back to the legacy headers: a 404 from `OAuthServerDiscovery.aspx`, or an empty body. Every other discovery failure fails login with a fault (WIRE-015): another HTTP error status, a connection failure, a body that is not JSON, an empty `locations` list, every OpenID configuration request failing, a missing required field, or a failed key set request. A failed discovery is not remembered, so the next call on the connection tries discovery again.

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
- `<digest>` is the password's hash (WIRE-014): the lowercase MD5 hex of its ASCII bytes. The capture shows the 32-character lowercase MD5 form.
- An empty database or user name fails login before any request (faultstring `System.ArgumentException: Database`, or `…: UserName`).
- A 200 or 400 response is read as JSON. A body with a non-blank `error` is an OAuth error whose code is `error` and whose message is `error_description` (looked up case-insensitively), or `error` when there is no description. Any other status is an OAuth error with code `server_error` and message `(<status name>) <reason phrase>`, for example `(InternalServerError) Internal Server Error`. A body that is not JSON is an OAuth error whose code and message are both the JSON parser's message.
- Otherwise the token is `access_token`. `expires_in` is ignored: the token is kept for the life of the connection, with no expiry tracking and no refresh.

### WIRE-013: The SHA-256 retry on `incompatible_hash_use_sha256`

[14.0.7] When the token request fails with the OAuth error code `incompatible_hash_use_sha256` exactly, IOM switches the digest to SHA-256 (WIRE-014) and sends the same request once more. No other code is retried; `incompatible_hash_use_md5` is not. When the password was given already as a 32-character hex string (taken as an MD5 hash), the switch is impossible and the original error stands.

### WIRE-014: Password digests

[14.0.7] The password reaches the server only as a digest:

- A password that already looks like a hash is used verbatim: 32 hex characters (any case) as MD5, 64 hex characters as SHA-256.
- Otherwise the MD5 digest is the lowercase hex of MD5 over the password's ASCII bytes, and the SHA-256 digest is the uppercase hex of SHA-256 over the same bytes.
- ASCII encoding turns every non-ASCII character into `?` (0x3F) before hashing, so two passwords that differ only in non-ASCII characters have the same digest. This is reproduced (WIRE-055).

The same digest is used in the token request (WIRE-012) and in the legacy `AUTHPASSWORD` header (WIRE-016). The reference host passes the password plain; the library takes it from `ARAS_PASSWORD` or stdin (AGENTS.md) and never puts it on a command line.

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

### WIRE-016: Legacy header login

[14.0.7] Under the legacy authenticator (WIRE-011) there is no token request. Every SOAP request, `ValidateUser` included, carries `AUTHUSER: <user>`, `AUTHPASSWORD: <digest>` (WIRE-014, MD5 first) and `DATABASE: <db>` in place of the authorization header. When a fault's `detail/supported_authentication_schema/schema` names a hashing mode other than the current one, IOM switches to that mode and resends the call; a mode other than exactly `MD5` or `SHA256` becomes a `999` fault. Dev serves OAuth, so this path is specified from the decompile only.

### WIRE-017: CItemHelper.Login turns a login fault into faultcode -100

[14.0.7] `CItemHelper.Login()` calls `Login()` on the connection only when it is an IOM `HttpServerConnection` (any subclass). When the result is a fault it throws a `CItemException` with faultcode `-100`, and with faultstring and message both `Failed login to Innovator; original error: {0}`, where `{0}` is the whole fault document's outer XML (envelope included). A connection that is not an `HttpServerConnection` is assumed to be logged in already, and only the probe and gate run.

### WIRE-018: One token renewal on an unauthorized status

[14.0.7] Under OAuth, when a SOAP request is answered with the discovery document's `unauthorized_status_code` (401 for `Standard`, 498 for `Custom`), IOM fetches a new token with a fresh password grant (WIRE-012) and resends the request once. A second refusal becomes an IOM `999` fault (WIRE-050). The legacy login never retries. IOM's re-login on session-timeout faults is off by default and neither the engine nor the reference host turns it on, so it does not happen.

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

### WIRE-021: Reading the probe results

[14.0.7] The probe reads its results as follows. Every other fault throws a `CItemException` built from the response alone (WIRE-051), not a login error.

- **Major and minor.** A fault on the first request throws. When both Variables come back, `value` of the `VersionMajor` and `VersionMinor` items are read and parsed as invariant integers at the end of the probe. When only one of them exists, the probe throws `System.IndexOutOfRangeException` (WIRE-054). A missing `value` or a non-integer fails the parse (`ArgumentNullException` or `FormatException`).
- **Service pack.** A fault with faultcode exactly `0` gives 0. On success, `value` with every `SP` removed is parsed as an integer; an empty or missing value, or one that still does not parse (for example `SP9 SU1`), gives 0. Dev answers `SP9`, which gives 9.
- **Build and service update.** A fault with faultcode exactly `0` gives 0. On success `value` is parsed as an invariant integer and a missing or non-integer value throws.

The result is the server version (major, minor, service pack, build, service update), kept as `CItemHelper.InnovatorVersion` for the rest of the run.

### WIRE-022: Version text

[14.0.7] The server version is written as text in two ways. `InnovatorVersionFullString` is `{major}.{minor} SP{servicePack} Build {build}` when the major version is below 14, and `{major}.{minor}.{serviceUpdate}.{build}` otherwise (dev: `12.0 SP9 Build <build>`). The engine's log of its input parameters writes it as `Innovator version: {0}`. The engine's own version for the gate (WIRE-023) is its assembly's major and minor version with the other parts 0: `14.0` for 14.0.7.35492. The version type has no text form of its own, which WIRE-024 reproduces.

### WIRE-023: The version gate accepts servers 12 to 14

[14.0.7] After the probe, `CItemHelper.Login()` compares major versions only. With the engine's major version 14:

- a server major above 14 is refused;
- a server major more than 2 below 14 (below 12) is refused;
- a server major of 12, 13 or 14 is accepted, whatever its minor version or service pack.

The engine also refuses a 9.x server whose minor version is not 4 when its own major version is 11. That branch can never apply to 14.0.7 and is not reproduced.

A refusal throws a `CItemException` with faultcode `0` (WIRE-024), faultstring `You are trying to use incompatible utility of version {0} with innovator version {1}.` (WIRE-024 gives the values), and no detail, so its message is empty.

The library adds `--skip-version-check`, which skips this comparison (the probe still runs) and is recorded in the log and the JSON summary. A refusal from the library also names the engines whose window fits the server (round 3, Q3). Both are additions; the engine has neither.

### WIRE-024: The version refusal has faultcode 0 and names no versions (bug)

[14.0.7] Two defects of the refusal are reproduced:

- Its faultcode is `0`, the code that means "no items found" everywhere else. A caller that treats faultcode `0` as an empty result would take a refused server for an empty one.
- Its text interpolates the two version objects, which have no text form, so both placeholders read as the type name: `You are trying to use incompatible utility of version Aras.Tools.SolutionUpgrade.ArasVersion with innovator version Aras.Tools.SolutionUpgrade.ArasVersion.`

Registered in `bugs.md`.

## Timeout

### WIRE-030: IOM's timeout defaults

[14.0.7] A new connection has timeout 0, which means "not applied": SOAP requests use .NET's defaults of 100 seconds to get a response and 300 seconds to read its body. A timeout set on the connection, in milliseconds, applies to getting the response; `-1` means no limit; any other negative value is refused. The read timeout is never changed. The OAuth requests (WIRE-010, WIRE-012) ignore the connection timeout and have a 100-second limit. A request that times out becomes the IOM fault `System.Net.WebException: The operation has timed out` with faultcode `999` (WIRE-050).

### WIRE-031: The context timeout is applied after login

[14.0.7] The `ImportExportManager` constructor copies `SolutionUpgradeContext.Timeout` to the connection when it is above 0 or exactly `-1`, and when the connection is an IOM `HttpServerConnection`. Any other value (0, or a negative other than `-1`) leaves IOM's default. The manager is constructed after `CItemHelper.Login()` (WIRE-002), so login and the version probe always run with the default timeout. The reference host's `timeout=` option defaults to 0; a value that does not parse as an integer prints `\nfailed to parse  TIMEOUT <value>\n` (two spaces) and also gives 0.

## Logoff

### WIRE-040: logout sends Logoff only for an HttpConnectorExtension connection

[14.0.7] `CItemHelper.logout()` logs off only when the connection's type is exactly `HttpConnectorExtension`; for any other type, subclasses of it included, it sends nothing. The reference host's connection is one (WIRE-002), so its run ends with:

```text
SOAPAction: Logoff

<?xml version='1.0' encoding='utf-8' ?><logoff skip_unlock="1" />
```

with the usual headers (WIRE-005). The response is ignored, and a transport failure is swallowed. No token is revoked and no end-session request is made. Under OAuth, an expired token is renewed once (WIRE-018) before the logoff is resent. The library always sends this logoff at the end of a run that logged in, like the reference host, and sends none when login failed.

## Faults

### WIRE-050: Faults IOM writes itself

[14.0.7] IOM never throws for HTTP or transport problems; it writes its own fault into the response document:

```text
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><SOAP-ENV:Fault>\r\n\t<faultcode>999</faultcode>\r\n\t<faultstring>MESSAGE</faultstring>\r\n\t<faultactor>HttpServerConnection</faultactor>\r\n\t<detail>unknown error</detail>\r\n</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>
```

- For any exception (connection failure, timeout, a 4xx or 5xx status other than WIRE-018's retry, a body that is not XML) the faultstring is `<exception type full name>: <message>`, for example `System.Net.WebException: The remote server returned an error: (500) Internal Server Error.`. The body of an error response is discarded. The .NET message texts are reproduced in English.
- For an OAuth error (WIRE-015) the faultcode, faultstring, faultactor `OAuthServer` and detail are as WIRE-015 says.
- When a login response has no fault and no user id, the fault is IOM's "Unknown error" item: faultcode `1`, an empty faultactor and faultstring `Unknown error`.

The server itself returns faults with HTTP 200 (the capture's "No items" faults), so they reach the engine as received.

### WIRE-051: CItemException carries the fault

[14.0.7] An engine error is a `CItemException` with a `faultcode` (an integer), `faultstring` and `faultdetail`. Built from a fault response:

- `faultcode` is the response's `faultcode` text parsed as an integer, or `1` when it does not parse (for example IOM's OAuth codes such as `invalid_grant`, or `SOAP-ENV:Server`);
- `faultdetail` is the concatenated text of the whole `detail` element (an Aras fault's `af:legacy_detail` and `af:legacy_faultstring` texts run together), or empty;
- built from the response alone, `faultstring` and the message are the whole response document's outer XML;
- built from a request and its response (`applyAML`, WIRE-006), `faultstring` and the message are `Server error\r\n\r\nRequest: {request AML}\r\n\r\nResponce: {response outer XML}`, with Aras's spelling `Responce`.

The engine's own errors use the four-part constructor: an explicit faultcode, faultstring, detail and inner exception, with the detail as the message.

### WIRE-052: Faultcode 0 means "no items"

[14.0.7] Throughout the engine a fault whose `faultcode` is `0` means "no items matched". The server answers a `get` that finds nothing with faultcode `0` and faultstring `No items of type {type} found.`, as the capture shows. Each request's own rule says whether faultcode `0` is an empty result or an error; the probe's rule is WIRE-021. The version refusal reuses the code (WIRE-024).

### WIRE-053: Error-item accessors

[14.0.7] A response is a fault when it has `Envelope/Body/Fault`, matched by local name in the SOAP envelope namespace or in no namespace. The fault's code, string, detail and actor are the inner text of its `faultcode`, `faultstring`, `detail` and `faultactor` children, or empty when absent. The text of a fault item is the response document's whole outer XML, envelope included, with its whitespace.

### WIRE-054: The probe crashes when only one of VersionMajor and VersionMinor exists (bug)

[14.0.7] When the first probe request (WIRE-020) returns exactly one Variable, IOM narrows the result to that item, and the engine's lookups, written from the envelope down, then find nothing for either Variable. Reading the first match throws `System.IndexOutOfRangeException` with the message `IndexOutOfRangeException`, even for the Variable that exists. It is not a `CItemException`, so it escapes login as an unexpected error. A correct engine would read the Variable that exists and report the missing one. Registered in `bugs.md`.

### WIRE-055: Non-ASCII password characters hash as `?` (bug)

[14.0.7] IOM hashes the password's ASCII bytes (WIRE-014), so every non-ASCII character becomes `?` first. A password with non-ASCII characters is sent as the digest of a different password, and passwords that differ only in those characters are interchangeable. A correct client would hash the UTF-8 bytes. Registered in `bugs.md`.

## Not ported

### WIRE-090: Client-certificate login is held

[14.0.7] `HttpConnectorExtension.Login()` picks a client certificate from the Windows certificate store and installs it for every later request, but only when the host set a certificate find value; otherwise it is IOM's password login (WIRE-010 to WIRE-016). `CertificateUtils` (finding the certificate, and probing over TLS whether the server requires one) and the certificate accessors of `HttpConnectorExtension` and `SolutionUpgradeContext` serve only that path, and are not ported. The constructor and `Login()` themselves are in scope (to be ported) for their password path (WIRE-002, WIRE-005, WIRE-010 to WIRE-016, WIRE-040); only their certificate branch is held: see `roadmap/hold/certificate-login.md`. The library never selects a certificate, which is what the reference host does with its defaults.
