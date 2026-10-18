# s4-del

Delete actions against items an earlier import created. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4 (ticket 05).

## Exercises

The build.xsl drop bug: List, ItemType and Identity deletes are dropped silently (their types are listed, but only for adds and edits); Form delete (its own bucket), Field delete (any action) and Value delete (an unlisted type, last bucket) are kept. The plan the import prints is the engine's answer to which ones ran.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import BASE | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 246 |
| 2 | import DEL | `LIBSJS-SCRATCH-DEL` | merge=true | success (0) | 0 | 21 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 099A2644AAD04392A8D68FD12857BAC1 |
| 2 | PackageDefinition | 2B4D0CC89FE24C5A94250EEE3F1BC5BC |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 2CF6FB8327E840F6837904F7C0C57E85 |
| 5 | PackageElement | A09DC2683A9B4396A9E8BC5ABC720951 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | DDFB7EB0B952487B88F3D2936EC9D3E8 |
| 8 | PackageElement | 96C17741DB8C43EBB3004B3B27D8207D |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | D5798C6EA0F34A7DBD83B67CDA038782 |
| 11 | PackageElement | 0565D9C0248942D08E4DA533DD2F7937 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 38EF812AAC4F434C9E617F48DBF15F3F |
| 14 | PackageElement | E6291D240FEC4B99A3F399FE769D988F |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 10084226C6974F72A564168F23C8AE54 |
| 18 | PackageElement | 3431E74C252244998F045F5D97CFF55F |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | D31ECA49FAD2405EA7BB361846EE7CC2 |
| 21 | PackageElement | 7D0AC272BEEF4F9D881C7D0A79BD45CE |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | B0E22AA3E2874F71BE71857BAB1CBEF4 |
| 24 | PackageElement | 3CEEC86E133947DB83374AC806A69E7B |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 90227C2535EA4AA492F1CB3A414C472E |
| 27 | PackageElement | 1C878A8A5BBE40BDAD15BF9E14B2B05E |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 9DCD9F4C7E5D43039C26E9FB90B7E2ED |
| 30 | PackageElement | 06A7A61CD2B84022AB0EC5685D90878C |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | B7A0D06C91954D33941237DB76F9A6EE |
| 33 | PackageElement | A3C3FC954BA3499EAB77BAB10728EAF7 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 9B5FF5DF1E1F45A38B20FA58FAB5EAF0 |
| 36 | PackageElement | 494B804F7930478280616D136D69FCCE |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 9B5B8FE26AFD4DECAF98A174331F0AB7 |
| 39 | PackageElement | 0319BE8BC34E4506BEF656963209C1FA |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 435E7D8354E74FD1A842957664B19CDD |
| 42 | PackageElement | 25B1030AB07047D9B6A69E3B90465687 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | CC811334F6934BABB6CEB90A5747CF0C |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 8519273D99C84EC690D0BADB6E33852D |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 209E08A7C4CB49F89EBCC45C9F78849D |
| 49 | PackageElement | 4E20ED369B8146799C837C772C4D6B3A |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | CF49115C50E0413CB857029A2904068A |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 03668AF0557C485EB839D8BF1C8B63C7 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 648C00ABCC0240D184F349903FD0A331 |
| 56 | PackageElement | 7BCB480D99F745BAB435443269C05E34 |

### Step 2: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | F57105B1D0C94C02993934D2C2F7B87D |
| 2 | PackageDefinition | 1D768E80200A4A7B9023883BF3C25B52 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 1D768E80200A4A7B9023883BF3C25B52 |
| 2 | DatabaseUpgrade | F57105B1D0C94C02993934D2C2F7B87D |
| 3 | PackageElement | 7BCB480D99F745BAB435443269C05E34 |
| 4 | PackageGroup | 648C00ABCC0240D184F349903FD0A331 |
| 5 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 6 | PackageElement | 03668AF0557C485EB839D8BF1C8B63C7 |
| 7 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 8 | PackageElement | CF49115C50E0413CB857029A2904068A |
| 9 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 10 | PackageElement | 4E20ED369B8146799C837C772C4D6B3A |
| 11 | PackageGroup | 209E08A7C4CB49F89EBCC45C9F78849D |
| 12 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 13 | PackageElement | 8519273D99C84EC690D0BADB6E33852D |
| 14 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 15 | PackageElement | CC811334F6934BABB6CEB90A5747CF0C |
| 16 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 17 | PackageElement | 25B1030AB07047D9B6A69E3B90465687 |
| 18 | PackageGroup | 435E7D8354E74FD1A842957664B19CDD |
| 19 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 20 | PackageElement | 0319BE8BC34E4506BEF656963209C1FA |
| 21 | PackageGroup | 9B5B8FE26AFD4DECAF98A174331F0AB7 |
| 22 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 23 | PackageElement | 494B804F7930478280616D136D69FCCE |
| 24 | PackageGroup | 9B5FF5DF1E1F45A38B20FA58FAB5EAF0 |
| 25 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 26 | PackageElement | A3C3FC954BA3499EAB77BAB10728EAF7 |
| 27 | PackageGroup | B7A0D06C91954D33941237DB76F9A6EE |
| 28 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 29 | PackageGroup | 9DCD9F4C7E5D43039C26E9FB90B7E2ED |
| 30 | PackageElement | 1C878A8A5BBE40BDAD15BF9E14B2B05E |
| 31 | PackageGroup | 90227C2535EA4AA492F1CB3A414C472E |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 3CEEC86E133947DB83374AC806A69E7B |
| 34 | PackageGroup | B0E22AA3E2874F71BE71857BAB1CBEF4 |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 7D0AC272BEEF4F9D881C7D0A79BD45CE |
| 37 | PackageGroup | D31ECA49FAD2405EA7BB361846EE7CC2 |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 3431E74C252244998F045F5D97CFF55F |
| 40 | PackageGroup | 10084226C6974F72A564168F23C8AE54 |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | E6291D240FEC4B99A3F399FE769D988F |
| 44 | PackageGroup | 38EF812AAC4F434C9E617F48DBF15F3F |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 0565D9C0248942D08E4DA533DD2F7937 |
| 47 | PackageGroup | D5798C6EA0F34A7DBD83B67CDA038782 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | 96C17741DB8C43EBB3004B3B27D8207D |
| 50 | PackageGroup | DDFB7EB0B952487B88F3D2936EC9D3E8 |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | A09DC2683A9B4396A9E8BC5ABC720951 |
| 53 | PackageGroup | 2CF6FB8327E840F6837904F7C0C57E85 |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 2B4D0CC89FE24C5A94250EEE3F1BC5BC |
| 56 | DatabaseUpgrade | 099A2644AAD04392A8D68FD12857BAC1 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s4-del --force`.
