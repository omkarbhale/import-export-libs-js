# s1-reimport

S1 imported, then re-imported with merge off and with merge on. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, merge off/on (tickets 05 and 75).

## Exercises

Merge off: DoesItemAlreadyExist skips every add of an item that exists (and the package is still registered). Merge on: the existing adds become edits (add to edit), locked ones are unlocked first, nothing is deleted.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | fresh import | `LIBSJS-SCRATCH-BASE` | defaults | success (0) | 0 | 213 |
| 2 | re-import, merge off | `LIBSJS-SCRATCH-BASE` | defaults | success (0) | 0 | 115 |
| 3 | re-import, merge on | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 206 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | B3507D327EEE4F4FA285870B7D5AE7C0 |
| 2 | PackageDefinition | CCB7D618591F41979009214DFC9E3108 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 7F6670C4946240B1884D05546993485F |
| 5 | PackageElement | CE500E1FCE6F4C048BBCEAD27CBB1032 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 41ABCB73FC3942E8B3192F8136DBCF9F |
| 8 | PackageElement | 61249602AEEC45D396C195864881F54F |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 31A77B782ED746E29360D5211BF09998 |
| 11 | PackageElement | E1EC632BB5AC4EFDB03CEEB3BEB61990 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 2BB825D42DB04DEBBBA914C3DB21A8B3 |
| 14 | PackageElement | EA93C24AAFA542CBBD17C33F7E73FC06 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | B7633B89F2BB4D2C867794C7A5CFB8FE |
| 18 | PackageElement | 66FC8A7849F14023A5A69C74A0E18068 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | AD44F61008FE4FEA88883817798EA058 |
| 21 | PackageElement | 9A5375613DB14C2D8AD363247DA74E04 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 8C9D5A80DEF94AC699ED5B6DD9C7C3EF |
| 24 | PackageElement | 084C93DD37C449B5BC86A4F641905802 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 006F252A2A9244348106011F4CC5CBC1 |
| 27 | PackageElement | F4023A33B1E74F4CBE816CFF1E93D08C |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 51D36707F1CF4145A0C76BF650F70C76 |
| 30 | PackageElement | B72BFF543A2745348519478AD25EF027 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | EE5BE0DAD27C46FC870AD6BA146C0324 |
| 33 | PackageElement | CD2578D937DB4F119100D363D420EA04 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 6ACFE19C72E24C50999A596D72B8389F |
| 36 | PackageElement | 306B44909DFC48A4A9F75BC4E4458B05 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 024DC462348A4D8B8482C81DB85795B7 |
| 39 | PackageElement | 3A05E3FACEA84473984B42F4782A15E2 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 95AFB9C2389F46ABB7DC2237B740D8A3 |
| 42 | PackageElement | 51F26C825B58442CBCB2F4BDCC850936 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | B42649217D4542F39739037ACDA41B3E |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 4FC37BD2AE7647EBB3CC44E7BA4B2A71 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 4FAE226D6D084D44A647CEDBFB833341 |
| 49 | PackageElement | 3A64C77C49084E99BF8D6DF92EF285DC |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | 93998079606C4B289FCF769BBB259DBE |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 7F0E93C03FB74C93BAD4078CE7568F80 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | A3A0C559382E428780A452CF10EE67AC |
| 56 | PackageElement | E034A0E19DEE4494A664F26AED0DAAA2 |

### Step 2: created 0

None.

### Step 3: created 0

None.

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | E034A0E19DEE4494A664F26AED0DAAA2 |
| 2 | PackageGroup | A3A0C559382E428780A452CF10EE67AC |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | 7F0E93C03FB74C93BAD4078CE7568F80 |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | 93998079606C4B289FCF769BBB259DBE |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | 3A64C77C49084E99BF8D6DF92EF285DC |
| 9 | PackageGroup | 4FAE226D6D084D44A647CEDBFB833341 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 4FC37BD2AE7647EBB3CC44E7BA4B2A71 |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | B42649217D4542F39739037ACDA41B3E |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | 51F26C825B58442CBCB2F4BDCC850936 |
| 16 | PackageGroup | 95AFB9C2389F46ABB7DC2237B740D8A3 |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | 3A05E3FACEA84473984B42F4782A15E2 |
| 19 | PackageGroup | 024DC462348A4D8B8482C81DB85795B7 |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 306B44909DFC48A4A9F75BC4E4458B05 |
| 22 | PackageGroup | 6ACFE19C72E24C50999A596D72B8389F |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | CD2578D937DB4F119100D363D420EA04 |
| 25 | PackageGroup | EE5BE0DAD27C46FC870AD6BA146C0324 |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | B72BFF543A2745348519478AD25EF027 |
| 28 | PackageGroup | 51D36707F1CF4145A0C76BF650F70C76 |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | F4023A33B1E74F4CBE816CFF1E93D08C |
| 31 | PackageGroup | 006F252A2A9244348106011F4CC5CBC1 |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 084C93DD37C449B5BC86A4F641905802 |
| 34 | PackageGroup | 8C9D5A80DEF94AC699ED5B6DD9C7C3EF |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 9A5375613DB14C2D8AD363247DA74E04 |
| 37 | PackageGroup | AD44F61008FE4FEA88883817798EA058 |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 66FC8A7849F14023A5A69C74A0E18068 |
| 40 | PackageGroup | B7633B89F2BB4D2C867794C7A5CFB8FE |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | EA93C24AAFA542CBBD17C33F7E73FC06 |
| 44 | PackageGroup | 2BB825D42DB04DEBBBA914C3DB21A8B3 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | E1EC632BB5AC4EFDB03CEEB3BEB61990 |
| 47 | PackageGroup | 31A77B782ED746E29360D5211BF09998 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | 61249602AEEC45D396C195864881F54F |
| 50 | PackageGroup | 41ABCB73FC3942E8B3192F8136DBCF9F |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | CE500E1FCE6F4C048BBCEAD27CBB1032 |
| 53 | PackageGroup | 7F6670C4946240B1884D05546993485F |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | CCB7D618591F41979009214DFC9E3108 |
| 56 | DatabaseUpgrade | B3507D327EEE4F4FA285870B7D5AE7C0 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s1-reimport --force`.
