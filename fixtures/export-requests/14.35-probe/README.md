# 14.35 export request probe

What engine 14.35's own `CExportItems` and `CItemHelper` send and how they react to scripted answers, plus what the dev server answers to the new request shapes. Recorded once for ticket 51 (`spec/export-requests.md`, the `[14.35]` variants).

## `requests.json`: the engine, against a stub

- **Run:** `oracle/request-probe/probe-14.35.ps1` loads the vendored 14.35 `IOM.dll` (IOM 15) and `Libs.dll` and drives the real engine classes against `Stub.cs`'s `StubConnection`, the same stub the 14.0.7 probe uses. The stub never touches a network: it records the document IOM hands to `CallAction` (the wire text) and answers from a script. There is no server, user or password, so nothing depends on dev and nothing needed scrubbing.
- **Scenarios:** each is a named probe. A scenario holds the `requests` in order, the `actions` (SOAP action names), what the engine returned or `thrown` (`type`, `faultcode`, `faultdetail`, `message`, clipped to 300 characters, never a stack trace), and for runs of `Export` `stoppedByStub`. The stub refuses any request a scenario does not script, and IOM then hands the engine an empty answer; the run ends with "Root element is missing", which is the probe stopping and is not recorded as `thrown`.
  - `A.*`, `B.*`, `C.*`, `D.*`: the main fetch and the template per type, level text and server version, with and without a versionable type. The schema the stub answers the tree lookups from is fictional (`TA`, `TB`, `R1` to `R6`); `A.typeTableTree` and `B.levels` show the lookups and the tree it produces.
  - `E.templateCache`, `F.templateFaults`, `F.nullArguments`: the `requestDictionary`, a template that failed, and the `ArgumentNullException`s.
  - `G.treeLookupAnswers`: faults and odd answers to the tree lookups.
  - `H.*`: the `_requestedItems` cache and which failures it remembers.
  - `I.fileNameAndFolder`: the file name and folder joined before any request.
  - `N.*`: the lookups `Export` chains after the main fetch.
  - `E.isVersionableValues`, `F.getCurrentIdOfVersion`, `H.getDepencyLevel*`, `I.getCurrentIdByUniqueKey`, `P.packageDefinitionManager`, `Q.configIdAndUniqueKey`: the same scenarios as the 14.0.7 probe (`../14.0.7-probe/requests.json`). Their requests and results are equal to 14.0.7's except the wording of an embedded server error (`Request (formatted)` and `Response (formatted)`, with the XML pretty-printed) and, in `N.*`, the main fetch.
- **Not evidence of:** what the server answers. Answers are scripted.

To re-record, stage a copy of `oracle/native/14.35/` (the `.dll` files and `runtimes/`) and of `oracle/request-probe/` under `%LOCALAPPDATA%` (.NET refuses assemblies from `\\wsl.localhost`), then on Windows PowerShell 5.1:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File probe-14.35.ps1 -ToolsetDir <folder with IOM.dll and Libs.dll> -Out out.json
```

and re-indent `out.json` as JSON with two spaces (`node -e "…JSON.stringify(j, null, 2)"`) to get `requests.json`.

## `server-reactions.json`: the server, read-only

Read-only gets sent to the dev instance (profile `dev`, database `12sp9`) on 2026-10-19, through the dev MCP client, which prints each answer as JSON and drops null properties. Nothing was written. Each `case` sends the request 14.0.7 would send and the request 14.35 sends for the same item, and compares the answers: `identicalResults` is true when the two answers are byte-equal, and `resultSha256` and `shape` (the count of items by their place in the tree; `~` is a related item) identify them.

- The explicit relationship tree answers like `levels=N` for List (1), Permission (1, with related items), Grid (2), the Part life cycle map (3), the Activity form (3) and the Part ItemType body. A tree without the nested `related_id` request gets the same related items as one with it.
- `lookups` and `selectProbes` record the tree lookups and the leading-comma `select`: the server ignores the comma.
- It does not show: the dev data has no row at the deepest level of Grid or the life cycle map, so those two cases show the request is accepted and the first levels agree, not that the deepest level matches. The raw SOAP text is not visible through this client, so whether the server's answer carries the `name` attribute the tree lookup reads on `data_source` is not shown here (the proxy capture of ticket 11 shows it on `source_id`).
