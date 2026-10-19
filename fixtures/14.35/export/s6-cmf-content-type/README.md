# s6-cmf-content-type

cmf_ContentType with an element type and a property type. Engine 14.35, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 57). Catalogue: E41, S6 (ticket 05).

## Exercises

The cmf_ContentType export request and file, with its cmf_ElementType and cmf_PropertyType relationships.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-SPECIAL | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 | LIBSJS_SCRATCH_CmfContent |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 21 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s6-special`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: mac policy, derived relationships, ItemType with content type (`LIBSJS-SCRATCH-SPECIAL`; default options)

Created 23, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 7CA16F778CCB4B36A3A760DE88DB1C56 |
| 2 | PackageDefinition | 4858B90F6190429BB27C8204259FE35C |
| 3 | Permission | 2B85D7A515561536323E44F6B7938EA9 |
| 4 | PackageGroup | D60666942C9C4AB88BD8DCC0663CDE9D |
| 5 | PackageElement | 8005B57EBEDA40F1822324B51E7FEA94 |
| 6 | Method | 0B6A1FFC63E810D4E2C077D5CFB2CD20 |
| 7 | PackageGroup | 3E4DCDCD6515408683FE2DA3759B7CCB |
| 8 | PackageElement | A1786392E26746FEA9BF5065B3A3334C |
| 9 | ItemType | DF1A99C67C94E5A77568B841ACFE24D1 |
| 10 | PackageGroup | 09F0EA6654154561A89183F84B21F048 |
| 11 | PackageElement | 1894A60B12A047F39601E5FC6C1AD69F |
| 12 | mp_MacPolicy | 01C454B820C6CF5A776842AC7136C210 |
| 13 | PackageGroup | 7BC5D7D85BD844DE988889166EA28A25 |
| 14 | PackageElement | 5D46994C2AC14CBFB94C28F213091CDD |
| 15 | qry_QueryDefinition | 6FA2920AD941FB19DA3B0B22EAB5B08B |
| 16 | PackageGroup | 335DB0F271C242A2BBA87BF195A46CBE |
| 17 | PackageElement | 78C903423C764A4DA90B47B878F36BA8 |
| 18 | dr_RelationshipFamily | 62210B831C5192B63D8391421B5EFA39 |
| 19 | PackageGroup | DEEAF6E49C8D42CDB07A2BAEC7560169 |
| 20 | PackageElement | 45BA2A003E4A4E01886DC54FFA987C5A |
| 21 | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 |
| 22 | PackageGroup | D23381F6B2C74B48A6F9695DFE89B9AD |
| 23 | PackageElement | 201663E823D3496EB845A1D92CCDEEE6 |

### Seed step 2: access control and tabular view (`LIBSJS-SCRATCH-ACCESS`, `LIBSJS-SCRATCH-CMFVIEW`; default options)

Created 16, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | B824660062FE409EA0ADCA6890E54E07 |
| 2 | PackageDefinition | A46A33FDEF7042DAA913FC71B5FBE437 |
| 3 | Permission | 63F701C424AE914C5C687C6640CE7A5B |
| 4 | PackageGroup | CC7C8F6F2B3549C19B31C08CEB371257 |
| 5 | PackageElement | B622147AD0944D6481055A636A25AA38 |
| 6 | ac_PolicyAccessItemAttribute | 5806F8B08494E753C5EFF0647C48002D |
| 7 | PackageGroup | 75C13917175C4E788D3C14CAB5B143A5 |
| 8 | PackageElement | 46311A5969D040F4A42C558882C30920 |
| 9 | dac_DomainDefinition | FCEC8D70CA84F92ED21FD3F682F09B7E |
| 10 | PackageGroup | C15A073FCEC34505A7A1886B0335166A |
| 11 | PackageElement | 6C3B103C8AB14D9497B5358860B7EE1B |
| 12 | DatabaseUpgrade | CD222DEBA95D47C3A70E44C5EE8CC6B9 |
| 13 | PackageDefinition | 70F8731FEDF741E99C0F356B8157B979 |
| 14 | cmf_TabularView | A7EA68DE5B387AD8587599484295B2DF |
| 15 | PackageGroup | D343BBE915D34BDC927CFE0EDE355E3A |
| 16 | PackageElement | C17604534BD24E57A3317D39CC890938 |

### Seed step 3: implementation query (`LIBSJS-SCRATCH-DRIMPL`; default options)

Created 2, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 5E4CA3E5C4A24FECB8449CBC2291404C |
| 2 | PackageDefinition | 399D6DDEE4BA4178A911BE8AEAD3B5C5 |

### Deleted by the cleanup: 41

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 399D6DDEE4BA4178A911BE8AEAD3B5C5 |
| 2 | DatabaseUpgrade | 5E4CA3E5C4A24FECB8449CBC2291404C |
| 3 | PackageElement | C17604534BD24E57A3317D39CC890938 |
| 4 | PackageGroup | D343BBE915D34BDC927CFE0EDE355E3A |
| 5 | cmf_TabularView | A7EA68DE5B387AD8587599484295B2DF |
| 6 | PackageDefinition | 70F8731FEDF741E99C0F356B8157B979 |
| 7 | DatabaseUpgrade | CD222DEBA95D47C3A70E44C5EE8CC6B9 |
| 8 | PackageElement | 6C3B103C8AB14D9497B5358860B7EE1B |
| 9 | PackageGroup | C15A073FCEC34505A7A1886B0335166A |
| 10 | dac_DomainDefinition | FCEC8D70CA84F92ED21FD3F682F09B7E |
| 11 | PackageElement | 46311A5969D040F4A42C558882C30920 |
| 12 | PackageGroup | 75C13917175C4E788D3C14CAB5B143A5 |
| 13 | ac_PolicyAccessItemAttribute | 5806F8B08494E753C5EFF0647C48002D |
| 14 | PackageElement | B622147AD0944D6481055A636A25AA38 |
| 15 | PackageGroup | CC7C8F6F2B3549C19B31C08CEB371257 |
| 16 | Permission | 63F701C424AE914C5C687C6640CE7A5B |
| 17 | PackageDefinition | A46A33FDEF7042DAA913FC71B5FBE437 |
| 18 | DatabaseUpgrade | B824660062FE409EA0ADCA6890E54E07 |
| 19 | PackageElement | 201663E823D3496EB845A1D92CCDEEE6 |
| 20 | PackageGroup | D23381F6B2C74B48A6F9695DFE89B9AD |
| 21 | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 |
| 22 | PackageElement | 45BA2A003E4A4E01886DC54FFA987C5A |
| 23 | PackageGroup | DEEAF6E49C8D42CDB07A2BAEC7560169 |
| 24 | dr_RelationshipFamily | 62210B831C5192B63D8391421B5EFA39 |
| 25 | PackageElement | 78C903423C764A4DA90B47B878F36BA8 |
| 26 | PackageGroup | 335DB0F271C242A2BBA87BF195A46CBE |
| 27 | qry_QueryDefinition | 6FA2920AD941FB19DA3B0B22EAB5B08B |
| 28 | PackageElement | 5D46994C2AC14CBFB94C28F213091CDD |
| 29 | PackageGroup | 7BC5D7D85BD844DE988889166EA28A25 |
| 30 | mp_MacPolicy | 01C454B820C6CF5A776842AC7136C210 |
| 31 | PackageElement | 1894A60B12A047F39601E5FC6C1AD69F |
| 32 | PackageGroup | 09F0EA6654154561A89183F84B21F048 |
| 33 | ItemType | DF1A99C67C94E5A77568B841ACFE24D1 |
| 34 | PackageElement | A1786392E26746FEA9BF5065B3A3334C |
| 35 | PackageGroup | 3E4DCDCD6515408683FE2DA3759B7CCB |
| 36 | Method | 0B6A1FFC63E810D4E2C077D5CFB2CD20 |
| 37 | PackageElement | 8005B57EBEDA40F1822324B51E7FEA94 |
| 38 | PackageGroup | D60666942C9C4AB88BD8DCC0663CDE9D |
| 39 | Permission | 2B85D7A515561536323E44F6B7938EA9 |
| 40 | PackageDefinition | 4858B90F6190429BB27C8204259FE35C |
| 41 | DatabaseUpgrade | 7CA16F778CCB4B36A3A760DE88DB1C56 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 14.35 --only s6-cmf-content-type --force` (it seeds, exports and cleans up again).
