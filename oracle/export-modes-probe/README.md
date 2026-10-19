# export-modes-probe

Runs, offline, the two pieces of the engine builds that choose what an export covers, for `spec/export-modes.md` (wayfinder ticket 66). It needs no server, user or password.

- The engine's own `ImportExportManager.GenerateHashtableFromManifest`, on the vendored `Libs.dll`, against `ScriptedConnection` (`../export-output-probe/Stub.cs`), which answers the package-definition request from a document the scenario gives. Scenarios `gm-*`.
- `ConsoleUpgrade.exe`'s own `ProcessExport` (an internal method), on the toolset's `ConsoleUpgrade.exe`, driven by reflection. It is handed `ModesProbe.CapturingManager` (`Probe.cs`), an `IImportExportManager` that forwards everything to the engine's manager except `ExportSolutions`, which records the table it is given and returns, so the console tool's loops run unchanged. Scenarios `ca-*` (the all-packages loop), `cf-*` (`GenerateHashtableFromManifest` through the console tool) and `ui-*` (the `useimport` loop, on every `input` folder under `fixtures/<engine>/import/`, and on a few folders of its own).

Every table is recorded in the order a .NET `Hashtable` enumerates it. A table of 400 items or fewer lists every item as `key|id|type|keyedName`; a larger one keeps each package's count and the sha256 of those lines. The scenarios' inputs are in the result: the answers to the package-definition request under `solutionSets` (the recorded dev answer of ticket 24 is `blob`, `fixtures/14.0.7/export/_blobs/316a9c3d…`), and each manifest or package folder under `input`.

## Re-running

```sh
ENGINE=14.0.7 oracle/export-modes-probe/run.sh      # or 12.0, or 14.35; writes fixtures/export-modes/<engine>-probe.json
```

`run.sh` stages the vendored toolset, the toolset's `ConsoleUpgrade.exe` and the inputs under `%LOCALAPPDATA%` (.NET Framework refuses assemblies from `\\wsl.localhost`), runs `probe.ps1` with Windows PowerShell 5.1 and deletes the stage. `ConsoleUpgrade.exe` is not vendored: it is read from the captain's toolset folder (`Desktop\ImportExport\12\ConsoleUpgrade`, `…\23\ConsoleUpgrade`, `Desktop\Delete me\PackageImportExportUtilities35\ConsoleUpgrade`) and must have the sha256 pinned in `run.sh`. Its `Libs.dll` is not used: the vendored one is, and has the same MVID.
