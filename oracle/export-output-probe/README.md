# export-output-probe

Runs the engine's own export code offline, for the 14.35 rules of `spec/export-transform.md`, `spec/export-prexsl.md`, `spec/export-write.md`, `spec/export-run.md` and `WIRE-051`. It needs no server, no credential and no password: every request is answered by `Stub.cs`, and it writes only under its work folder. The scripts also run against the vendored 14.0.7 toolset, to show what changed.

- `probe.ps1`: calls single methods by reflection on in-memory documents. Sections: `RNN` (`RemoveNamespaceNodes`), `AX` and `AXF` (`ApplyXsl`, the real `export.xsl`, then the namespace step), `RSER` (`RemoveSeparatelyExportedRelationships`, 14.35 only), `GPE` (`GetPackageElementIdsByElementTypeMap`, 14.35 only), `PC` and `IPR` (`Path.Combine` and `Path.IsPathRooted` on this runtime), `COD` (`CreateOutputDir`).
- `run-export.ps1`: drives the real `ImportExportManager.ExportSolutions` against `ScriptedConnection`, which answers the requests of an export from a small script. Scenarios `S1` to `S23` (`S22` runs first, see its comment) cover the parallel loop, a failed item, two failed items, a plain exception, a cancel, the referenced pass, a null package list, paths and file names. Each prints the exception, the messages in the order sent (with the thread), the log, the files, `imports.mf`, and the order in which the fetches finished. `-Only` takes scenario name patterns.
- `Stub.cs`: `ScriptedConnection` (a subclass of IOM's `HttpServerConnection` that never opens a socket; thread-safe, because 14.35 calls it from `Parallel.ForEach` workers) and `ProbeMessages` (the five message channels).

## Re-running

.NET Framework refuses DLLs from `\\wsl.localhost`, so use a staged copy (Windows PowerShell 5.1). `npm run oracle -- verify` stages and checks `%LOCALAPPDATA%\import-export-libs-js\oracle\<engine>-<digest>\`; those folders can be passed as `-Bin`. Copy the four files of this folder to a Windows folder, create a work folder, then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File run-export.ps1 -Bin <staged 14.35 folder> -Work <work folder>
powershell -NoProfile -ExecutionPolicy Bypass -File probe.ps1 -Bin <staged folder> -Work <work folder>
```

Delete the copies afterwards. Recorded output is in `fixtures/export-output/`.

## Reading the output

14.35 exports in parallel, so a run differs from the next in thread numbers, in the order of messages and log lines, and in the cases that are races (`S2`, `S10`, `S12`, `S20`, `S21`): see `EXP-558`. A rule that quotes a scenario says what held in every run it was repeated in. The recorded 14.35 run is one run; the 14.0.7 run in `run-export-14.0.7.txt` covers only the scenarios that do not depend on parallelism.

The scripted connection answers the requests of an export in a minimal way (a `List` item with a name; no relationships unless a scenario adds them). It does not model the server. Where a rule rests on the real server's responses, it says so.
