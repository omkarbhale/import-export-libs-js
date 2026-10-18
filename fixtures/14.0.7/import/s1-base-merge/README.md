# s1-base-merge

S1 with merge on, when nothing exists yet. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, merge on (ticket 05).

## Exercises

Merge mode over the whole document: SetItemIdToLastGeneration for the versionable types and the idlist get per type, none found.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 246 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | DBC327407D344E6D96071D99EA8C073D |
| 2 | PackageDefinition | 365C6652A91644DEA150483C04B88BB2 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | F05FDF4745914C349746502E49E8266D |
| 5 | PackageElement | B836EA694A1C4577B811F01230CEDB67 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 69EFDE322004412FA64E9A3573A8A5ED |
| 8 | PackageElement | 429E3640CD9C44A1BD60A353AB8D3977 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 1157C044FCA4484D8803CFE8A7F33F6F |
| 11 | PackageElement | 2C760F718BBB4D198DCEF60FAAFCA0DF |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | E8F1CDE8B56A4EF79B069C5D338FEFA0 |
| 14 | PackageElement | EED4FD079AEA4C36B3A5E2A7A04951E2 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | EDCA033355CA42E5BE39F701A411C434 |
| 18 | PackageElement | EE52D40AFA0F41B3A88A6D1BB4BDF214 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 585B904E146C4A439E592C1013CFD845 |
| 21 | PackageElement | 027F5F23BA7E4D2F942D224E76D0FC8E |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | D47222DEEF2E44569F9379C3EB84F9E5 |
| 24 | PackageElement | 711319F4AC3749448AB324BEE8AE1269 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 2BFC3E02F82C4FF2A5B77D00688CF74C |
| 27 | PackageElement | BCDCB7061032483DA87BF7AFA2F44352 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 3F02E0F52EE04CFFB6B97B93E280278C |
| 30 | PackageElement | EB93ED6EAFAF4F9EBFA7E2760DBF7199 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 6691B94F42D04607A5CCE4AC72121926 |
| 33 | PackageElement | 4601A861431447C8B62BAB7A1EDEA56B |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | F957E38E8F9041F9BF1C7A0C45D138EF |
| 36 | PackageElement | 9B09E107176B489787A4555A95E47A50 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | D15B220C8E714D84B973111172BBDEA8 |
| 39 | PackageElement | 87AEEE7BD0BA417F97B53BC1D0636F62 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | FE21F26A458F446D9AFD4EB4C816A80E |
| 42 | PackageElement | 497B6798D9A44B838F72F38A233B719D |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 41AA1CA5B1B24D0198670C7F7C954D04 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 423214B4300D4F3E84B6AA434CD0110F |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | F275AF7B65F9489F845BB694546BF688 |
| 49 | PackageElement | E8A8BCD59DD04373AC518CA7C9DD3111 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | CF3D7FD28AA14BBE9F25CCC24C1C112A |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 1EC77A33B1274C3CA0DD658A5E317DEE |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | E3B777F04D2B4F1F970A846613D0A478 |
| 56 | PackageElement | 1955FC60B9EB447A89E2E87CC1849BB0 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 1955FC60B9EB447A89E2E87CC1849BB0 |
| 2 | PackageGroup | E3B777F04D2B4F1F970A846613D0A478 |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | 1EC77A33B1274C3CA0DD658A5E317DEE |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | CF3D7FD28AA14BBE9F25CCC24C1C112A |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | E8A8BCD59DD04373AC518CA7C9DD3111 |
| 9 | PackageGroup | F275AF7B65F9489F845BB694546BF688 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 423214B4300D4F3E84B6AA434CD0110F |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | 41AA1CA5B1B24D0198670C7F7C954D04 |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | 497B6798D9A44B838F72F38A233B719D |
| 16 | PackageGroup | FE21F26A458F446D9AFD4EB4C816A80E |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | 87AEEE7BD0BA417F97B53BC1D0636F62 |
| 19 | PackageGroup | D15B220C8E714D84B973111172BBDEA8 |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 9B09E107176B489787A4555A95E47A50 |
| 22 | PackageGroup | F957E38E8F9041F9BF1C7A0C45D138EF |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | 4601A861431447C8B62BAB7A1EDEA56B |
| 25 | PackageGroup | 6691B94F42D04607A5CCE4AC72121926 |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | EB93ED6EAFAF4F9EBFA7E2760DBF7199 |
| 28 | PackageGroup | 3F02E0F52EE04CFFB6B97B93E280278C |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | BCDCB7061032483DA87BF7AFA2F44352 |
| 31 | PackageGroup | 2BFC3E02F82C4FF2A5B77D00688CF74C |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 711319F4AC3749448AB324BEE8AE1269 |
| 34 | PackageGroup | D47222DEEF2E44569F9379C3EB84F9E5 |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 027F5F23BA7E4D2F942D224E76D0FC8E |
| 37 | PackageGroup | 585B904E146C4A439E592C1013CFD845 |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | EE52D40AFA0F41B3A88A6D1BB4BDF214 |
| 40 | PackageGroup | EDCA033355CA42E5BE39F701A411C434 |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | EED4FD079AEA4C36B3A5E2A7A04951E2 |
| 44 | PackageGroup | E8F1CDE8B56A4EF79B069C5D338FEFA0 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 2C760F718BBB4D198DCEF60FAAFCA0DF |
| 47 | PackageGroup | 1157C044FCA4484D8803CFE8A7F33F6F |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | 429E3640CD9C44A1BD60A353AB8D3977 |
| 50 | PackageGroup | 69EFDE322004412FA64E9A3573A8A5ED |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | B836EA694A1C4577B811F01230CEDB67 |
| 53 | PackageGroup | F05FDF4745914C349746502E49E8266D |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 365C6652A91644DEA150483C04B88BB2 |
| 56 | DatabaseUpgrade | DBC327407D344E6D96071D99EA8C073D |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s1-base-merge --force`.
