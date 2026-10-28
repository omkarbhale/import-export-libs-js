# Live parity for 14.0.7 on an arashouse lease: the first 14.0 server

Arashouse map ticket 46 ("prove the guard"). `arashouse run --lease <id> -- npm run parity -- --engine 14.0.7 --include-slow` ran the oracle (the vendored `Libs.dll` 14.0.7.35492 through the Windows host) and the port on the same inputs against a fresh lease of flavor `23`, case by case, on 2026-10-28. The lease was slot `23-01`: Aras Innovator Release 23, server `14.0.9.36073`, `http://172.19.0.1/ah-23-01` from WSL (`http://localhost/ah-23-01` from the oracle's Windows side), database `arashouse_23_01`, user `root`, with the password `arashouse get` made for the lease. The guard of ticket 45 (`oracle/src/live-targets.ts`) accepted it through `arashouse status --json`; nothing else changed. The command, the catalogue and the comparison are those of the dev record, [`live-parity-14.0.7.md`](live-parity-14.0.7.md), and `oracle/README.md`, "Live parity". The 12.0 run on a `12sp9` lease is [`live-parity-12.0-on-leases.md`](live-parity-12.0-on-leases.md).

The dev instance is Aras 12.0 SP9, so every earlier live run of this engine, the 14.35 ones included, met a 12.0 server. This is the first run of the 14.0.7 engine and of the port against a 14.0 server: its OAuth login, its version probe, its metadata.

Per the round 5 correction, **equal cases do not prove the engines the same.** They show that these inputs reach no difference.

## Result

| Family | Cases | Equal | Different | Skipped | Requests compared (oracle side) | On dev (`live-parity-14.0.7.md`) |
|---|---|---|---|---|---|---|
| Export catalogue (read-only) | 75 | 75 | 0 | 0 | 2 980 | 75 equal, 3 001 |
| Scratch-seeded export | 14 | 14 | 0 | 0 | 280 | 14 equal, 280 |
| Import on `LIBSJS-SCRATCH-*` copies, 37 cases, 50 steps | 37 | 37 | 0 | 0 | 3 599 | 36 equal, 1 known (`fs-odd-files`, since closed), 3 599 |
| Language-pack import | 5 | 0 | 0 | 5 | 0 | 5 skipped |
| Console export modes: `--from-manifest` ×3, `--use-import` ×2 | 5 | 5 | 0 | 0 | 150 | 5 equal, 149 |
| Console export mode `--all-packages` (slow) | 1 | 1 | 0 | 0 | 20 713 | 1 equal, 22 534 |
| **Total** | **137** | **132** | **0** | **5** | **27 722** | **131 equal, 1 known, 5 skipped, 29 563** |

`npm run parity` exited 0 after 35 min 58 s (`--all-packages` alone 10 min 22 s). `src/client/live.test.ts` passed both its tests on a second fresh `23` lease (engines 14.0.7 and 14.35 log in, read major version 14, which the guard expects for a `23` lease, and pass the gate).

## What the 14.0 server showed

- **The version.** The oracle's host read the server as `Major=14 Minor=0 ServicePack=0 Build=36073 ServiceUpdate=9` (WIRE-021), and the port read the same: the probe's requests, and the version text in every engine log (`{major}.{minor}.{serviceUpdate}.{build}`, WIRE-022: `14.0.9.36073`), are equal. A real 14.0 server leaves the service pack at 0 and reports its fixes in the service update. That settles a question `spec/language-pack.md` left open under LP-040 (the 14.35 null-value test compares the service pack with 22, which a 14.0 server never sets), and the rule now says so.
- **The login.** A 14.0 server's OAuth discovery and token endpoints answer with the request's own host (arashouse `docs/e2e-23.md`), so the oracle's Windows side, at `localhost`, and the port, at `172.19.0.1`, both logged in with no change to either. The OAuth requests themselves are not in a transcript (WIRE-010 to WIRE-012; a transcript holds the SOAP calls); from `ValidateUser` and the probe on, every case's requests are compared in order and are equal.
- **No new difference.** No case differed in the requests, the output folder, the log, the messages or the return code. No fixture, fix or `spec/bugs.md` entry comes from this run.

## Every difference from the dev record, explained

The port and the DLL agreed on every case, as on dev. What differs from the dev record is the server, not the engines:

- **A Release 23 database is not dev's.** A read-only check of a fresh `23` lease (each export case's items, by type and id, from `fixtures/14.0.7/export/*/run.json`) found all catalogue items present except those of these cases:
  - three in packages only dev has, as on the `12sp9` lease: `e38-variable-empty-value` and `e52-float-item-property` (`com.steepgraph.powerplay`) and `p4-folder-mapping` (`com.steepgraph.pagex`). They exported on dev; on the lease the run ends with a `CItemException` on both sides, as `p3-absent-package` (a package that exists nowhere) does on dev and on the lease;
  - six whose items belong to `com.aras.innovator.es` (Enterprise Search), which the 12.0 SP9 databases hold and Release 23's does not: `e33-user` (User `ES Admin`), `e36-variable-both-empty` (Variable `ES_SolrUrl`), `e43-xclassificationtree`, `e44-xpropertydefinition`, and `p1-order-six-forward` and `-reverse` (`ES_SolrUrl` among their six items). These still end `exported` on both sides, with fewer requests (14 for each of the four single-item cases);
  - the `LIBSJS-SCRATCH-*` items of the scratch-seeded cases, which the run seeds itself, and `e40`'s `Nope Promotion`, absent on dev too (the case is about that error).
