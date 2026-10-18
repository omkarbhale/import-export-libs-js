# s1-base-merge

S1 with merge on, when nothing exists yet. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, merge on (ticket 05).

## Exercises

Merge mode over the whole document: SetItemIdToLastGeneration for the versionable types and the idlist get per type, none found.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 245 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 212B1C5AF55F49E7AC9B9F6F6DC9C725 |
| 2 | PackageDefinition | 884159081A1644CF99ADCBCEC3728D7C |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | AFDC38A944A04D96AA751CD2903A5149 |
| 5 | PackageElement | 41B634EDD6014B9AA546C40BF7C502C0 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 34F59F550C7D42A5B45A7313393C814D |
| 8 | PackageElement | BDF22BF5A96A4051B73E401DF1CAEE80 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 0172EFCAE90E4F1C8D634E80305B1C57 |
| 11 | PackageElement | 2F19C441ED9240E5ABA88B3585F5DBAB |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 3A5829285B52431CA4A89C3FB5120421 |
| 14 | PackageElement | 3E783F8C0B33407FBACAE5AF79033333 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 644C650589BE489FB2A842A2AAF8F556 |
| 18 | PackageElement | C7F68F8CE565408DB4325B73824F959F |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 2027972915B3438287A89391AA2913C3 |
| 21 | PackageElement | E5AEE00E43814B13BED62CB65EA30EB7 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | A8E021B21E4C499D9E3B40E18449CC2A |
| 24 | PackageElement | A435500F17A245E1A948189F93D01B2D |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | E3C666236B904156997EFACF8A75CFA1 |
| 27 | PackageElement | 9686D041D7C54D34A247499AB8F087B9 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 0CA5DBEA31DB4C958B31D994D437DDE9 |
| 30 | PackageElement | C8B22AEE13254765BAE628EDB367050F |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | E568D1DA45734A2E9840C8E4391EA63A |
| 33 | PackageElement | A2FA0AD4AB8644B0A63897895A5F4893 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 41A53FD495074DFD87F403D70FC704E2 |
| 36 | PackageElement | 81C8FEE94EAD46918D411BB0DDC017A3 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | E0A7F60A66084073AE885F1F1EEBF1E6 |
| 39 | PackageElement | 270BC1B3DFA7400DBBDF9BBEDC0DBBC8 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 250ADB9494C34535ABFE1AFD7883E314 |
| 42 | PackageElement | 7BC2BF8A474E41E7BE9B97CE4DAE0622 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | F1E27AF4606744D896F89114B56CC582 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 4EB93539D2CE4344A081D522B40FBED0 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 48E21233D8444590AC496A846F520616 |
| 49 | PackageElement | CF7A78A9451142B19E48FF4BD186E70C |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | A2515BA46CE047619ABF41158DF95580 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 1125C3AC34894147A21CFC515F445317 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 75A1C9EBD20A4F6FA7CF7EF54A0A0116 |
| 56 | PackageElement | 328B487813F649B7B80E092665BF6E32 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 328B487813F649B7B80E092665BF6E32 |
| 2 | PackageGroup | 75A1C9EBD20A4F6FA7CF7EF54A0A0116 |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | 1125C3AC34894147A21CFC515F445317 |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | A2515BA46CE047619ABF41158DF95580 |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | CF7A78A9451142B19E48FF4BD186E70C |
| 9 | PackageGroup | 48E21233D8444590AC496A846F520616 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 4EB93539D2CE4344A081D522B40FBED0 |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | F1E27AF4606744D896F89114B56CC582 |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | 7BC2BF8A474E41E7BE9B97CE4DAE0622 |
| 16 | PackageGroup | 250ADB9494C34535ABFE1AFD7883E314 |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | 270BC1B3DFA7400DBBDF9BBEDC0DBBC8 |
| 19 | PackageGroup | E0A7F60A66084073AE885F1F1EEBF1E6 |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 81C8FEE94EAD46918D411BB0DDC017A3 |
| 22 | PackageGroup | 41A53FD495074DFD87F403D70FC704E2 |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | A2FA0AD4AB8644B0A63897895A5F4893 |
| 25 | PackageGroup | E568D1DA45734A2E9840C8E4391EA63A |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | C8B22AEE13254765BAE628EDB367050F |
| 28 | PackageGroup | 0CA5DBEA31DB4C958B31D994D437DDE9 |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | 9686D041D7C54D34A247499AB8F087B9 |
| 31 | PackageGroup | E3C666236B904156997EFACF8A75CFA1 |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | A435500F17A245E1A948189F93D01B2D |
| 34 | PackageGroup | A8E021B21E4C499D9E3B40E18449CC2A |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | E5AEE00E43814B13BED62CB65EA30EB7 |
| 37 | PackageGroup | 2027972915B3438287A89391AA2913C3 |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | C7F68F8CE565408DB4325B73824F959F |
| 40 | PackageGroup | 644C650589BE489FB2A842A2AAF8F556 |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | 3E783F8C0B33407FBACAE5AF79033333 |
| 44 | PackageGroup | 3A5829285B52431CA4A89C3FB5120421 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 2F19C441ED9240E5ABA88B3585F5DBAB |
| 47 | PackageGroup | 0172EFCAE90E4F1C8D634E80305B1C57 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | BDF22BF5A96A4051B73E401DF1CAEE80 |
| 50 | PackageGroup | 34F59F550C7D42A5B45A7313393C814D |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 41B634EDD6014B9AA546C40BF7C502C0 |
| 53 | PackageGroup | AFDC38A944A04D96AA751CD2903A5149 |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 884159081A1644CF99ADCBCEC3728D7C |
| 56 | DatabaseUpgrade | 212B1C5AF55F49E7AC9B9F6F6DC9C725 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s1-base-merge --force`.
