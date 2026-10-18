# s1-base-merge

S1 with merge on, when nothing exists yet. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, merge on (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 224552DFB1B249F3A21EA980C94797BD |
| 2 | PackageDefinition | 03DC86CD045B4FDC94E815F5C3AC3850 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 7C8C1535559941D3AC980985569F149D |
| 5 | PackageElement | 72D88084FE7A4715A64E26CDB5A4B90C |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 1CA220EAF2A249D69576CE62A81E3FF9 |
| 8 | PackageElement | 4793B85F37AD4BD585CFBA42A3A718AA |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | AC15914E7CF744BEB2F427625146B2A5 |
| 11 | PackageElement | 2C41AE9E472F4C0DA1D6DCA53DAA6C89 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | BBA7033A880B49E8B939D7A7117ACD8A |
| 14 | PackageElement | 9523F8AC8790479EABA84B5AFB74BF1A |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 4E764AD5C0A245FFA1B597D0CF51C782 |
| 18 | PackageElement | 8E6A3A26DD594D1D95458FFE972829B2 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 3D672645CED24604870A954F6464CD3E |
| 21 | PackageElement | 7426FECDF417463BAFC33C6C901DB93C |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | A4A9571EBA03464F8B0E639EDB974A7B |
| 24 | PackageElement | 6C478249CF354ADA90AA88F2F0F2742D |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 65D2F9976C034B17AC376C9E8835ED02 |
| 27 | PackageElement | BDE6C2D9C12643CA8AB68FD7B19AB408 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 2CC1A7D65B6141F5A719B4613497BD30 |
| 30 | PackageElement | E3D1C8F6288F42C0B487FA9C856E7A98 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 55AD2F6B62A640FBAECCD45FBEF0E70D |
| 33 | PackageElement | 6A79853023794D668F48E686F2F16DF1 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | A2F9B8B07FF34681B71278CE3991CABF |
| 36 | PackageElement | BAC8FE63A76F48898B196B56237E1594 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 522F0225504C485AAA9F431CFA2BB7CA |
| 39 | PackageElement | 4F7075DE7F3F4C03A0A6B0B0B7D019C7 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | DA8403604F644800AED5E408193B21CE |
| 42 | PackageElement | ADDDBABDA93344268EBBE33F90FC1B23 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | AC6C264E5C89459681D09AF3C6ADBB9D |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | A3A310170A09493EBB3063ABCAFA47EC |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | B449A6C93B4745639002B3E9EAADD630 |
| 49 | PackageElement | CC4353851B6F4DC3BFBDEAA8D21B161A |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | C5961882B4A045199EC13DB7A7693AC0 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | EB631BA0B6924D70A7276358160B3D06 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | B167B289845F419786FFC6CD0ACDB4EC |
| 56 | PackageElement | C05AB165659C4CE0B6968E2BC6361E1B |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | C05AB165659C4CE0B6968E2BC6361E1B |
| 2 | PackageGroup | B167B289845F419786FFC6CD0ACDB4EC |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | EB631BA0B6924D70A7276358160B3D06 |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | C5961882B4A045199EC13DB7A7693AC0 |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | CC4353851B6F4DC3BFBDEAA8D21B161A |
| 9 | PackageGroup | B449A6C93B4745639002B3E9EAADD630 |
| 10 | PackageElement | A3A310170A09493EBB3063ABCAFA47EC |
| 11 | PackageElement | AC6C264E5C89459681D09AF3C6ADBB9D |
| 12 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 13 | PackageElement | ADDDBABDA93344268EBBE33F90FC1B23 |
| 14 | PackageGroup | DA8403604F644800AED5E408193B21CE |
| 15 | PackageElement | 4F7075DE7F3F4C03A0A6B0B0B7D019C7 |
| 16 | PackageGroup | 522F0225504C485AAA9F431CFA2BB7CA |
| 17 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 18 | PackageElement | BAC8FE63A76F48898B196B56237E1594 |
| 19 | PackageGroup | A2F9B8B07FF34681B71278CE3991CABF |
| 20 | PackageElement | 6A79853023794D668F48E686F2F16DF1 |
| 21 | PackageGroup | 55AD2F6B62A640FBAECCD45FBEF0E70D |
| 22 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 23 | PackageElement | E3D1C8F6288F42C0B487FA9C856E7A98 |
| 24 | PackageGroup | 2CC1A7D65B6141F5A719B4613497BD30 |
| 25 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 26 | PackageElement | BDE6C2D9C12643CA8AB68FD7B19AB408 |
| 27 | PackageGroup | 65D2F9976C034B17AC376C9E8835ED02 |
| 28 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 29 | PackageElement | 6C478249CF354ADA90AA88F2F0F2742D |
| 30 | PackageGroup | A4A9571EBA03464F8B0E639EDB974A7B |
| 31 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 32 | PackageElement | 7426FECDF417463BAFC33C6C901DB93C |
| 33 | PackageGroup | 3D672645CED24604870A954F6464CD3E |
| 34 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 35 | PackageElement | 8E6A3A26DD594D1D95458FFE972829B2 |
| 36 | PackageGroup | 4E764AD5C0A245FFA1B597D0CF51C782 |
| 37 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 38 | PackageElement | 9523F8AC8790479EABA84B5AFB74BF1A |
| 39 | PackageGroup | BBA7033A880B49E8B939D7A7117ACD8A |
| 40 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 41 | PackageElement | 2C41AE9E472F4C0DA1D6DCA53DAA6C89 |
| 42 | PackageGroup | AC15914E7CF744BEB2F427625146B2A5 |
| 43 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 44 | PackageElement | 4793B85F37AD4BD585CFBA42A3A718AA |
| 45 | PackageGroup | 1CA220EAF2A249D69576CE62A81E3FF9 |
| 46 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 47 | PackageElement | 72D88084FE7A4715A64E26CDB5A4B90C |
| 48 | PackageGroup | 7C8C1535559941D3AC980985569F149D |
| 49 | PackageDefinition | 03DC86CD045B4FDC94E815F5C3AC3850 |
| 50 | DatabaseUpgrade | 224552DFB1B249F3A21EA980C94797BD |
| 51 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 52 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 53 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 54 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 55 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 56 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s1-base-merge --force`.
