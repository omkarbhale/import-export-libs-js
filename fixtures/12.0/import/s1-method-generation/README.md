# s1-method-generation

A versionable Method re-imported after it got a second generation. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, versionable (ticket 05).

## Exercises

SetItemIdToLastGeneration and GetCurrentIdOfVersion: the file carries the first generation's id, the server's current one is the second, so the merge asks for is_current and config_id, then for the id of the current generation. The host versions the Method between the steps, outside the recording.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | fresh import | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 245 |
| 2 | re-import after versioning the Method | `LIBSJS-SCRATCH-BASE` | merge=true, versionBefore=[{"type":"Method","id":"5E0832E42849900FA499343A85F8A1D0"}] | success (0) | 0 | 207 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | FC0045489DF44D638C5938BE4ED1ADB6 |
| 2 | PackageDefinition | B1F3D46E4F154662B9E5C182437C34DE |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 8FB026BA10614D43BC5A64B592A33E3B |
| 5 | PackageElement | C52055977BBB4F98BDAA3D537E64EBF1 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 4F85BF354B2B4122AA29389DD66AED32 |
| 8 | PackageElement | CBCFCC54CA814DA7B6B3BAA9C2D04FE2 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 2D050A087C39426A92CAC32DC55A4589 |
| 11 | PackageElement | F5342EBE43E943D28930712294B567C9 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 7966B612924B4A6CBE91BAD5FE408E16 |
| 14 | PackageElement | FE13EC3BC66D49718A80DE4FA671F0C6 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 8A4FE51E75B84F218654BDBBEB151A76 |
| 18 | PackageElement | 34F8B8C4FCD94CAC8781591801FCEEB3 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | B1B3438E09C44E538CF3E331480EBD2C |
| 21 | PackageElement | 5537C29D6A0349199D23D50EF24ECF47 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 8D9B3086D5A2446CAD749DEFE1C054A8 |
| 24 | PackageElement | 8858399150264167AA4AA90DD94CA6E2 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 9812A0C3B4B3429E8F71E40591BBBACF |
| 27 | PackageElement | 4ECD2F71412049B99E01F6704329E9E2 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 0F348D64CE3240A09F29D9FD2D488848 |
| 30 | PackageElement | FC410B56DADD45D49464D18F777703AC |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 1612C462F091403A951939E246C087AE |
| 33 | PackageElement | FA2D161C253A4C1CAD5DE6A79DC0ED79 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | DD7A3EF314D94A83992C79149E9C7F79 |
| 36 | PackageElement | 280141C8479D4F059182FA26AB8D5C36 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 3B0461A11E6E46A99593993569B7145D |
| 39 | PackageElement | EDFF404B0D804FF8AD00364A3DBDA8DC |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 06C4F7DAB8754AE4B71DCE765C3D6DD9 |
| 42 | PackageElement | 7474B9EAF2E44B8E8C24DAA342591B4C |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 930C130C93074DF6BFC5480032A96CB5 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 44CDABA984274FAB81C4186DC2AC319E |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | C0182280D4974F90A1706FA59E9A0899 |
| 49 | PackageElement | A1B44962ADE34AF088DF2C67D368A122 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | FD3278CAEAE94DD98FD13374C3176974 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 679E4D7DA28847FF80B6109FBD1C6E32 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 76EDDCD5AAEF43969CFA84447BB5A68A |
| 56 | PackageElement | BBFA3010899144668638A5D5F445C9A6 |

### Step 2: created 1

| # | Type | Id |
|---|---|---|
| 1 | Method | D6CD6AEC4C3A4D53AD7F05C0CCBA4955 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | BBFA3010899144668638A5D5F445C9A6 |
| 2 | PackageGroup | 76EDDCD5AAEF43969CFA84447BB5A68A |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | 679E4D7DA28847FF80B6109FBD1C6E32 |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | FD3278CAEAE94DD98FD13374C3176974 |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | A1B44962ADE34AF088DF2C67D368A122 |
| 9 | PackageGroup | C0182280D4974F90A1706FA59E9A0899 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 44CDABA984274FAB81C4186DC2AC319E |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | 930C130C93074DF6BFC5480032A96CB5 |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | 7474B9EAF2E44B8E8C24DAA342591B4C |
| 16 | PackageGroup | 06C4F7DAB8754AE4B71DCE765C3D6DD9 |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | EDFF404B0D804FF8AD00364A3DBDA8DC |
| 19 | PackageGroup | 3B0461A11E6E46A99593993569B7145D |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 280141C8479D4F059182FA26AB8D5C36 |
| 22 | PackageGroup | DD7A3EF314D94A83992C79149E9C7F79 |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | FA2D161C253A4C1CAD5DE6A79DC0ED79 |
| 25 | PackageGroup | 1612C462F091403A951939E246C087AE |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | FC410B56DADD45D49464D18F777703AC |
| 28 | PackageGroup | 0F348D64CE3240A09F29D9FD2D488848 |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | 4ECD2F71412049B99E01F6704329E9E2 |
| 31 | PackageGroup | 9812A0C3B4B3429E8F71E40591BBBACF |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 8858399150264167AA4AA90DD94CA6E2 |
| 34 | PackageGroup | 8D9B3086D5A2446CAD749DEFE1C054A8 |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 5537C29D6A0349199D23D50EF24ECF47 |
| 37 | PackageGroup | B1B3438E09C44E538CF3E331480EBD2C |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 34F8B8C4FCD94CAC8781591801FCEEB3 |
| 40 | PackageGroup | 8A4FE51E75B84F218654BDBBEB151A76 |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | FE13EC3BC66D49718A80DE4FA671F0C6 |
| 44 | PackageGroup | 7966B612924B4A6CBE91BAD5FE408E16 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | F5342EBE43E943D28930712294B567C9 |
| 47 | PackageGroup | 2D050A087C39426A92CAC32DC55A4589 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | CBCFCC54CA814DA7B6B3BAA9C2D04FE2 |
| 50 | PackageGroup | 4F85BF354B2B4122AA29389DD66AED32 |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | C52055977BBB4F98BDAA3D537E64EBF1 |
| 53 | PackageGroup | 8FB026BA10614D43BC5A64B592A33E3B |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | B1F3D46E4F154662B9E5C182437C34DE |
| 56 | DatabaseUpgrade | FC0045489DF44D638C5938BE4ED1ADB6 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s1-method-generation --force`.
