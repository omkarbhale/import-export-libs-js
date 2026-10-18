# s6-cmf-content-type

cmf_ContentType with an element type and a property type. Engine 12.0, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 48). Catalogue: E41, S6 (ticket 05).

## Exercises

The cmf_ContentType export request and file, with its cmf_ElementType and cmf_PropertyType relationships.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-SPECIAL | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 | LIBSJS_SCRATCH_CmfContent |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 20 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s6-special`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: mac policy, derived relationships, ItemType with content type (`LIBSJS-SCRATCH-SPECIAL`; default options)

Created 23, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 634016C0941445629A99E1B1C809FAD6 |
| 2 | PackageDefinition | BCD9B4EC167A43AF91939C84938192CC |
| 3 | Permission | 2B85D7A515561536323E44F6B7938EA9 |
| 4 | PackageGroup | 2DD3897ED5DB4B9C8BA5E74D01CD3892 |
| 5 | PackageElement | A4E02E160AB944FC9F084D210AFD805E |
| 6 | Method | 0B6A1FFC63E810D4E2C077D5CFB2CD20 |
| 7 | PackageGroup | B7529127EBB34415ABCA4EB9F17B45FA |
| 8 | PackageElement | 1AD4408D35A94C5BA22C71FF7FD349C8 |
| 9 | ItemType | DF1A99C67C94E5A77568B841ACFE24D1 |
| 10 | PackageGroup | 53E55DC17E7F41948162C329C791E19F |
| 11 | PackageElement | 99D56C16E0FB450089CE8BFD8FBE7145 |
| 12 | mp_MacPolicy | 01C454B820C6CF5A776842AC7136C210 |
| 13 | PackageGroup | 0EE0874D54864575A740A98E14678A5C |
| 14 | PackageElement | 80354E3DE9244E308B96F01E48D145F6 |
| 15 | qry_QueryDefinition | 6FA2920AD941FB19DA3B0B22EAB5B08B |
| 16 | PackageGroup | 066331469E35449A97A6C3F33764DEBF |
| 17 | PackageElement | C5280AD2FE64487A802D63A1CC5776E2 |
| 18 | dr_RelationshipFamily | 62210B831C5192B63D8391421B5EFA39 |
| 19 | PackageGroup | F4508BD50482487CA167C8842AFEEECE |
| 20 | PackageElement | EC0A70C878984B8D9E6BCA577B4E7694 |
| 21 | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 |
| 22 | PackageGroup | 4766F3180B784A3FB197D45B88469E4A |
| 23 | PackageElement | 2DC3B49C9C21440A9DAD4DA9EC94CD4D |

### Seed step 2: access control and tabular view (`LIBSJS-SCRATCH-ACCESS`, `LIBSJS-SCRATCH-CMFVIEW`; default options)

Created 16, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 1009654252D242F48A9DAF2727D5026C |
| 2 | PackageDefinition | 37B940503C65406E99906FDEB6FEC123 |
| 3 | Permission | 63F701C424AE914C5C687C6640CE7A5B |
| 4 | PackageGroup | 96FD1742E64E4987931846312C553D1A |
| 5 | PackageElement | 633ABEE15070402C99AFF41C4E944C04 |
| 6 | dac_DomainDefinition | FCEC8D70CA84F92ED21FD3F682F09B7E |
| 7 | PackageGroup | D8080B7195214C2BAD4B8BA0319DEFC9 |
| 8 | PackageElement | 6BE99D26A7EC4FFEA233AC26735672B0 |
| 9 | ac_PolicyAccessItemAttribute | 5806F8B08494E753C5EFF0647C48002D |
| 10 | PackageGroup | 82F85D2C12CB4F7A83B7063A3F3950EB |
| 11 | PackageElement | 0479CA5345264ECB89698DEF3ACCE480 |
| 12 | DatabaseUpgrade | 12411D5E77FA46D5B9003031F4A49241 |
| 13 | PackageDefinition | BD1F340A6AA04EACA0C56BBEA138E4FD |
| 14 | cmf_TabularView | A7EA68DE5B387AD8587599484295B2DF |
| 15 | PackageGroup | 99B6D345CE2F46EFB7DB61C3550ED6D1 |
| 16 | PackageElement | 9A22ED82DC7F409280F5FD44DF8FACE0 |

### Seed step 3: implementation query (`LIBSJS-SCRATCH-DRIMPL`; default options)

Created 2, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 548AE3EB3E8E499E91A40D3F10ADBFB4 |
| 2 | PackageDefinition | 60201536247F4F47AFE7AF79A9C096CB |

### Deleted by the cleanup: 41

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 60201536247F4F47AFE7AF79A9C096CB |
| 2 | DatabaseUpgrade | 548AE3EB3E8E499E91A40D3F10ADBFB4 |
| 3 | PackageElement | 9A22ED82DC7F409280F5FD44DF8FACE0 |
| 4 | PackageGroup | 99B6D345CE2F46EFB7DB61C3550ED6D1 |
| 5 | cmf_TabularView | A7EA68DE5B387AD8587599484295B2DF |
| 6 | PackageDefinition | BD1F340A6AA04EACA0C56BBEA138E4FD |
| 7 | DatabaseUpgrade | 12411D5E77FA46D5B9003031F4A49241 |
| 8 | PackageElement | 0479CA5345264ECB89698DEF3ACCE480 |
| 9 | PackageGroup | 82F85D2C12CB4F7A83B7063A3F3950EB |
| 10 | ac_PolicyAccessItemAttribute | 5806F8B08494E753C5EFF0647C48002D |
| 11 | PackageElement | 6BE99D26A7EC4FFEA233AC26735672B0 |
| 12 | PackageGroup | D8080B7195214C2BAD4B8BA0319DEFC9 |
| 13 | dac_DomainDefinition | FCEC8D70CA84F92ED21FD3F682F09B7E |
| 14 | PackageElement | 633ABEE15070402C99AFF41C4E944C04 |
| 15 | PackageGroup | 96FD1742E64E4987931846312C553D1A |
| 16 | Permission | 63F701C424AE914C5C687C6640CE7A5B |
| 17 | PackageDefinition | 37B940503C65406E99906FDEB6FEC123 |
| 18 | DatabaseUpgrade | 1009654252D242F48A9DAF2727D5026C |
| 19 | PackageElement | 2DC3B49C9C21440A9DAD4DA9EC94CD4D |
| 20 | PackageGroup | 4766F3180B784A3FB197D45B88469E4A |
| 21 | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 |
| 22 | PackageElement | EC0A70C878984B8D9E6BCA577B4E7694 |
| 23 | PackageGroup | F4508BD50482487CA167C8842AFEEECE |
| 24 | dr_RelationshipFamily | 62210B831C5192B63D8391421B5EFA39 |
| 25 | PackageElement | C5280AD2FE64487A802D63A1CC5776E2 |
| 26 | PackageGroup | 066331469E35449A97A6C3F33764DEBF |
| 27 | qry_QueryDefinition | 6FA2920AD941FB19DA3B0B22EAB5B08B |
| 28 | PackageElement | 80354E3DE9244E308B96F01E48D145F6 |
| 29 | PackageGroup | 0EE0874D54864575A740A98E14678A5C |
| 30 | mp_MacPolicy | 01C454B820C6CF5A776842AC7136C210 |
| 31 | PackageElement | 99D56C16E0FB450089CE8BFD8FBE7145 |
| 32 | PackageGroup | 53E55DC17E7F41948162C329C791E19F |
| 33 | ItemType | DF1A99C67C94E5A77568B841ACFE24D1 |
| 34 | PackageElement | 1AD4408D35A94C5BA22C71FF7FD349C8 |
| 35 | PackageGroup | B7529127EBB34415ABCA4EB9F17B45FA |
| 36 | Method | 0B6A1FFC63E810D4E2C077D5CFB2CD20 |
| 37 | PackageElement | A4E02E160AB944FC9F084D210AFD805E |
| 38 | PackageGroup | 2DD3897ED5DB4B9C8BA5E74D01CD3892 |
| 39 | Permission | 2B85D7A515561536323E44F6B7938EA9 |
| 40 | PackageDefinition | BCD9B4EC167A43AF91939C84938192CC |
| 41 | DatabaseUpgrade | 634016C0941445629A99E1B1C809FAD6 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 12.0 --only s6-cmf-content-type --force` (it seeds, exports and cleans up again).
