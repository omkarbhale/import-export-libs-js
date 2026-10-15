# 14.0.7 reference-host wire capture

What engine 14.0.7's reference host, Aras's `ConsoleUpgrade.exe` (`spec/wire.md`, WIRE-002), sends below the AML, recorded once against dev for ticket 09. The oracle transcripts hold only the AML given to `CallAction` and the response envelope, so this capture is the evidence for the request framing, headers, OAuth discovery and token exchange, and logoff (WIRE-003 to WIRE-040).

- **Run:** a one-item export (`com.aras.innovator.servicereporting`, `List` "Report Format Types") through `oracle/wire-capture/`: `ReferenceHost.cs` connects as ConsoleUpgrade does with the vendored 14.0.7 `Libs.dll` and `IOM.dll`, and `proxy.mjs` records every exchange between it and the dev server (`http://localhost:18089/12sp9` forwarded to dev, database `12sp9`, user `admin`).
- **`capture.jsonl`:** one exchange per line, in order: `seq`, `request` (`method`, `url`, `httpVersion`, `headers` as `[name, value]` pairs in wire order, `body`) and `response` (`status`, `headers`, `body`).
- **Exchanges:** 1 to 3 discovery, OpenID configuration and key set; 4 the password grant; 5 `ValidateUser`; 6 IOM's user record read; 7 to 10 the version probe; 11 to 34 the export's requests; 35 `Logoff`.
- **Edits made to the recording:**
  - Scrubbed: the password digest in the token request, the access token in its response and in every `Authorization` header (`SCRUBBED`, `SCRUBBED_TOKEN`), and the `ASP.NET_SessionId` cookie value.
  - The discovery response's `uri` points at the OAuth server's host without the proxy's port. The proxy rewrote it to its own origin, so the token exchange went through it. `body` is what the server sent; `clientBody` is what the host received.
  - Response bodies above 16 KiB are replaced by `{ "length", "sha256" }`. They are export data, which the transcript fixtures carry. Request bodies are complete.

Re-record with `oracle/wire-capture/` (see the header of `capture-14.0.7.ps1`), then `ARAS_PASSWORD=… npx tsx oracle/wire-capture/fixture.ts <raw.jsonl> capture.jsonl`.
