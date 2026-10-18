# s0-mini-defaults

Six small items, every option at the engine default. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release/description unset (ticket 05).

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
| 1 | DatabaseUpgrade | 8DC6BA588FEC46F0A4A9EFC0938AC25F |
| 2 | PackageDefinition | B909E3B5B82E45F09AF1F2D9D120A581 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 3A8B2C02D5EA47B381FB697933C5EC5D |
| 5 | PackageElement | DFF50BBDF01F4690B5525D3594A7148F |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | AB483AB7AD914A67BE9DE8F1561C7F2F |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 37672493E8B3477C96A4DE069C53C3D1 |
| 10 | PackageElement | 2F017CB5A58D4C05BE7A56FEE6CCC5A9 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | A54C7F5E049845D1B45E25FCB9E57021 |
| 13 | PackageElement | D973A94A9BFF4B2EB1151CFDBA6AA086 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 343F2622A8F3404DA9DC7CBDAF60F74F |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 7195F9641C7D4D1684AB481A6D7865D6 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 7195F9641C7D4D1684AB481A6D7865D6 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 343F2622A8F3404DA9DC7CBDAF60F74F |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | D973A94A9BFF4B2EB1151CFDBA6AA086 |
| 6 | PackageGroup | A54C7F5E049845D1B45E25FCB9E57021 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 2F017CB5A58D4C05BE7A56FEE6CCC5A9 |
| 9 | PackageGroup | 37672493E8B3477C96A4DE069C53C3D1 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | AB483AB7AD914A67BE9DE8F1561C7F2F |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | DFF50BBDF01F4690B5525D3594A7148F |
| 14 | PackageGroup | 3A8B2C02D5EA47B381FB697933C5EC5D |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | B909E3B5B82E45F09AF1F2D9D120A581 |
| 17 | DatabaseUpgrade | 8DC6BA588FEC46F0A4A9EFC0938AC25F |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-defaults --force`.
