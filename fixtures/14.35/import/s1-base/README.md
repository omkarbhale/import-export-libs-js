# s1-base

One item per build.xsl bucket, fresh import. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1 (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | D644BB0BEA1B48F6908D3A31771619F9 |
| 2 | PackageDefinition | 39B58B21B6D44B90A034B7F21C6EFFA0 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 0E8D1791659544E88BDB501D538DAA6A |
| 5 | PackageElement | 3D57EC0FFA1D4FE0B39D99BD5BC29EB7 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 3C6A5FD795E045FABB0B9C6C7AF1DEBE |
| 8 | PackageElement | 6110330E5C6D473CAE285BD2BC93C292 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 0762371C1D9340DE89C5D256EB7E5203 |
| 11 | PackageElement | 6FF6851EE91247689E0D8C0CC665E7DC |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | D3AE057751254AEF85275FC71A58AF85 |
| 14 | PackageElement | D3FA1298EA1A42D685547A3683C929FB |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 9A091FD7018E49928E5D62F64D751D66 |
| 18 | PackageElement | E873E6EC78AD42C3952050344EA6822C |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | FD6B01D52E68449082CF40DB5CA9CA5E |
| 21 | PackageElement | 9F1B7DDC83B94566906B630FA5AA516A |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 3E7881A0FCA747DF80AFBEBAF19E57B2 |
| 24 | PackageElement | 9C207AC794D04D6A9848BC2324F794EB |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | E359D06454CD4A4E937F4D9FFAD980A7 |
| 27 | PackageElement | BED2604F801D4833B073F37343685D16 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | C3C063AE35B14BF9B25EF65E670A08CC |
| 30 | PackageElement | F0C013B8583242218062D06DEA7DBFB8 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 13153500D8FB462F9E8D0FFC241CB072 |
| 33 | PackageElement | FA4E37E58C874FC2BC16FBCEB39375D5 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | A00D6F7180E24983871368013A04B8F6 |
| 36 | PackageElement | 9C8CAE2585014816958E0E5E2A0F2477 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 0D2B42CF57834CDA8FB5B16DEB92289D |
| 39 | PackageElement | A6CE413866F54DDF9ADB6ADC9EDEA774 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 83C675FB14794B40BD1D0D94F08A3342 |
| 42 | PackageElement | 2CC8D59FA0E14DA8B6C3DB12705A8C27 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | FEC6D7AB735341EDA87E6A95E9CAE210 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 1D33124D66334B3DB19E4E686A4D2290 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 272C0A5F76E5478BB854B5C40D41B126 |
| 49 | PackageElement | 68BB1A816D564208A419A683E4587DD7 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | D7DFAABD51494D7883013504CA381795 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | B1BC2994EF0445A3BDA442E657E2E377 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 9148E230320148018225401E7D64F2A9 |
| 56 | PackageElement | A2FE2A837EED4A1BB5788C0FE4E7B623 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | A2FE2A837EED4A1BB5788C0FE4E7B623 |
| 2 | PackageGroup | 9148E230320148018225401E7D64F2A9 |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | B1BC2994EF0445A3BDA442E657E2E377 |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | D7DFAABD51494D7883013504CA381795 |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | 68BB1A816D564208A419A683E4587DD7 |
| 9 | PackageGroup | 272C0A5F76E5478BB854B5C40D41B126 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 1D33124D66334B3DB19E4E686A4D2290 |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | FEC6D7AB735341EDA87E6A95E9CAE210 |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | 2CC8D59FA0E14DA8B6C3DB12705A8C27 |
| 16 | PackageGroup | 83C675FB14794B40BD1D0D94F08A3342 |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | A6CE413866F54DDF9ADB6ADC9EDEA774 |
| 19 | PackageGroup | 0D2B42CF57834CDA8FB5B16DEB92289D |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 9C8CAE2585014816958E0E5E2A0F2477 |
| 22 | PackageGroup | A00D6F7180E24983871368013A04B8F6 |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | FA4E37E58C874FC2BC16FBCEB39375D5 |
| 25 | PackageGroup | 13153500D8FB462F9E8D0FFC241CB072 |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | F0C013B8583242218062D06DEA7DBFB8 |
| 28 | PackageGroup | C3C063AE35B14BF9B25EF65E670A08CC |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | BED2604F801D4833B073F37343685D16 |
| 31 | PackageGroup | E359D06454CD4A4E937F4D9FFAD980A7 |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 9C207AC794D04D6A9848BC2324F794EB |
| 34 | PackageGroup | 3E7881A0FCA747DF80AFBEBAF19E57B2 |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 9F1B7DDC83B94566906B630FA5AA516A |
| 37 | PackageGroup | FD6B01D52E68449082CF40DB5CA9CA5E |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | E873E6EC78AD42C3952050344EA6822C |
| 40 | PackageGroup | 9A091FD7018E49928E5D62F64D751D66 |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | D3FA1298EA1A42D685547A3683C929FB |
| 44 | PackageGroup | D3AE057751254AEF85275FC71A58AF85 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 6FF6851EE91247689E0D8C0CC665E7DC |
| 47 | PackageGroup | 0762371C1D9340DE89C5D256EB7E5203 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | 6110330E5C6D473CAE285BD2BC93C292 |
| 50 | PackageGroup | 3C6A5FD795E045FABB0B9C6C7AF1DEBE |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 3D57EC0FFA1D4FE0B39D99BD5BC29EB7 |
| 53 | PackageGroup | 0E8D1791659544E88BDB501D538DAA6A |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 39B58B21B6D44B90A034B7F21C6EFFA0 |
| 56 | DatabaseUpgrade | D644BB0BEA1B48F6908D3A31771619F9 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s1-base --force`.
