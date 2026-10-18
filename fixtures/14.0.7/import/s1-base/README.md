# s1-base

One item per build.xsl bucket, fresh import. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1 (ticket 05).

## Exercises

build.xsl ordering of the first-group types, ItemTypes (non-polymorphic, then polymorphic), RelationshipTypes by dependencyLevel, the ItemType-follow-up View and Form deletes, and the per-type package registration. Item files are on disk in an order that differs from the import order.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BASE` | defaults | success (0) | 0 | 213 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 19900E05C71D4C85AAD6B06ACDFF33DD |
| 2 | PackageDefinition | F60CE020C1A0415E90943F74B85BC659 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 0B2D6DDA863F4C4CAB6F3738B282BC6B |
| 5 | PackageElement | 934A73BEC91E46BB964197848CEDB45A |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 21F0620AE0DF446E8AB1683890298CC8 |
| 8 | PackageElement | 8A866BB7E93E4BA8A2D95C910141607A |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 859F81D30DEC49E88282A869CF6DFB61 |
| 11 | PackageElement | 57A5EE67ED394474BEDBE13511F3B636 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 2F2C18F9F5314EB488E9D57527990D57 |
| 14 | PackageElement | 71CA563118FC4CD3B8F867C774142D29 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | B316EE4442574DE28328095B9B813C3C |
| 18 | PackageElement | 78319ED66C814A3B8951EEBB60783534 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 461866186C8244198374260B5DDFD7C8 |
| 21 | PackageElement | BDE22824605F4F4C9D944A9980963608 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 8AA4B488772E488D9CD394B0DBF88848 |
| 24 | PackageElement | 8C074DE51F954D90B0A0B9A24E7C8A50 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 4C78089DCA0A423ABCCFCD7F7A34495D |
| 27 | PackageElement | 3756571DCA5448B1B05F5C49785B52AA |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 59094FDBC96F4CEEB5487F3A1B1C034D |
| 30 | PackageElement | F08AB989DD8B42CA9D268C9FE65CCB73 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 9DFC18CA23A24F6A9D6AFE1B2D667414 |
| 33 | PackageElement | 3CD9068F88EA42B4BF051E8DE68B6366 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 837F8E4E73B0484EBA7F63AF187CCFFE |
| 36 | PackageElement | 83E3D50D930243F3AFF185FF97C2DAD3 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | C765DB676BAC41FA92AF47FAB057E69A |
| 39 | PackageElement | D66DBB8FF12B41099C3EC11439315483 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 32009C2E32364F3DBEF1F053E70A69B3 |
| 42 | PackageElement | CBEA67F53C6E4270B41D32177FD4FDDB |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | A884D4990EB3414CAFD135511FE1BAFD |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 5EF1EF5CCDCB4E31A87C8BC36C1DC0FC |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | F39617E2831C4C2CBDA561B459410B70 |
| 49 | PackageElement | 9F07E6473D98440884486C265DD24D82 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | C57E790F82EA44F3B5BDF7BE120103B0 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | A0EF461A954943F2B992C2231B639EEB |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 8EDF74433D474702A22C27579DF965E0 |
| 56 | PackageElement | 380AEA2128D4464D8FA18F1DD8C57337 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 380AEA2128D4464D8FA18F1DD8C57337 |
| 2 | PackageGroup | 8EDF74433D474702A22C27579DF965E0 |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | A0EF461A954943F2B992C2231B639EEB |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | C57E790F82EA44F3B5BDF7BE120103B0 |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | 9F07E6473D98440884486C265DD24D82 |
| 9 | PackageGroup | F39617E2831C4C2CBDA561B459410B70 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 5EF1EF5CCDCB4E31A87C8BC36C1DC0FC |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | A884D4990EB3414CAFD135511FE1BAFD |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | CBEA67F53C6E4270B41D32177FD4FDDB |
| 16 | PackageGroup | 32009C2E32364F3DBEF1F053E70A69B3 |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | D66DBB8FF12B41099C3EC11439315483 |
| 19 | PackageGroup | C765DB676BAC41FA92AF47FAB057E69A |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 83E3D50D930243F3AFF185FF97C2DAD3 |
| 22 | PackageGroup | 837F8E4E73B0484EBA7F63AF187CCFFE |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | 3CD9068F88EA42B4BF051E8DE68B6366 |
| 25 | PackageGroup | 9DFC18CA23A24F6A9D6AFE1B2D667414 |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | F08AB989DD8B42CA9D268C9FE65CCB73 |
| 28 | PackageGroup | 59094FDBC96F4CEEB5487F3A1B1C034D |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | 3756571DCA5448B1B05F5C49785B52AA |
| 31 | PackageGroup | 4C78089DCA0A423ABCCFCD7F7A34495D |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 8C074DE51F954D90B0A0B9A24E7C8A50 |
| 34 | PackageGroup | 8AA4B488772E488D9CD394B0DBF88848 |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | BDE22824605F4F4C9D944A9980963608 |
| 37 | PackageGroup | 461866186C8244198374260B5DDFD7C8 |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 78319ED66C814A3B8951EEBB60783534 |
| 40 | PackageGroup | B316EE4442574DE28328095B9B813C3C |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | 71CA563118FC4CD3B8F867C774142D29 |
| 44 | PackageGroup | 2F2C18F9F5314EB488E9D57527990D57 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 57A5EE67ED394474BEDBE13511F3B636 |
| 47 | PackageGroup | 859F81D30DEC49E88282A869CF6DFB61 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | 8A866BB7E93E4BA8A2D95C910141607A |
| 50 | PackageGroup | 21F0620AE0DF446E8AB1683890298CC8 |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 934A73BEC91E46BB964197848CEDB45A |
| 53 | PackageGroup | 0B2D6DDA863F4C4CAB6F3738B282BC6B |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | F60CE020C1A0415E90943F74B85BC659 |
| 56 | DatabaseUpgrade | 19900E05C71D4C85AAD6B06ACDFF33DD |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s1-base --force`.
