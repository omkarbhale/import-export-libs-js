# Import orchestration and registration: probe evidence

Recorded on Windows PowerShell 5.1 (.NET Framework 4.8), NTFS, on 2026-10-19. It backs `spec/import-run.md` (`IMP-400` to `IMP-499`). Nothing here is Aras code or a credential, and no server was contacted.

| File | What |
|---|---|
| `probe-14.0.7.txt` | The real 14.0.7 engine (vendored `oracle/native/14.0.7/Libs.dll` and `IOM.dll`, staged to `%LOCALAPPDATA%`) run through `ImportExportManager.ImportSolutions`, `PackageDefinitionManager` and the `CItemHelper` methods the import uses. One `=== name` section per scenario. A scenario that runs `ImportSolutions` lists the result or the exception, every request IOM was handed (`REQUESTS`, numbered, CR and LF escaped as `\r` and `\n`), every message (`channel \| text`), the console text, and the log file (`LOG`). The date-time of the log is replaced by `<DATETIME>`, the run folder by `<ROOT>` and the identity of the machine's user by `<WINUSER>`. A scenario that calls a method directly lists each call with its result or exception and the requests it made. |
| `probe/` | The PowerShell and C# that recorded it. `probe.ps1` builds package folders, a manifest and a log under a work folder, and answers the engine's requests from a small model of the server (`Model-Respond`); `Probe.cs` is the stub connection and the recording message factory. `run.sh <repo> <out> [scenario glob]` stages the toolset and the scripts to `%LOCALAPPDATA%\libsjs-22-probe`, runs them and removes the staging folder. |

**The server is a model.** The stub answers `get` with "no items" unless a scenario says otherwise, answers `add` with an id derived from the name, and never evaluates the engine's AML. So the files show exactly what the engine sends and how it reacts to the answers the scenarios script; they do not show what Aras answers. The import fixtures of wayfinder ticket 25 record that.

Line terminators in `probe-14.0.7.txt` are CRLF as the probe wrote them. `.gitattributes` keeps them.
