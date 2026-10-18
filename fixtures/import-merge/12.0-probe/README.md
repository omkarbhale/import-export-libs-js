# 12.0 import merge probe

What engine 12.0's own `CImportItems` and `CItemHelper` do on the merge and versionable paths, recorded for ticket 47 (the `[12.0]` variants of `spec/import-merge.md`). It is the 14.0.7 probe (`../14.0.7-probe/`) run through the other engine: same scenarios, same stub helper, same stub connection.

- **Run:** `ENGINE=12.0 oracle/merge-probe/run.sh` loads the vendored 12.0 `IOM.dll` and `Libs.dll` (`oracle/native/12.0/`) and writes `results.json` here. The format is described in `../14.0.7-probe/README.md`. Nothing touches a network, and there is no server, user or password, so nothing needed scrubbing.
- **What differs from the 14.0.7 recording** (the whole of it, by a scenario-by-scenario comparison):
  - `C.ccrProperty`: 12.0 has no `RemoveSystemPropertyForPolyType`, so a Change Controlled Relationship system property is switched to `edit` and sent, instead of being removed (`ccr.sort_order`, `ccr.source_id`, `ccr.anyTypeWithTheShape`, `ccr.rootProperty`, `ccr.sameIdTwoNodes`);
  - `X.lookups`: the `faultstring` and message of a fault from `applyAML` are the response document alone (`rel.error999`, `unlock.fault`, `unlock.fault0`), where 14.0.7 prefixes `Server error`, the request and `Responce`.
- **Not evidence of:** what the server answers, as for the 14.0.7 recording.
