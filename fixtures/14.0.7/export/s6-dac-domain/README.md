# s6-dac-domain

dac_DomainDefinition with a sub-domain permission whose condition holds non-ASCII text. Engine 14.0.7, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 67). Catalogue: E45, S6, R4 (ticket 05).

## Exercises

EXP-119: the condition_xml of a dac_SubdomainPermission is re-indented through HtmlDecode, XmlWriter and HtmlEncode; the condition holds an e with an acute accent and a no-break space.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-ACCESS | dac_DomainDefinition | FCEC8D70CA84F92ED21FD3F682F09B7E | LIBSJS_SCRATCH_DacDomain |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 20 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s6-special`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: mac policy, derived relationships, ItemType with content type (`LIBSJS-SCRATCH-SPECIAL`; default options)

Created 23, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 7D0A66C984384EF8A947E25DE9A90F01 |
| 2 | PackageDefinition | 3FA5295F1A07453A9A282A96CB572145 |
| 3 | Permission | 2B85D7A515561536323E44F6B7938EA9 |
| 4 | PackageGroup | E88923CC2FA04E60AF516575153B441F |
| 5 | PackageElement | 66EC30667744470B99F10C2AFB8E366C |
| 6 | Method | 0B6A1FFC63E810D4E2C077D5CFB2CD20 |
| 7 | PackageGroup | F0DB923FA71E4D1C870E8A8DFDB0DF0E |
| 8 | PackageElement | B572773DBA4344A49742C5554CF7D576 |
| 9 | ItemType | DF1A99C67C94E5A77568B841ACFE24D1 |
| 10 | PackageGroup | 7F908FE54CCF41759BC4522ED87EC423 |
| 11 | PackageElement | 21758DC4B7434CE89EFA94689E6EB278 |
| 12 | mp_MacPolicy | 01C454B820C6CF5A776842AC7136C210 |
| 13 | PackageGroup | 29A9A7F309754DDEBF54CBBDDDB2A263 |
| 14 | PackageElement | D7E76EB395104C4292990DCC107687B7 |
| 15 | qry_QueryDefinition | 6FA2920AD941FB19DA3B0B22EAB5B08B |
| 16 | PackageGroup | 0B2C9C8A579546CC8A1A8470268722FC |
| 17 | PackageElement | DFD3BED0B009445482F5869C85A38EA8 |
| 18 | dr_RelationshipFamily | 62210B831C5192B63D8391421B5EFA39 |
| 19 | PackageGroup | F574003F10D04952898109E38C163FA9 |
| 20 | PackageElement | E06DF276D6094D83BC615C66FF5424B6 |
| 21 | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 |
| 22 | PackageGroup | 87047DF082AC48F7AAF2DA7A8D8EFFF3 |
| 23 | PackageElement | D7A439A6356E49F8B895B6DCDC6C93E2 |

### Seed step 2: access control and tabular view (`LIBSJS-SCRATCH-ACCESS`, `LIBSJS-SCRATCH-CMFVIEW`; default options)

Created 16, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | C2D466E7BE72474C860BB735F1D7ECD6 |
| 2 | PackageDefinition | 371200A6A10A4732993B6D016E6B0E2A |
| 3 | Permission | 63F701C424AE914C5C687C6640CE7A5B |
| 4 | PackageGroup | 5F98A8A714614515B1ABE9135284051B |
| 5 | PackageElement | D9B5C5661C124AC78BC002CA82A2ADC3 |
| 6 | ac_PolicyAccessItemAttribute | 5806F8B08494E753C5EFF0647C48002D |
| 7 | PackageGroup | 22176F0248B548DE91D3C39386AB8A84 |
| 8 | PackageElement | 46F29FEC910E460B9CE79E335EF9577E |
| 9 | dac_DomainDefinition | FCEC8D70CA84F92ED21FD3F682F09B7E |
| 10 | PackageGroup | 947729D462B5403EA5A1B6D8A0AE7CA4 |
| 11 | PackageElement | 8C77427C3B764BB196B04F7255766012 |
| 12 | DatabaseUpgrade | 528BF0598E6B46D48AF4C645483FC5A7 |
| 13 | PackageDefinition | 3A30AFA3FEEC4F7389DB4477EC766CB0 |
| 14 | cmf_TabularView | A7EA68DE5B387AD8587599484295B2DF |
| 15 | PackageGroup | CF60B97A08BE49BB8DC4A974DE698460 |
| 16 | PackageElement | 3D2E3CAA16414E2EB1824DB9A9DD3F9E |

### Seed step 3: implementation query (`LIBSJS-SCRATCH-DRIMPL`; default options)

Created 2, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | E55DA2096E464D96A447ECC2C46C71B2 |
| 2 | PackageDefinition | 253486FAE1DC4F65BEFAD2E69BC9E001 |

### Deleted by the cleanup: 41

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 253486FAE1DC4F65BEFAD2E69BC9E001 |
| 2 | DatabaseUpgrade | E55DA2096E464D96A447ECC2C46C71B2 |
| 3 | PackageElement | 3D2E3CAA16414E2EB1824DB9A9DD3F9E |
| 4 | PackageGroup | CF60B97A08BE49BB8DC4A974DE698460 |
| 5 | cmf_TabularView | A7EA68DE5B387AD8587599484295B2DF |
| 6 | PackageDefinition | 3A30AFA3FEEC4F7389DB4477EC766CB0 |
| 7 | DatabaseUpgrade | 528BF0598E6B46D48AF4C645483FC5A7 |
| 8 | PackageElement | 8C77427C3B764BB196B04F7255766012 |
| 9 | PackageGroup | 947729D462B5403EA5A1B6D8A0AE7CA4 |
| 10 | dac_DomainDefinition | FCEC8D70CA84F92ED21FD3F682F09B7E |
| 11 | PackageElement | 46F29FEC910E460B9CE79E335EF9577E |
| 12 | PackageGroup | 22176F0248B548DE91D3C39386AB8A84 |
| 13 | ac_PolicyAccessItemAttribute | 5806F8B08494E753C5EFF0647C48002D |
| 14 | PackageElement | D9B5C5661C124AC78BC002CA82A2ADC3 |
| 15 | PackageGroup | 5F98A8A714614515B1ABE9135284051B |
| 16 | Permission | 63F701C424AE914C5C687C6640CE7A5B |
| 17 | PackageDefinition | 371200A6A10A4732993B6D016E6B0E2A |
| 18 | DatabaseUpgrade | C2D466E7BE72474C860BB735F1D7ECD6 |
| 19 | PackageElement | D7A439A6356E49F8B895B6DCDC6C93E2 |
| 20 | PackageGroup | 87047DF082AC48F7AAF2DA7A8D8EFFF3 |
| 21 | cmf_ContentType | F3CA127F4A444F45CA7154BE94D4C168 |
| 22 | PackageElement | E06DF276D6094D83BC615C66FF5424B6 |
| 23 | PackageGroup | F574003F10D04952898109E38C163FA9 |
| 24 | dr_RelationshipFamily | 62210B831C5192B63D8391421B5EFA39 |
| 25 | PackageElement | DFD3BED0B009445482F5869C85A38EA8 |
| 26 | PackageGroup | 0B2C9C8A579546CC8A1A8470268722FC |
| 27 | qry_QueryDefinition | 6FA2920AD941FB19DA3B0B22EAB5B08B |
| 28 | PackageElement | D7E76EB395104C4292990DCC107687B7 |
| 29 | PackageGroup | 29A9A7F309754DDEBF54CBBDDDB2A263 |
| 30 | mp_MacPolicy | 01C454B820C6CF5A776842AC7136C210 |
| 31 | PackageElement | 21758DC4B7434CE89EFA94689E6EB278 |
| 32 | PackageGroup | 7F908FE54CCF41759BC4522ED87EC423 |
| 33 | ItemType | DF1A99C67C94E5A77568B841ACFE24D1 |
| 34 | PackageElement | B572773DBA4344A49742C5554CF7D576 |
| 35 | PackageGroup | F0DB923FA71E4D1C870E8A8DFDB0DF0E |
| 36 | Method | 0B6A1FFC63E810D4E2C077D5CFB2CD20 |
| 37 | PackageElement | 66EC30667744470B99F10C2AFB8E366C |
| 38 | PackageGroup | E88923CC2FA04E60AF516575153B441F |
| 39 | Permission | 2B85D7A515561536323E44F6B7938EA9 |
| 40 | PackageDefinition | 3FA5295F1A07453A9A282A96CB572145 |
| 41 | DatabaseUpgrade | 7D0A66C984384EF8A947E25DE9A90F01 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --only s6-dac-domain --force` (it seeds, exports and cleans up again).
