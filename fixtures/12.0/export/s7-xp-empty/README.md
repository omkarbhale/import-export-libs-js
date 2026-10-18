# s7-xp-empty

Unclassified instance of an ItemType whose class has extended properties. Engine 12.0, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 48). Catalogue: E44, S7, xp-* values (ticket 05).

## Exercises

EXP-106: an item of the same type that is in no class: its fetch returns no xp-* element, so the step has nothing to rewrite.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-XPROPINST | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A | LIBSJS-SCRATCH-XIT_Empty |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 12 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s7-xprop`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: types and extended properties (`LIBSJS-SCRATCH-XPROP`; default options)

Created 22, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | ECE515E6303C44B2B38282D04E9C17D5 |
| 2 | PackageDefinition | A7BF343818E040D6BBFF7580627DB589 |
| 3 | Permission | 0656C7682C3FA862608961EFAE2F41FD |
| 4 | PackageGroup | 062C6E12B1DF458EBB15C8B0E958C7F7 |
| 5 | PackageElement | 8F331354D77B4434856741BD0D4E5793 |
| 6 | xPropertyDefinition | E9DB12E50F5C07ABAE874CCDAFCFFBBB |
| 7 | PackageGroup | EED22B564E454875BA775E6AA9C05E77 |
| 8 | PackageElement | A6E856100B3246038821DD5BE85D1923 |
| 9 | xPropertyDefinition | 76E3B4CED43EE1E91FCD3DD85C99B2AF |
| 10 | PackageElement | 074129F072E94B03B5EC9270B7A4F7AB |
| 11 | Permission_ItemClassification | C48CF1C1287BBDFE96E06E35676D17FD |
| 12 | PackageGroup | FAEA0C6B81B74FC5B11D6848C84889E8 |
| 13 | PackageElement | 6CCB8AD4183344FBA032391DCD426065 |
| 14 | Permission_PropertyValue | 22F24EA57E40B8D59BAD8E0E2E5382CA |
| 15 | PackageGroup | 2C10B23AB05E48E8B0F72C69F105F5C0 |
| 16 | PackageElement | 50A6595E512B4C1095C6B4F10A8D0E0F |
| 17 | ItemType | 534A999320CB43385FFE3D51D2BA2F9A |
| 18 | PackageGroup | C51B4BF27C5F4BED94661CAB89224B15 |
| 19 | PackageElement | C2B8A69734D6473F99B106525C527342 |
| 20 | xClassificationTree | 92EEF539A9A190D05A5AA0BAE1D113E0 |
| 21 | PackageGroup | B74C076423AA479299D080BE219D0715 |
| 22 | PackageElement | CC53BD4681D9411F9E78BCB0C111C396 |

### Seed step 2: instances (`LIBSJS-SCRATCH-XPROPINST`; default options)

Created 7, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0AAD0FC5D1174DBDAA52619CCAB37571 |
| 2 | PackageDefinition | 3665DCA9FBE946BE90BCEA3B53F67977 |
| 3 | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A |
| 4 | PackageGroup | EB718B6656274A95B38F13379BE681A3 |
| 5 | PackageElement | 16C712C705B1499989BBF1923896CC6C |
| 6 | LIBSJS_SCRATCH_XIT | BB375A03ED9E92E2098011DDF895576F |
| 7 | PackageElement | 91EF1D50AAAC405EB6516E89E2ACF33E |

### Deleted by the cleanup: 29

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 91EF1D50AAAC405EB6516E89E2ACF33E |
| 2 | LIBSJS_SCRATCH_XIT | BB375A03ED9E92E2098011DDF895576F |
| 3 | PackageElement | 16C712C705B1499989BBF1923896CC6C |
| 4 | PackageGroup | EB718B6656274A95B38F13379BE681A3 |
| 5 | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A |
| 6 | PackageDefinition | 3665DCA9FBE946BE90BCEA3B53F67977 |
| 7 | DatabaseUpgrade | 0AAD0FC5D1174DBDAA52619CCAB37571 |
| 8 | PackageElement | CC53BD4681D9411F9E78BCB0C111C396 |
| 9 | PackageGroup | B74C076423AA479299D080BE219D0715 |
| 10 | xClassificationTree | 92EEF539A9A190D05A5AA0BAE1D113E0 |
| 11 | PackageElement | C2B8A69734D6473F99B106525C527342 |
| 12 | PackageGroup | C51B4BF27C5F4BED94661CAB89224B15 |
| 13 | ItemType | 534A999320CB43385FFE3D51D2BA2F9A |
| 14 | PackageElement | 50A6595E512B4C1095C6B4F10A8D0E0F |
| 15 | PackageGroup | 2C10B23AB05E48E8B0F72C69F105F5C0 |
| 16 | Permission_PropertyValue | 22F24EA57E40B8D59BAD8E0E2E5382CA |
| 17 | PackageElement | 6CCB8AD4183344FBA032391DCD426065 |
| 18 | PackageGroup | FAEA0C6B81B74FC5B11D6848C84889E8 |
| 19 | Permission_ItemClassification | C48CF1C1287BBDFE96E06E35676D17FD |
| 20 | PackageElement | 074129F072E94B03B5EC9270B7A4F7AB |
| 21 | xPropertyDefinition | 76E3B4CED43EE1E91FCD3DD85C99B2AF |
| 22 | PackageElement | A6E856100B3246038821DD5BE85D1923 |
| 23 | PackageGroup | EED22B564E454875BA775E6AA9C05E77 |
| 24 | xPropertyDefinition | E9DB12E50F5C07ABAE874CCDAFCFFBBB |
| 25 | PackageElement | 8F331354D77B4434856741BD0D4E5793 |
| 26 | PackageGroup | 062C6E12B1DF458EBB15C8B0E958C7F7 |
| 27 | Permission | 0656C7682C3FA862608961EFAE2F41FD |
| 28 | PackageDefinition | A7BF343818E040D6BBFF7580627DB589 |
| 29 | DatabaseUpgrade | ECE515E6303C44B2B38282D04E9C17D5 |

## Spec rules

None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 12.0 --only s7-xp-empty --force` (it seeds, exports and cleans up again).
