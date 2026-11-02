# Roadmap

Decision records for import-export-libs-js. They were settled in five rounds of questions with the captain on 2026-10-13. Each record summarises the round and keeps the captain's answers verbatim.

| Record | Settles |
|---|---|
| [round-1.md](round-1.md) | Basis, scope, product, platforms, fidelity, parity, order |
| [round-2.md](round-2.md) | Spec form, language-pack import, "exact", CLI, credentials, options, dev writes, conventions |
| [round-3.md](round-3.md) | Which engine versions, engine selection, version gate, vendored oracle DLLs |
| [round-4.md](round-4.md) | The 14.35 additions, 14.35's parallel export, build order |
| [round-5.md](round-5.md) | The confirmed shared understanding, with the captain's corrections |

[`browser-host.md`](browser-host.md) is the decision record for running the library in a browser (D1 to D14, the captain's answers of 2026-11-02, the one POC and the standing acceptance of its tickets). Its rules are `HOST-200` to `HOST-299` in [`spec/browser-host.md`](../spec/browser-host.md).

[`lock-diff-12.0.md`](lock-diff-12.0.md) accounts for the REA lock diff between the 12.0 and 14.0.7 builds (wayfinder ticket 46).

[`engine-diffs.md`](engine-diffs.md) reads the live three-engine export diffs on dev (wayfinder ticket 64): which differences the code reading predicted are confirmed, which dev cannot show, and where each is pinned.

[`live-parity-14.0.7.md`](live-parity-14.0.7.md) records the live run of the port against the DLL on dev for 14.0.7 (wayfinder ticket 44): 131 of 137 cases equal, one known difference (`fs-odd-files`, since closed), five language-pack cases skipped.

[`live-parity-12.0.md`](live-parity-12.0.md) records the same run for 12.0 (the reopening of ticket 44).

[`live-parity-14.35-export.md`](live-parity-14.35-export.md) records the live run of the port against the DLL on dev for 14.35's export side (wayfinder ticket 76, part A): 124 of 134 cases equal, no difference, ten language-resource cases skipped because dev has no Languages `de` and `fr`.

[`live-parity-14.35.md`](live-parity-14.35.md) records the rest of 14.35's live run (wayfinder ticket 76, part B): the import side, the DB patch, the rerun of the export side and the completion of the engine. 66 of 71 import cases equal, one port difference found and fixed, five cases skipped for the Languages dev lacks.

[`live-parity-12.0-on-leases.md`](live-parity-12.0-on-leases.md), [`live-parity-14.0.7-on-leases.md`](live-parity-14.0.7-on-leases.md) and [`live-parity-14.35-on-leases.md`](live-parity-14.35-on-leases.md) record the same runs on arashouse leases of each engine's own server (arashouse map ticket 46): 12.0 on 12.0 SP9, 14.0.7 on Release 23 (14.0.9) and 14.35 on Release 35, the first 14.x servers either engine met. No difference in any of them; every change from the dev records is the server's content, and the 14.35 DB patch met a slot licence without `Aras.ApplyUpdate`.

[`readiness.md`](readiness.md) is the state when the map ended (wayfinder ticket 65): the final three-engine parity run, what the readiness sweep fixed, and every gap still open with its reason.

[`hold/`](hold/) holds the pieces of `Libs.dll` that are deliberately out of scope, each with what would bring it in.

The work itself is tracked as wayfinder tickets outside this repo. Each ticket lands as one PR (see `AGENTS.md`).

## The captain's intent

> New project `import-export-libs-js`: read my library Libs.dll present in committed aras-harness project, use REA (https://github.com/morluto/rea See a feature you like. Understand how it works, down to the binary level. Should be already installed some) and migrate it whole to Node/TypeScript for readability.
