# batch-relationships

Items with Relationships among items without. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, 14.35, AML batch (tickets 05 and 75).

## Exercises

An item with a Relationships child is imported alone after a forced flush of the queue (IMP-519).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | amlBatch={"maxSize":4} | success (0) | 0 | 53 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 5497C3DEE5ED4AD7994E95CE7A2D3793 |
| 2 | PackageDefinition | B8A19626FC3B4206BFC98AC0DC5AAAF9 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | D0136CF15F194CBAB72D6D8C48389979 |
| 5 | PackageElement | 725B3C4B6A494C94B5E0E048DE079874 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | A02554EC100041258A9D2F3199211F6F |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 10 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 11 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 12 | PackageGroup | A9CDA67A9FA3445487B9BCF005959FA6 |
| 13 | PackageElement | 501E9B6EBCD248F0B790CE446D0D75E3 |
| 14 | PackageGroup | DA998B196C2F4B888BEE2B2F2C3AF3EE |
| 15 | PackageElement | 4B558A54625843BAB40FBA99C65C2A95 |
| 16 | PackageElement | D7ABC236DDFB4B1AB7DFACCA7DDA064D |
| 17 | PackageElement | B55CF7B39B2E406C96D19151A02D1848 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | B55CF7B39B2E406C96D19151A02D1848 |
| 2 | PackageElement | D7ABC236DDFB4B1AB7DFACCA7DDA064D |
| 3 | PackageElement | 4B558A54625843BAB40FBA99C65C2A95 |
| 4 | PackageGroup | DA998B196C2F4B888BEE2B2F2C3AF3EE |
| 5 | PackageElement | 501E9B6EBCD248F0B790CE446D0D75E3 |
| 6 | PackageGroup | A9CDA67A9FA3445487B9BCF005959FA6 |
| 7 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 8 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 9 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | A02554EC100041258A9D2F3199211F6F |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 725B3C4B6A494C94B5E0E048DE079874 |
| 14 | PackageGroup | D0136CF15F194CBAB72D6D8C48389979 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | B8A19626FC3B4206BFC98AC0DC5AAAF9 |
| 17 | DatabaseUpgrade | 5497C3DEE5ED4AD7994E95CE7A2D3793 |

## Spec rules

IMP-519. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-relationships --force`.
