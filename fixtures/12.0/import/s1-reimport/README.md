# s1-reimport

S1 imported, then re-imported with merge off and with merge on. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, merge off/on (ticket 05).

## Exercises

Merge off: DoesItemAlreadyExist skips every add of an item that exists (and the package is still registered). Merge on: the existing adds become edits (add to edit), locked ones are unlocked first, nothing is deleted.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | fresh import | `LIBSJS-SCRATCH-BASE` | defaults | success (0) | 0 | 212 |
| 2 | re-import, merge off | `LIBSJS-SCRATCH-BASE` | defaults | success (0) | 0 | 116 |
| 3 | re-import, merge on | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 208 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 1FEEBF4B84324A778A577688D6AD1CF7 |
| 2 | PackageDefinition | 47EC554145FA4E48B0B8D3CD8B69452C |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | B2FA78019D0649C1AEC1D618376C71CA |
| 5 | PackageElement | 02F9AD89643F435F900996FCBB973267 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 2FCEFB01550E4050B4495D19DFFE6D80 |
| 8 | PackageElement | FBA704A76F634CBE87A546EDB72C1856 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | A68475CBF27449CB8616FFAA92C945A0 |
| 11 | PackageElement | 60C9832C03984F51B5922CAC80F96335 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 624E0F33B24042EBADB7913814143775 |
| 14 | PackageElement | 355BE92B435A432FBF136229C921F515 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 8B96A7D5AFA141BD8D3F297E03E5748F |
| 18 | PackageElement | 7455D4E8D91C448588B54C3625EDBB53 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | F628DAEFF6AD459D831C058B2742B72C |
| 21 | PackageElement | 23E358D89DB840E380E8E365259387DA |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 829C3FBAAFE9486D83503F9F54F41E9D |
| 24 | PackageElement | EB651786DA7840CEB566A89EC41BE141 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | C9DFD0539D614817A96887769ADA306A |
| 27 | PackageElement | A4A082A385654EED9C40C02F3067824B |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | BF3BBB1878D44F429FB42FF631B29EB7 |
| 30 | PackageElement | 82B978539F324721B79D74473BBECE0A |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | D03714B4E46547C78C012F9D6EB8923F |
| 33 | PackageElement | 4097D27E455540DC8DF8A70D243E2BBF |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 72E6C3FAD9B74ABD8CA973F242757A1F |
| 36 | PackageElement | 5973DB4F580145DBB5954A917553AE17 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | B656E4E11E4A420B817B7135002DAD2F |
| 39 | PackageElement | 557945D340EE4DCA9BECE70DD7069B96 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 92ADE4E6EEC94FF4BE9C98F99E9EADBF |
| 42 | PackageElement | 4421D6988E1D4F3FBE34EE5B620594E6 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 55F7D1BCCBBA42179C34BB4CB7551BAD |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | C4CE5245285B4779805AF535FA2C8BD3 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | E6938E822FCD4BCEAB010D6A59517D4C |
| 49 | PackageElement | C2D7F937F8874F5BAF9E76156649AD99 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | 50678DA8173249FE823AE181C6D9F3F8 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | AF0FC72C976B42C68F110D4051028FAA |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | C5E0C98BDE344520A942AE0F252DA25F |
| 56 | PackageElement | 572A16CB8BB94945B0690A1DDD9617C7 |

### Step 2: created 0

None.

### Step 3: created 2

| # | Type | Id |
|---|---|---|
| 1 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 2 | PackageElement | 8034AAA94CF84559B79D1965791FA140 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 8034AAA94CF84559B79D1965791FA140 |
| 2 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 3 | PackageElement | 572A16CB8BB94945B0690A1DDD9617C7 |
| 4 | PackageGroup | C5E0C98BDE344520A942AE0F252DA25F |
| 5 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 6 | PackageElement | AF0FC72C976B42C68F110D4051028FAA |
| 7 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 8 | PackageElement | 50678DA8173249FE823AE181C6D9F3F8 |
| 9 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 10 | PackageElement | C2D7F937F8874F5BAF9E76156649AD99 |
| 11 | PackageGroup | E6938E822FCD4BCEAB010D6A59517D4C |
| 12 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 13 | PackageElement | C4CE5245285B4779805AF535FA2C8BD3 |
| 14 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 15 | PackageElement | 55F7D1BCCBBA42179C34BB4CB7551BAD |
| 16 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 17 | PackageElement | 4421D6988E1D4F3FBE34EE5B620594E6 |
| 18 | PackageGroup | 92ADE4E6EEC94FF4BE9C98F99E9EADBF |
| 19 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 20 | PackageElement | 557945D340EE4DCA9BECE70DD7069B96 |
| 21 | PackageGroup | B656E4E11E4A420B817B7135002DAD2F |
| 22 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 23 | PackageElement | 5973DB4F580145DBB5954A917553AE17 |
| 24 | PackageGroup | 72E6C3FAD9B74ABD8CA973F242757A1F |
| 25 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 26 | PackageElement | 4097D27E455540DC8DF8A70D243E2BBF |
| 27 | PackageGroup | D03714B4E46547C78C012F9D6EB8923F |
| 28 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 29 | PackageGroup | BF3BBB1878D44F429FB42FF631B29EB7 |
| 30 | PackageElement | A4A082A385654EED9C40C02F3067824B |
| 31 | PackageGroup | C9DFD0539D614817A96887769ADA306A |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | EB651786DA7840CEB566A89EC41BE141 |
| 34 | PackageGroup | 829C3FBAAFE9486D83503F9F54F41E9D |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 23E358D89DB840E380E8E365259387DA |
| 37 | PackageGroup | F628DAEFF6AD459D831C058B2742B72C |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 7455D4E8D91C448588B54C3625EDBB53 |
| 40 | PackageGroup | 8B96A7D5AFA141BD8D3F297E03E5748F |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | 355BE92B435A432FBF136229C921F515 |
| 44 | PackageGroup | 624E0F33B24042EBADB7913814143775 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 60C9832C03984F51B5922CAC80F96335 |
| 47 | PackageGroup | A68475CBF27449CB8616FFAA92C945A0 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | FBA704A76F634CBE87A546EDB72C1856 |
| 50 | PackageGroup | 2FCEFB01550E4050B4495D19DFFE6D80 |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 02F9AD89643F435F900996FCBB973267 |
| 53 | PackageGroup | B2FA78019D0649C1AEC1D618376C71CA |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 47EC554145FA4E48B0B8D3CD8B69452C |
| 56 | DatabaseUpgrade | 1FEEBF4B84324A778A577688D6AD1CF7 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s1-reimport --force`.
