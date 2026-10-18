# 14.0.7 export request probe

What engine 14.0.7's own `CExportItems` and `CItemHelper` send and how they react to scripted answers, recorded once for ticket 11 (`spec/export-requests.md`).

- **Run:** `oracle/request-probe/probe-14.0.7.ps1` loads the vendored 14.0.7 `IOM.dll` and `Libs.dll` and drives the real engine classes against `Stub.cs`'s `StubConnection`. The stub never touches a network: it records the document IOM hands to `CallAction` (the wire text, `spec/export-requests.md` "Notation") and answers from a script. There is no server, user or password, so nothing here depends on dev and nothing needed scrubbing.
- **`requests.json`:** `scenarios`, each a named probe (`A.typeTable`, `B.levels`, `C.serverVersion`, `D.versionable`, `E.*` to `R.*`). A scenario holds the `requests` in order, the `actions` (SOAP action names), what the engine returned or `thrown` (`type`, `faultcode`, `faultdetail`, `message`, clipped to 300 characters, never a stack trace), and for runs of `Export` `stoppedByStub`. The stub refuses any request a scenario does not script, and IOM then hands the engine an empty answer; the run ends with "Root element is missing", which is the probe stopping and is not recorded as `thrown`.
- **Not evidence of:** what the server answers. Answers are scripted, so server behaviour (which rows a `get` returns) comes from the dev fixtures of ticket 24.

To re-record, stage a copy of `oracle/native/14.0.7/IOM.dll` and `Libs.dll` and of `oracle/request-probe/` under `%LOCALAPPDATA%` (.NET refuses assemblies from `\\wsl.localhost`), then on Windows PowerShell 5.1:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File probe-14.0.7.ps1 -ToolsetDir <folder with IOM.dll and Libs.dll> -Out out.json
```

and re-indent `out.json` as JSON with two spaces (`node -e "…JSON.stringify(j, null, 2)"`) to get `requests.json`.
