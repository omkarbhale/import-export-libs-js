# s1-instances-versionable

Instances of a versionable ItemType with a relationship, re-imported. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, ProcessVersionableItem (ticket 05).

## Exercises

ProcessVersionableItem: a versionable root with a relationship that has a related_id is matched by source and related id (ExistRelItemInCurVer) and becomes an edit with a `where`, or an add. The last step gives the root a second generation first, so the root and its relationship's source_id move to the current generation.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | ItemTypes | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 246 |
| 2 | instances, fresh | `LIBSJS-SCRATCH-INST` | defaults | success (0) | 0 | 39 |
| 3 | instances, merge on | `LIBSJS-SCRATCH-INST` | merge=true | success (0) | 0 | 39 |
| 4 | instances, merge on, after versioning the root | `LIBSJS-SCRATCH-INST` | merge=true, versionBefore=[{"type":"LIBSJS_SCRATCH_IT_V","id":"CFC67070B8926819B48BC0B108536FF2"}] | success (0) | 0 | 41 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 94CE465FAF7B427BA6D91DD92B46C211 |
| 2 | PackageDefinition | ECE6B6DBCE2140C297D77E523BEAF8C8 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 08324A0C66A74F00A61DA6D523B937C6 |
| 5 | PackageElement | 0FD28D4DBAC74F3A8FD61C3274D52F84 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 9B5E6EE8400E488296D3D3DFAE722CC9 |
| 8 | PackageElement | 6880CFF612A147588E74212630AB2F2A |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | F06FD5209AA84058A80BF2C5EEDF46F6 |
| 11 | PackageElement | 514FFB4BA3404F0B83039DB39FFE6123 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 4D2415B27FB84FDD95EC57B6FC751A6F |
| 14 | PackageElement | C629A17E4B2F46BB9A6EE65D84AA4E47 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | B713644A0B43403DA8C6A8A87C41024D |
| 18 | PackageElement | 72B0FC95876C405E96B6923DF75B8ECF |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | D1713E376268458E82BEEA3B63D7B79C |
| 21 | PackageElement | 20386E6810A5459CB7ACC875FFC5DA56 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 88D8AF0AC1184DB9834F1A67E52A5313 |
| 24 | PackageElement | 4834B5943E9C485FBA1152FF33D11BD8 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 8F27D49A8E8941E9A2302425193B57B3 |
| 27 | PackageElement | E4B2779EAB814D5AAF7F4AAD7C54C677 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | F517BEC0C0174196B822D16F1123BFDF |
| 30 | PackageElement | 9D85BC53C14849B0830083643910F8D2 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 94D81F66A57A470D88186E2F349C1D21 |
| 33 | PackageElement | 1E60B88D11FA4A8FA42D25E12613ACD3 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 4985D945280A4E708D912FB640752E3F |
| 36 | PackageElement | 7EBF1CEF83A84C1DB7D46F02C8CE279D |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 8F44A7EACB094137A2AA424261F2B2F9 |
| 39 | PackageElement | A2E4121BCDB44DD1A8164ADC86AD6B7F |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 1F02C4D60B6C4D2AB391C0872E6A597D |
| 42 | PackageElement | CA056B3205D74567877D7CBE5E14C97D |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 50B286B347A04F01B0B1F63B4D07B1CC |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | FF54BAD6EE1F4D2F8158D106AB2592A7 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 4F082611D09D400BA9651462688E7A12 |
| 49 | PackageElement | 83A8C4BCBA504FBBB78603F3E59FF023 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | A0F3CC40821E4F1FA89EA46F3AE9445D |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 6FD93424DFF64D28BD72D7C820D58862 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 8BFCF1BBC41F4F19A7ADC954EF2C7D85 |
| 56 | PackageElement | 5C77B254801B42CDAF9FB6D443DCF2B4 |

### Step 2: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 1C2616B2FC28444F846E1BC9E190C5BE |
| 2 | PackageDefinition | 0F0589A9A8EA4E62A31302274AC3F052 |
| 3 | LIBSJS_SCRATCH_IT_A | 4747CF811D4EFD42FA073ACA3A1BF1BE |
| 4 | PackageGroup | CD52A771694C417FA1994374B86FA81B |
| 5 | PackageElement | AA8BA1D72FD849CFA5A7DC731BFC385A |
| 6 | LIBSJS_SCRATCH_IT_V | CFC67070B8926819B48BC0B108536FF2 |
| 7 | PackageGroup | 454B3DD1BD2F4F2C92DFBDF687C1A90B |
| 8 | PackageElement | 58DBEFF06CD342B7A84886A8E36D506F |

