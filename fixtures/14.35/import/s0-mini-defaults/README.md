# s0-mini-defaults

Six small items, every option at the engine default. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release/description unset (tickets 05 and 75).

## Exercises

Package registration (PackageDefinition, one PackageGroup per type label, one PackageElement per item named by its file), the DatabaseUpgrade row (in progress, then success) with a null Release and Description, the per-type definition checks and their cache, and the plain add path with merge off.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | defaults | success (0) | 0 | 55 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 96C259670BEB42F395E5841E571087CA |
| 2 | PackageDefinition | 76697BE1E773460A912ABE042B55B59C |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 2AF8D6E2F27B466698E9EF3C00AE43CE |
| 5 | PackageElement | 753F1DCFEE8D4129A2DF40B6E7C3D24E |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 46406B331A694EF78159E5D97BC2A693 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 9EC7930E83D64D76BDA48280F9E77D4E |
| 10 | PackageElement | 30611130CC5B40D9B9193DC5ECEE4826 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 597550FB27E74E4A81D3807C7ABED161 |
| 13 | PackageElement | 3C390604C3A343E2AE51742C830D25DB |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 4E3DB7D8C83145A5B15F0301CBEA546B |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | D2AAF0CF19F446EC875BF7CE656E3172 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | D2AAF0CF19F446EC875BF7CE656E3172 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 4E3DB7D8C83145A5B15F0301CBEA546B |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 3C390604C3A343E2AE51742C830D25DB |
| 6 | PackageGroup | 597550FB27E74E4A81D3807C7ABED161 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 30611130CC5B40D9B9193DC5ECEE4826 |
| 9 | PackageGroup | 9EC7930E83D64D76BDA48280F9E77D4E |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 46406B331A694EF78159E5D97BC2A693 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 753F1DCFEE8D4129A2DF40B6E7C3D24E |
| 14 | PackageGroup | 2AF8D6E2F27B466698E9EF3C00AE43CE |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 76697BE1E773460A912ABE042B55B59C |
| 17 | DatabaseUpgrade | 96C259670BEB42F395E5841E571087CA |

## Spec rules

None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-defaults --force`.