- **Requests per export case.** Against the requests recorded on dev (`fixtures/14.0.7/export/<case>/transcript.jsonl`), 33 cases sent the same number, 23 more and 19 fewer: 2 980 against 3 001 in all. Besides the cases above, the counts follow the server's metadata, which differs between 12.0 SP9 and Release 23 (for example `e34-preference` 35 to 106, `e10-activity-assignment` 76 to 67), and the packages the removal modes and dependency reads walk, of which dev has its own (`live-parity-12.0-on-leases.md`). Each case is compared between the two sides on the same server, and all are equal.
- **`--all-packages`** exported every package of the lease, 20 713 requests a side against dev's 22 534; its output tree is byte for byte equal between the two sides. The other console modes sent 150 requests against dev's 149; they export a few stock items whose surroundings are the server's.
- **The import and scratch-export families** sent exactly as many requests as on dev (3 599 and 280): they work on the run's own scratch packages.
- **`fs-odd-files`** is equal, as it has been on dev since PR #87; the dev record's one known difference stays closed.

## Not run

- **Language-pack import (5 cases)**, skipped with the script's reason: the lease, like dev, has no Languages `de` and `fr`, and the script never adds one. On a lease adding them would harm nothing, since the database is discarded at return, but the script's rule and `AGENTS.md` still treat a Language as a change to refuse; whether leases may lift that is for the amendment of `AGENTS.md` "Live Aras" (arashouse map ticket 47) or a ticket after it. The port's side of these cases is replayed offline against the recorded runs, as before.

## What the lease held

Before the run the script's check (no scratch PackageDefinition or DatabaseUpgrade) passed on the fresh lease. The import family's two sides created 1 802 scratch items and their cleanups deleted 1 792, each only after reading back the owner's name; nothing was kept or left unverified. The ten are the same ten as on dev and on the `12sp9` lease: ids that the cases' own steps or the server remove before the cleanup reaches them (`s4-del` deletes a Form and its PackageElements in its second step; `s1-method-generation` and `s1-instances-versionable` leave earlier generations that go with their item). The lease was returned at once. The next fresh `23` lease, which was the same slot reset twice since (once after this run, once after another worker's lease), had no PackageDefinition, DatabaseUpgrade, ItemType, RelationshipType, Method, Form, Identity, Variable, SQL, List, Property or Field named `LIBSJS*`.
