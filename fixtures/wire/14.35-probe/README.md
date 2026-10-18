# 14.35 wire probe

What engine 14.35's `CItemHelper`, `CItemException` and IOM 15 do in cases a proxy capture cannot reach (a server that answers oddly, a login that fails or is cancelled), recorded once for ticket 69 (`spec/wire.md`).

- **Run:** `oracle/wire-probe/probe.ps1` loads the vendored 14.35 `IOM.dll` (15.0.0.0) and `Libs.dll` and drives the real classes against `Stub.cs`'s `StubConnection`, a subclass of IOM's `HttpServerConnection` that never touches a network: it records the document IOM hands to `CallAction` and answers from a script, and its `Login()` returns a scripted item or fault. There is no server, user or password, so nothing depends on dev and nothing needed scrubbing.
- **`probe.json`:** `scenarios`, each a named probe.
  - `A.probe`: the four version-probe requests (`requests`, as handed to `CallAction`) and how `CItemHelper.Login()` reads scripted answers: the version it read, or what it threw.
  - `B.gate`: servers 9.4 to 16.2 against the gate; `isConnected` is false after a refusal.
  - `C.loginFaults`: scripted login faults; a faultstring containing `System.Threading.Tasks.TaskCanceledException` returns from `Login()` with no error and no connection.
  - `D.applyAML`: `CItemException` texts for faults, with the request and response indented.
  - `E.logout`: `logout()` on a stub connection and on an `HttpConnectorExtension` whose server refuses connections.
  - `F.iomHelpers`: IOM 15's password digests and hash tests, and which requests get the `Aras-Request-ReadOnly` header.
- `../14.0.7-probe/` is the same probe run against 14.0.7 (`-Engine 14.0.7`).
- **Not evidence of:** what the server answers. Answers are scripted; the server's behaviour comes from the captures next to this folder.

To re-record, stage a copy of `oracle/native/14.35/` and `oracle/wire-probe/` under `%LOCALAPPDATA%` (.NET refuses assemblies from `\\wsl.localhost`), then on Windows PowerShell 5.1:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File probe.ps1 -ToolsetDir <staged 14.35 folder> -Out out.json -Engine 14.35
```

and re-indent `out.json` as JSON with two spaces (`node -e "…JSON.stringify(j, null, 2)"`) to get `probe.json`.
