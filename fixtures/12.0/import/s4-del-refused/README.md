# s4-del-refused

A delete the server refuses. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4 (ticket 05).

## Exercises

The delete-only retry path: a delete is imported without the full reference check, so when its apply fails the engine warns, runs the full check and applies it again, and the second failure ends the package.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import BASE | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 245 |
| 2 | import DELREFUSED | `LIBSJS-SCRATCH-DELREFUSED` | merge=true | engine failure (1) | 1 | 18 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 7953BDAB63E744829FD8BD5C3D521951 |
| 2 | PackageDefinition | 757D506BD2F34231907C31CE4B9B7A1C |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 79F6A379FE904454B3CDADF08FEF61EE |
| 5 | PackageElement | F1364F3DA20243908E90141A8FE84F8F |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | D61C5B4789D84769B54F8387BA5C2394 |
| 8 | PackageElement | A5900F7E38364DC1967408531E6E0195 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 851A420AC30E40E2A32CE6B8A617692B |
| 11 | PackageElement | 99C54B2900944356AD94DD0414B05CA1 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | B397984A76AB4757B433DDC1475B1086 |
| 14 | PackageElement | BD922B6DDB524837917EFF9407A3F5E4 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 89590D5DBF844C5AA4FD566A77F7157A |
| 18 | PackageElement | 2E37D11D7EFD4B13A6DBDD6D746A2B90 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | BDC259A8C9654AE38B290165BE3594DC |
| 21 | PackageElement | 5D165EFAECFC4E2EB0AFDB829C575310 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | B5A7B9B3A03347369234FDE029018136 |
| 24 | PackageElement | 6803FE74DD534A089D68EA29CCD6017F |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 434560C07EED4FEBA34CDB53E35C1AAE |
| 27 | PackageElement | 79A48A23A12046B7852B107C9D58D3F3 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | DFC5F9330D6645259D148D0D4EAC5C18 |
| 30 | PackageElement | 41F39ACB9ADB4C6A8A5F85D131C99A0E |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | EFE6CBD85C4B4D0791C7CA9A0EE31DB2 |
| 33 | PackageElement | C28F9875BA0647BDA03908388C776164 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | F5635DE38F2944BD8CE9D19D3211BD02 |
| 36 | PackageElement | 441BA48CA22249D8BE8FF6256FE93695 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 4DA4B5B5BA74426491CA64C8B79C2EBC |
| 39 | PackageElement | 8151592D90CB45B1B149073ADE549B7B |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | F0BD06B870AC42498B5737550F2B7F5A |
| 42 | PackageElement | 96828520A4E24DDBAD66AEC20720BF27 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 7777CE1FD46F44EAAD80C8BF6EA42EC3 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 3F46449BFA2B41A6A6EAE13F7EDAC8FA |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | FBE50B1760884B0199D53C463DE81945 |
| 49 | PackageElement | 714D9EB3493944749EA89734A60501E2 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | B02056BC8EC841A28D5B3C2F86E3ED84 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 4FA0C364D1D14624B54EB73C83DC8331 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | CFD71FD1C2674E11BFECBD8C3B667E99 |
| 56 | PackageElement | C4D65A56C63A4A0E8F5037F97A4CB03D |

### Step 2: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 924B2EF7E6614CB494CB9AFF32255AB4 |
| 2 | PackageDefinition | E0009F7CBA644A1F913478DC92E5A6E1 |

### Deleted by the cleanup: 58

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | E0009F7CBA644A1F913478DC92E5A6E1 |
| 2 | DatabaseUpgrade | 924B2EF7E6614CB494CB9AFF32255AB4 |
| 3 | PackageElement | C4D65A56C63A4A0E8F5037F97A4CB03D |
| 4 | PackageGroup | CFD71FD1C2674E11BFECBD8C3B667E99 |
| 5 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 6 | PackageElement | 4FA0C364D1D14624B54EB73C83DC8331 |
| 7 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 8 | PackageElement | B02056BC8EC841A28D5B3C2F86E3ED84 |
| 9 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 10 | PackageElement | 714D9EB3493944749EA89734A60501E2 |
| 11 | PackageGroup | FBE50B1760884B0199D53C463DE81945 |
| 12 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 13 | PackageElement | 3F46449BFA2B41A6A6EAE13F7EDAC8FA |
| 14 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 15 | PackageElement | 7777CE1FD46F44EAAD80C8BF6EA42EC3 |
| 16 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 17 | PackageElement | 96828520A4E24DDBAD66AEC20720BF27 |
| 18 | PackageGroup | F0BD06B870AC42498B5737550F2B7F5A |
| 19 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 20 | PackageElement | 8151592D90CB45B1B149073ADE549B7B |
| 21 | PackageGroup | 4DA4B5B5BA74426491CA64C8B79C2EBC |
| 22 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 23 | PackageElement | 441BA48CA22249D8BE8FF6256FE93695 |
| 24 | PackageGroup | F5635DE38F2944BD8CE9D19D3211BD02 |
| 25 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 26 | PackageElement | C28F9875BA0647BDA03908388C776164 |
| 27 | PackageGroup | EFE6CBD85C4B4D0791C7CA9A0EE31DB2 |
| 28 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 29 | PackageElement | 41F39ACB9ADB4C6A8A5F85D131C99A0E |
| 30 | PackageGroup | DFC5F9330D6645259D148D0D4EAC5C18 |
| 31 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 32 | PackageElement | 79A48A23A12046B7852B107C9D58D3F3 |
| 33 | PackageGroup | 434560C07EED4FEBA34CDB53E35C1AAE |
| 34 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 35 | PackageElement | 6803FE74DD534A089D68EA29CCD6017F |
| 36 | PackageGroup | B5A7B9B3A03347369234FDE029018136 |
| 37 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 38 | PackageElement | 5D165EFAECFC4E2EB0AFDB829C575310 |
| 39 | PackageGroup | BDC259A8C9654AE38B290165BE3594DC |
| 40 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 41 | PackageElement | 2E37D11D7EFD4B13A6DBDD6D746A2B90 |
| 42 | PackageGroup | 89590D5DBF844C5AA4FD566A77F7157A |
| 43 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 44 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 45 | PackageElement | BD922B6DDB524837917EFF9407A3F5E4 |
| 46 | PackageGroup | B397984A76AB4757B433DDC1475B1086 |
| 47 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 48 | PackageElement | 99C54B2900944356AD94DD0414B05CA1 |
| 49 | PackageGroup | 851A420AC30E40E2A32CE6B8A617692B |
| 50 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 51 | PackageElement | A5900F7E38364DC1967408531E6E0195 |
| 52 | PackageGroup | D61C5B4789D84769B54F8387BA5C2394 |
| 53 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 54 | PackageElement | F1364F3DA20243908E90141A8FE84F8F |
| 55 | PackageGroup | 79F6A379FE904454B3CDADF08FEF61EE |
| 56 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 57 | PackageDefinition | 757D506BD2F34231907C31CE4B9B7A1C |
| 58 | DatabaseUpgrade | 7953BDAB63E744829FD8BD5C3D521951 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s4-del-refused --force`.
