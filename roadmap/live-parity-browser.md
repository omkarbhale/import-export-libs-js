# Live parity of the browser path on three leases

Browser map ticket 33. `npm run parity -- --runtime browser` (HOST-279, `oracle/README.md`, "Live parity in a browser") ran each case three times against a fresh lease, on 2026-11-06: the oracle (the vendored `Libs.dll` through the Windows host), the Node port, and the browser build of the port in a Worker of a headless browser, over a tree in memory and the `fetch` transport. Each step of the browser's run was compared with the oracle's and with the Node port's by the same diff, and each call the engine reported had to be a request the page's transport really sent.

Per the round 5 correction, **equal cases do not prove the engines the same.** They show that these inputs reach no difference.

## Result

No unexplained difference on any engine in Chromium. Firefox and WebKit pass their two cases on every engine. One case differed once, on 14.35, in a log line that holds a duration; it is explained below, and it and the other batch cases are equal in all three browsers after the normaliser's fix.

| Engine | Lease | Cases | Equal | Explained | Different | Skipped | Requests (oracle / Node / browser) | Firefox | WebKit |
|---|---|---|---|---|---|---|---|---|---|
| 12.0 | `12sp9` | 135 | 135 | 0 | 0 | 0 | 22 495 / 22 495 / 22 495 | 2 of 2 | 2 of 2 |
| 14.0.7 | `23` | 137 | 132 | 0 | 0 | 5 | 27 722 / 27 722 / 27 722 | 2 of 2 | 2 of 2 |
| 14.35 | `35` | 215 | 191 | 1 | 0 | 23 | 19 567 / 19 525 / 19 525 | 2 of 2 | 2 of 2 |

The case totals include `mode-all-packages`, which was run with `--case` on the same lease. Firefox and WebKit ran `e24-grid` (an export) and `s0-mini-merge` (an import).

