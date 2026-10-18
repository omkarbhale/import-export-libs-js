# lang-two-packages

Two packages cut with their own skip sets. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages one code (tickets 05 and 75).

## Exercises

Languages = en, de over a package that uses en and de and one that uses en and fr: the first loses nothing, the second loses its fr labels (a package's skip set is its own used languages minus the selection).

## Dev state

Dev had these `Language` items while the case ran: `en`, `de`, `fr`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGP1`, `LIBSJS-SCRATCH-LANGP2` | languages=["en","de"] | success (0) | 0 | 40 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 10

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | B7C7B0CC18854838A1F25C65107EC840 |
| 2 | PackageDefinition | 33E37BD817F14463818D35300C51E624 |
| 3 | List | 320FD6E3E906B07CABF7A907D57429A3 |
| 4 | PackageGroup | 013D38AB1461441CB898B0B00296BF56 |
| 5 | PackageElement | 28C4674936654621A4EA83687DF688CD |
| 6 | DatabaseUpgrade | 458B2B3EF46740B4A07D1569E5FAC612 |
| 7 | PackageDefinition | 4D81266A9B09446CAB74D8DA5051A89D |
| 8 | List | 9BF3CCDDA050B83D3932C6BAFACE715A |
| 9 | PackageGroup | 45C9CBA892964ABCB5F63C6AA16FA4B7 |
| 10 | PackageElement | 8E2C8FDAA0DB4662A941E1D461DE2713 |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 8E2C8FDAA0DB4662A941E1D461DE2713 |
| 2 | PackageGroup | 45C9CBA892964ABCB5F63C6AA16FA4B7 |
| 3 | List | 9BF3CCDDA050B83D3932C6BAFACE715A |
| 4 | PackageDefinition | 4D81266A9B09446CAB74D8DA5051A89D |
| 5 | DatabaseUpgrade | 458B2B3EF46740B4A07D1569E5FAC612 |
| 6 | PackageElement | 28C4674936654621A4EA83687DF688CD |
| 7 | PackageGroup | 013D38AB1461441CB898B0B00296BF56 |
| 8 | List | 320FD6E3E906B07CABF7A907D57429A3 |
| 9 | PackageDefinition | 33E37BD817F14463818D35300C51E624 |
| 10 | DatabaseUpgrade | B7C7B0CC18854838A1F25C65107EC840 |

## Spec rules

IMP-630. A spec or build ticket that pins this case adds more here (mapcheck F11).

## Files

Each `step-<n>/` folder:

| File | What |
|---|---|
| `run.json` | the oracle's run record: toolset identity, parameters, host info, and the cleanup report (created, deleted, kept) |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `input/` | the package folder the engine read: `imports.mf` and the item files |

The return code is `run.json` `host.result` (`ImportSolutions returned N`); `hostExit` is the host process's own exit code.

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-two-packages --force`.
