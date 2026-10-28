# Live parity for 12.0 on an arashouse lease

Arashouse map ticket 46 ("prove the guard"). `arashouse run --lease <id> -- npm run parity -- --engine 12.0 --include-slow` ran the oracle (the vendored `Libs.dll` 12.0.0.13341 through the Windows host) and the port on the same inputs against a fresh lease of flavor `12sp9`, case by case, on 2026-10-28. The lease was slot `12sp9-01`: Aras 12.0 SP9 build 24090, `http://172.19.0.1/ah-12sp9-01` from WSL (`http://localhost/ah-12sp9-01` from the oracle's Windows side), database `arashouse_12sp9_01`, user `root`, with the password `arashouse get` made for the lease. The guard of ticket 45 (`oracle/src/live-targets.ts`) accepted the lease through `arashouse status --json`, and nothing else changed: the command, the catalogue and the comparison are those of the dev record, [`live-parity-12.0.md`](live-parity-12.0.md), and `oracle/README.md`, "Live parity". The 14.0.7 run on a `23` lease is [`live-parity-14.0.7-on-leases.md`](live-parity-14.0.7-on-leases.md).

Per the round 5 correction, **equal cases do not prove the engines the same.** They show that these inputs reach no difference.

## Result

| Family | Cases | Equal | Different | Skipped | Requests compared (oracle side) | On dev (`live-parity-12.0.md`) |
|---|---|---|---|---|---|---|
| Export catalogue (read-only) | 75 | 75 | 0 | 0 | 2 508 | 75 equal, 2 542 |
| Scratch-seeded export | 14 | 14 | 0 | 0 | 254 | 14 equal, 254 |
| Import on `LIBSJS-SCRATCH-*` copies, 40 cases | 40 | 40 | 0 | 0 | 3 608 | 40 equal, 3 608 |
| Console export modes: `--from-manifest` ×3, `--use-import` ×2 | 5 | 5 | 0 | 0 | 131 | 5 equal, 131 |
| Console export mode `--all-packages` (slow) | 1 | 1 | 0 | 0 | 15 994 | 1 equal, 16 468 |
| **Total** | **135** | **135** | **0** | **0** | **22 495** | **135 equal, 23 003** |

`npm run parity` exited 0 after 36 min 37 s (`--all-packages` alone 14 min 50 s). On the same lease, before it was returned, `arashouse run --lease <id> -- npx vitest run src/client/live.test.ts` passed both of its tests (engines 14.0.7 and 14.35 log in, read major version 12, which is what the guard expects for a `12sp9` lease, and pass the gate).

## Every difference from the dev record, explained

The port and the DLL agreed on every case, as on dev. What differs from the dev record is the server's content, not the engines:

- **The lease is an out-of-the-box 12.0 SP9 database; dev also holds the captain's own packages.** A read-only check of the lease before the run (each export case's items, by type and id, from `fixtures/12.0/export/*/run.json`) found every catalogue item present except those of three cases, all in packages that only dev has: `e38-variable-empty-value` (Variable `sg_powerplay_repo_url`, `com.steepgraph.powerplay`), `e52-float-item-property` (CommandBarButton `sg_powerplay_relationshipgrid`, `com.steepgraph.powerplay`) and `p4-folder-mapping` (CommandBarButton `com.steepgraph.pagex.builder.button`, `com.steepgraph.pagex`). On dev these three exported; on the lease the engine's lookup of the missing item fails and the run ends with a `CItemException`, on the oracle's side and the port's alike, so the cases are equal. The other items the check did not find are the ones the run makes itself (the `LIBSJS-SCRATCH-*` items of the scratch-seeded cases, which are seeded just before they are exported) and `e40`'s `Nope Promotion`, which is absent on dev as well (the case is about that error). `p3-absent-package` fails on dev and on the lease, as it is meant to.
- **Fewer requests in eight export cases.** Against the requests recorded on dev (`fixtures/12.0/export/<case>/transcript.jsonl`), eight cases sent fewer: the three above (12 to 7, 14 to 7, 62 to 56), and `e06-scopecachedependency-removesilently` and `-removewithwarning` (91 to 87), `e02-part-removewithwarning` (140 to 136), `p2-cui-default-missing-dependencies` and `p2-cui-default-referenced-items` (17 to 15). The last five read every package (the unknown-package removal modes ask for each package's elements; the `cui_default` dependency read asks for each package that depends on it), and dev's recorded requests name packages the lease does not have: `com.steepgraph.pagex`, `com.steepgraph.pivot`, `com.steepgraph.powerplay`, `com.steepgraph.solution.contextualHelp`, `com.steepgraph.addon.imageviewer`, `DatabaseIdentifier` and `steepgraph.IPMS.userConfig`. The other 67 cases sent the same number of requests as on dev.
- **`--all-packages`** exported every package of the lease, 15 994 requests a side against dev's 16 468, for the same reason; its output tree is byte for byte equal between the two sides.
- **The import, scratch-export and console `--from-manifest`/`--use-import` families** sent exactly as many requests as on dev (3 608, 254 and 131): they work on the run's own scratch packages, which do not depend on what else the server holds.

## What the lease held

Before the run, a read-only count on the fresh lease found no PackageDefinition, DatabaseUpgrade, ItemType, RelationshipType, Method, Form, Identity, Variable, SQL, List, Property or Field named `LIBSJS*`, and the script's own check (no scratch PackageDefinition or DatabaseUpgrade) passed. The import family's two sides created 1 824 scratch items and their cleanups deleted 1 814, each only after reading back the owner's name; nothing was kept or left unverified. The ten are the same ten as on dev (`readiness.md`, "Dev after the runs"), and they are not left behind: they are ids the cleanup does not delete itself because the case's own steps or the server remove them first. In `s4-del` the second step deletes a Form the first made (the Form and its two PackageElements, one each side); in `s1-method-generation` and `s1-instances-versionable` they are the earlier generations of a Method and of a versionable item, which go with the item when the cleanup deletes its current generation, and the PackageElements a later step replaces. The same count after the run, before the lease was returned, again found no `LIBSJS*` item of any of those types.

The lease was then returned; arashouse resets the slot before it hands it out again.

## Not run

Nothing of the 12.0 catalogue was skipped: 12.0 has no language-pack cases.