By family, in Chromium (cases equal of cases; requests on the oracle's side):

| Family | 12.0 | 14.0.7 | 14.35 |
|---|---|---|---|
| Export catalogue (read-only) | 75 of 75; 2 508 | 75 of 75; 2 980 | 104 of 104; 3 703 |
| Scratch-seeded export | 14 of 14; 254 | 14 of 14; 280 | 14 of 24, 10 skipped; 304 |
| Import on `LIBSJS-SCRATCH-*` copies | 40 of 40; 3 608 | 37 of 37; 3 599 | 65 of 71, 1 explained, 5 skipped; 4 692 |
| Language-pack import | none in 12.0 | 5 skipped | 8 skipped |
| DB patch with the committed no-op patch | none in 12.0 | none in 14.0.7 | 2 of 2; 36 |
| Console modes `--from-manifest` ×3, `--use-import` ×2 | 5 of 5; 131 | 5 of 5; 150 | 5 of 5; 165 |
| Console mode `--all-packages` (slow) | 1 of 1; 15 994 | 1 of 1; 20 713 | 1 of 1; 10 667 |

The request counts of 12.0 and 14.0.7 are those of the lease records of the Node runtime, [`live-parity-12.0-on-leases.md`](live-parity-12.0-on-leases.md) and [`live-parity-14.0.7-on-leases.md`](live-parity-14.0.7-on-leases.md), to the request. 14.35's export items race, so its requests compare as a set (EXP-558); on ten cases the oracle made more than the two ports, which made the same number, for example `x-cancel-after-5-run1` 33 against 22 and 22, and `x-par-18-lists-run1` 34 against 33 and 33, and all ten are equal under EXP-558. The Node record's total for 14.35 is 19 562 ([`live-parity-14.35-on-leases.md`](live-parity-14.35-on-leases.md)).

Every step ended the same way on all three sides, on all three engines.

## Differences

| Case | Engine, browser | What differed | Disposition |
|---|---|---|---|
| `batch-check-fails`, step 1 | 14.35, Chromium, first run | Log line 61: `Resolve dependencies time: 00:00:00` in the browser, against `00:00:00.0000165` (oracle) and `00:00:00.0000175` (Node) | **Explained, a browser host rule, HOST-243.** The normaliser is fixed; no library defect. |

The step measures a stopwatch over a piece of work of a few tens of microseconds (IMP-514). `performance.now()` moves in steps: in the log of this run, 100 µs in Chromium and 1 ms in Firefox and WebKit (Chromium `00:00:00.0392000`, Firefox `00:00:00.0410000`, WebKit `00:00:00.0640000`; the Node port's digits go to the 100 ns, `00:00:00.0313710`). So the two reads of the clock can fall in one step, the span is exactly zero, and `formatTimeSpan` writes `00:00:00`, because `TimeSpan.ToString()` leaves out a zero fraction. The text is right for the span the clock read. The normaliser's elapsed pattern required seven digits, so it left that one duration in the log for the diff to compare.

The fix is in the harness: `oracle/src/parity/normalize.ts` also treats a time without a fraction as elapsed after the two labels of the batch mode (and only there, so a time of day under another label still compares), with a regression test in `oracle/src/parity/normalize.test.ts` that failed first. Rerun on the same lease after the fix, the 14 cases of the batch mode that do not need other Languages were equal in Chromium, Firefox and WebKit. All three browsers read zero on the same four steps of that rerun (`batch-check-fails` step 1, `batch-relationships` step 1, `batch-size-unset` step 1, `batch-skip-existing` step 2). So the difference was waiting in every browser. In the first Chromium run the other three happened to cross a clock step.

Nothing traces to the server's CORS or cookie behaviour, so the POC record, [`browser-cors-poc.md`](browser-cors-poc.md), is not amended. The run went through the runner's proxy (the default), because no flavour answers the whole login chain as shipped (section 3 of that record); `--browser-cors server` was not run.

## Command lines

`<lease>` is the lease of the engine's flavor; `E` is the engine. `--out` was a folder outside the repo.

```sh
arashouse get <flavor> --holder libsjs-br-33
arashouse run --lease <lease> -- npm run parity -- --engine $E --runtime browser --browser chromium
arashouse run --lease <lease> -- npm run parity -- --engine $E --runtime browser --browser firefox --case e24-grid,s0-mini-merge
arashouse run --lease <lease> -- npm run parity -- --engine $E --runtime browser --browser webkit --case e24-grid,s0-mini-merge
arashouse run --lease <lease> -- npm run parity -- --engine $E --runtime browser --browser chromium --case mode-all-packages
arashouse return <lease>
```

The rerun of 14.35 after the fix, on the same lease, with `--browser chromium`, `firefox` and `webkit` in turn and `--keep-all`:

```sh
arashouse run --lease <lease> -- npm run parity -- --engine 14.35 --runtime browser --browser <browser> --keep-all --case \
  s9-batch-bad-relation,s9-batch-server-failure,s9-batch-fatal-reltype,batch-size-3,batch-size-unset,batch-merge-reimport,batch-skip-existing,batch-relationships,batch-server-failure,batch-check-fails,batch-fatal-reltype,batch-cancel,batch-delete-missing,batch-collect-fallback
```

The case lists are those of `npm run parity -- --list --engine <v>` (`--include-slow` adds `mode-all-packages`).

## Leases and browsers

| Engine | Flavor, server | Slot | Lease id | Database |
|---|---|---|---|---|
| 12.0 | `12sp9`, 12.0 SP9 build 24090 | `12sp9-03` | `eb4248d3376feb797967d53c023ca65e` | `arashouse_12sp9_03` |
| 14.0.7 | `23`, Release 23, `14.0.9.36073` | `23-02` | `e7bf43930c2690220b935ac2ac3aafce` | `arashouse_23_02` |
| 14.35 | `35`, Release 35, `14.35.0.43890` | `35-01` | `47525b27e5c931dbea8d850d4eed7850` | `arashouse_35_01` |

All three were returned after the logs were taken out. The password reached the run only through `arashouse run`, the page's outcomes were scrubbed as the Node port's are (HOST-279), and this record holds no credential.

Browsers, headless, from Playwright 1.64.1: Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2. The machine lacks WebKit's system libraries and the run had no root, so WebKit ran from a copy of Playwright's build in a scratch folder with the Ubuntu packages' libraries unpacked beside it (`oracle/README.md`, "Browser parity").

## Timings

The seconds of the engine's runs alone, one Chromium run on each lease, in the order oracle, Node, browser (`sideSeconds` in `report.json`; the oracle's runs, the cleanups and the diff are not in them). The browser's time includes the same-origin proxy and the crossing of the files and results to the driver, which a real page would not have, so it is an upper bound and not a benchmark. Node's 14.35 exports used its logical processors and the page's used `hardwareConcurrency`.

| Family | 12.0 Node | 12.0 browser | 14.0.7 Node | 14.0.7 browser | 14.35 Node | 14.35 browser |
|---|---|---|---|---|---|---|
| Export catalogue | 198.7 | 244.3 | 168.9 | 233.3 | 241.4 | 307.6 |
| Scratch-seeded export | 22.0 | 25.3 | 24.9 | 31.7 | 30.6 | 37.1 |
| Import | 239.2 | 281.9 | 181.8 | 242.4 | 249.8 | 337.8 |
| DB patch | | | | | 1.1 | 1.5 |
| Console modes | 10.8 | 13.6 | 14.2 | 18.6 | 15.6 | 17.6 |
| **All but `--all-packages`** | **470.6** | **565.2** (1.20×) | **389.8** | **525.9** (1.35×) | **538.4** | **701.6** (1.30×) |
| `--all-packages` | 413.6 | 780.5 (1.89×) | 526.6 | 798.1 (1.52×) | 142.9 | 154.4 (1.08×) |

Firefox and WebKit on their two cases (Node and browser): 12.0 3.8 and 4.4, 5.0 and 6.5; 14.0.7 4.2 and 6.8, 4.1 and 5.5; 14.35 5.4 and 7.5, 5.2 and 6.6.

Each command as a whole, the oracle and the cleanups included: 12.0 47 min 6 s and 27 min 25 s for `--all-packages`; 14.0.7 46 min 6 s and 30 min 23 s; 14.35 62 min 24 s and 7 min 8 s.

## Not run

- **The language cases.** 14.0.7's 5 language-pack cases; 14.35's 8 language-pack cases, 10 `lang-ml` export cases and 5 import cases with language selection. All 28 were skipped with the script's reason: the lease, like dev, has no Languages `de` and `fr`, and the script never adds one. This is as in the Node records, and whether leases may lift it is the same open question they name. So **the browser's language-pack path has no live run yet.** It is covered offline: the recorded language-pack runs replay in all three browsers (HOST-266), and the parity script's dry run takes `lp01` of 14.0.7 and 14.35 through the whole browser pipeline over HTTP (HOST-279).

- **A DB patch that is applied.** `dbpatch-apply` ran on all three sides and is equal. On a `35` lease the server refuses `ApplyUpdate` under the slot's licence, as `live-parity-14.35-on-leases.md` explains, so here the browser shows the refusal path, request for request with the other two. A patch that is applied is covered by the recorded DB-patch replays in the browsers (HOST-266). The script's note on step 1 ("the oracle ended as applied, not as the recorded case says (applied)") is the one that record explains.

## What the leases held

Before each run the script's check (no scratch PackageDefinition or DatabaseUpgrade) passed. The three sides' runs in the main command created 2 517 scratch items on 12.0, 2 484 on 14.0.7 and 3 348 on 14.35, and their cleanups deleted 2 502, 2 469 and 3 333, each only after reading back the owner's name; nothing was kept or left unverified. The 15 not deleted on each engine are the five ids per side that the Node records explain (`live-parity-12.0-on-leases.md`): ids that a case's own steps or the server remove before the cleanup reaches them. The counts agree with those records: each is three sides of imports, plus one seed and the console modes' items.

A read-only count after the runs, before each lease was returned, found no PackageDefinition, DatabaseUpgrade, ItemType, RelationshipType, Method, Form, Identity, Variable, SQL, List, Property or Field named `LIBSJS*`.
