# xml-core-probe

Records what .NET Framework's `System.Xml`, `WebUtility`, `File.ReadAllText` and `Path` do with the inputs of the XML core, as `fixtures/xml-core/vectors.json`. `src/xml/vectors.test.ts` replays that file against the port. These are framework behaviours, so the probe loads no `Libs.dll`, talks to no server and needs no credential. It writes only under a work folder it makes.

- `cases.mjs`: the inputs, grouped by id. `1.*` item-file writer, `2.*` manifest writer, `3.*` reading bytes, `5.*` `WebUtility`, `6.*` file names, `wf.*` well-formedness (positions and messages), `xd.*` `XDocument.ToString`, `xp.*` XPath, `op.*` document edits (`InnerText`, `InnerXml`, `RemoveAll`, `IsEmpty`). The ids of group 1 to 6 are those of ticket 06's appendix B and the rest come from ticket 08.
- `Probe.cs`: one function per kind of case. It is compiled by `Add-Type`, so it is C# 5.
- `run.ps1`: runs a cases file through `Probe.cs` in Windows PowerShell 5.1.
- `record.mjs`: stages the two files under `%LOCALAPPDATA%\libsjs-27-probe`, runs them on the cases, merges the results into `fixtures/xml-core/vectors.json` and deletes the staging folder. Each vector keeps its input next to the recorded `expect`.
- `entities.mjs`: writes `src/xml/html-entities.ts` from the entity table the probe read out of `WebUtility`.

Re-record from WSL, at the repository root:

```sh
node oracle/xml-core-probe/record.mjs          # every case
node oracle/xml-core-probe/record.mjs wf.f     # only the cases whose id starts with wf.f
```

A string that holds a lone surrogate cannot be a case input: the JSON reader of the probe replaces it with U+FFFD. Lone surrogates reach the writers through character references (`&#xD800;`) instead, as they do in the engine.

The results are of .NET Framework 4.8.1 (`System.Xml` 4.8.9340.0) on Windows 10.0.26200 with the culture `en-IN`, the machine the other probes of this repository ran on. The `info` object at the top of the file says so.
