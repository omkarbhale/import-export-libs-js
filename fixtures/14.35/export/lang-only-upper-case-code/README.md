# lang-only-upper-case-code

ExportLanguageResourcesOnly with `DE`. Engine 14.35, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 57). Catalogue: 14.35 language modes, S10 (ticket 57).

## Exercises

LP-180: the check compares exactly while the server's codes are lower-cased, so `DE` is reported as not installed although `de` is.

## Not covered here

Recorded while dev had the Languages `en`, `de` and `fr` (added for the recording and deleted again afterwards, as ticket 45 did; `oracle/README.md` says how).

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-LANGINST | LIBSJS_SCRATCH_ML | 9A6E52C3E2003A22F014863A787CC9F3 | LIBSJS-SCRATCH-ML_All |
| 2 | LIBSJS-SCRATCH-LANGINST | LIBSJS_SCRATCH_ML | DCEA32D00A07DB24159FDBB5AC7CD1F0 | LIBSJS-SCRATCH-ML_De |
| 3 | LIBSJS-SCRATCH-LANGINST | LIBSJS_SCRATCH_ML | FF462072D1C8242084376811138692E3 | LIBSJS-SCRATCH-ML_En |

Engine options: `engineAction` = `"ExportLanguageResourcesOnly"`, `languages` = `["DE"]`.

## Result

The run ends in an engine error, which the case pins: host exit 2, 8 calls.

```
Aras.Tools.SolutionUpgrade.CItemException: Some of the selected languages are not installed for current Aras Innovator: DE.
```

## Seed

The case exports items that did not exist on dev. The run (seed group `lang-ml`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: scratch ItemType with translated labels (`LIBSJS-SCRATCH-LANG`; default options)

Created 8, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 5261411CD16F41289AC8D01F3CC496F7 |
| 2 | PackageDefinition | 0D5135C02C1F49D2837CFF73532BCD20 |
| 3 | Permission | 250E490AF633DA5FD221FBE757210F7D |
| 4 | PackageGroup | A57FE058D782408A87C3CE5377ACEE21 |
| 5 | PackageElement | 85BBE9F02C96470D90AB29D7A7C44210 |
| 6 | ItemType | C442609F868621BBE8487B6F8EA1A27E |
| 7 | PackageGroup | FBB69B16E9874A03A3848E3A295F64E8 |
| 8 | PackageElement | EC4ACD5D41E74FEDB54465B8FC371ECE |

### Seed step 2: instances with translated values (`LIBSJS-SCRATCH-LANGINST`; default options)

Created 9, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0DD4BBB8F8B1481B98EB0128957B3142 |
| 2 | PackageDefinition | CAF623BCE42F411EB34A36C3FC99AF23 |
| 3 | LIBSJS_SCRATCH_ML | 9A6E52C3E2003A22F014863A787CC9F3 |
| 4 | PackageGroup | 70A459A71546426282818AED8DCCDB45 |
| 5 | PackageElement | C9899C5DCEB1422C9722A653B4BAD58A |
| 6 | LIBSJS_SCRATCH_ML | DCEA32D00A07DB24159FDBB5AC7CD1F0 |
| 7 | PackageElement | 5E132F86CC13403D8D7DDA450336F6AD |
| 8 | LIBSJS_SCRATCH_ML | FF462072D1C8242084376811138692E3 |
| 9 | PackageElement | 5ADE33D537214DE4A69E607EC1BEABAD |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 5ADE33D537214DE4A69E607EC1BEABAD |
| 2 | LIBSJS_SCRATCH_ML | FF462072D1C8242084376811138692E3 |
| 3 | PackageElement | 5E132F86CC13403D8D7DDA450336F6AD |
| 4 | LIBSJS_SCRATCH_ML | DCEA32D00A07DB24159FDBB5AC7CD1F0 |
| 5 | PackageElement | C9899C5DCEB1422C9722A653B4BAD58A |
| 6 | PackageGroup | 70A459A71546426282818AED8DCCDB45 |
| 7 | LIBSJS_SCRATCH_ML | 9A6E52C3E2003A22F014863A787CC9F3 |
| 8 | PackageDefinition | CAF623BCE42F411EB34A36C3FC99AF23 |
| 9 | DatabaseUpgrade | 0DD4BBB8F8B1481B98EB0128957B3142 |
| 10 | PackageElement | EC4ACD5D41E74FEDB54465B8FC371ECE |
| 11 | PackageGroup | FBB69B16E9874A03A3848E3A295F64E8 |
| 12 | ItemType | C442609F868621BBE8487B6F8EA1A27E |
| 13 | PackageElement | 85BBE9F02C96470D90AB29D7A7C44210 |
| 14 | PackageGroup | A57FE058D782408A87C3CE5377ACEE21 |
| 15 | Permission | 250E490AF633DA5FD221FBE757210F7D |
| 16 | PackageDefinition | 0D5135C02C1F49D2837CFF73532BCD20 |
| 17 | DatabaseUpgrade | 5261411CD16F41289AC8D01F3CC496F7 |

## Spec rules

LP-114, LP-115, LP-180.

## Files

| File | What |
|---|---|
| `case.json` | this case's input and result, machine-readable |
| `run.json` | the oracle's run record: toolset identity, parameters, host info |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `output/` | the export folder, byte for byte |

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 14.35 --only lang-only-upper-case-code --force` (it seeds, exports and cleans up again).