### Step 3: created 0

None.

### Step 4: created 1

| # | Type | Id |
|---|---|---|
| 1 | LIBSJS_SCRATCH_IT_V | C26E59178E7042D0BAACA2D519045AA5 |

### Deleted by the cleanup: 63

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | LIBSJS_SCRATCH_IT_V | C26E59178E7042D0BAACA2D519045AA5 |
| 2 | PackageGroup | 454B3DD1BD2F4F2C92DFBDF687C1A90B |
| 3 | PackageElement | AA8BA1D72FD849CFA5A7DC731BFC385A |
| 4 | PackageGroup | CD52A771694C417FA1994374B86FA81B |
| 5 | LIBSJS_SCRATCH_IT_A | 4747CF811D4EFD42FA073ACA3A1BF1BE |
| 6 | PackageDefinition | 0F0589A9A8EA4E62A31302274AC3F052 |
| 7 | DatabaseUpgrade | 1C2616B2FC28444F846E1BC9E190C5BE |
| 8 | PackageElement | 5C77B254801B42CDAF9FB6D443DCF2B4 |
| 9 | PackageGroup | 8BFCF1BBC41F4F19A7ADC954EF2C7D85 |
| 10 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 11 | PackageElement | 6FD93424DFF64D28BD72D7C820D58862 |
| 12 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 13 | PackageElement | A0F3CC40821E4F1FA89EA46F3AE9445D |
| 14 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 15 | PackageElement | 83A8C4BCBA504FBBB78603F3E59FF023 |
| 16 | PackageGroup | 4F082611D09D400BA9651462688E7A12 |
| 17 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 18 | PackageElement | FF54BAD6EE1F4D2F8158D106AB2592A7 |
| 19 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 20 | PackageElement | 50B286B347A04F01B0B1F63B4D07B1CC |
| 21 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 22 | PackageElement | CA056B3205D74567877D7CBE5E14C97D |
| 23 | PackageGroup | 1F02C4D60B6C4D2AB391C0872E6A597D |
| 24 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 25 | PackageElement | A2E4121BCDB44DD1A8164ADC86AD6B7F |
| 26 | PackageGroup | 8F44A7EACB094137A2AA424261F2B2F9 |
| 27 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 28 | PackageElement | 7EBF1CEF83A84C1DB7D46F02C8CE279D |
| 29 | PackageGroup | 4985D945280A4E708D912FB640752E3F |
| 30 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 31 | PackageElement | 1E60B88D11FA4A8FA42D25E12613ACD3 |
| 32 | PackageGroup | 94D81F66A57A470D88186E2F349C1D21 |
| 33 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 34 | PackageElement | 9D85BC53C14849B0830083643910F8D2 |
| 35 | PackageGroup | F517BEC0C0174196B822D16F1123BFDF |
| 36 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 37 | PackageElement | E4B2779EAB814D5AAF7F4AAD7C54C677 |
| 38 | PackageGroup | 8F27D49A8E8941E9A2302425193B57B3 |
| 39 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 40 | PackageElement | 4834B5943E9C485FBA1152FF33D11BD8 |
| 41 | PackageGroup | 88D8AF0AC1184DB9834F1A67E52A5313 |
| 42 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 43 | PackageElement | 20386E6810A5459CB7ACC875FFC5DA56 |
| 44 | PackageGroup | D1713E376268458E82BEEA3B63D7B79C |
| 45 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 46 | PackageElement | 72B0FC95876C405E96B6923DF75B8ECF |
| 47 | PackageGroup | B713644A0B43403DA8C6A8A87C41024D |
| 48 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 49 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 50 | PackageElement | C629A17E4B2F46BB9A6EE65D84AA4E47 |
| 51 | PackageGroup | 4D2415B27FB84FDD95EC57B6FC751A6F |
| 52 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 53 | PackageElement | 514FFB4BA3404F0B83039DB39FFE6123 |
| 54 | PackageGroup | F06FD5209AA84058A80BF2C5EEDF46F6 |
| 55 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 56 | PackageElement | 6880CFF612A147588E74212630AB2F2A |
| 57 | PackageGroup | 9B5E6EE8400E488296D3D3DFAE722CC9 |
| 58 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 59 | PackageElement | 0FD28D4DBAC74F3A8FD61C3274D52F84 |
| 60 | PackageGroup | 08324A0C66A74F00A61DA6D523B937C6 |
| 61 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 62 | PackageDefinition | ECE6B6DBCE2140C297D77E523BEAF8C8 |
| 63 | DatabaseUpgrade | 94CE465FAF7B427BA6D91DD92B46C211 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s1-instances-versionable --force`.
