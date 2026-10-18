# s1-method-generation

A versionable Method re-imported after it got a second generation. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, versionable (ticket 05).

## Exercises

SetItemIdToLastGeneration and GetCurrentIdOfVersion: the file carries the first generation's id, the server's current one is the second, so the merge asks for is_current and config_id, then for the id of the current generation. The host versions the Method between the steps, outside the recording.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | fresh import | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 246 |
| 2 | re-import after versioning the Method | `LIBSJS-SCRATCH-BASE` | merge=true, versionBefore=[{"type":"Method","id":"5E0832E42849900FA499343A85F8A1D0"}] | success (0) | 0 | 208 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | B307CEC16E4F44C58877D332F7E09938 |
| 2 | PackageDefinition | BEA7E0761EC4464CAC81BDDBC15737D6 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 55B1C99D85E24C67B550AF287D2F3CBF |
| 5 | PackageElement | 5287076EAD1646FCA62F347F7B327AC0 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 06D88DA2500D499592B320453D5ADF18 |
| 8 | PackageElement | CBE974E2757449D0BEEC1BF0BD8AC5CD |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | B046362C5A9C485EBFAA085AD3A7A11B |
| 11 | PackageElement | 4452356B3042474884534321EF733D17 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | A89FD755030D4119AFD106C88B92AFC1 |
| 14 | PackageElement | 978ED136235A4D3A9F34F7EE378C6AEF |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 80020F19B8F04B46A8530C39C886277C |
| 18 | PackageElement | 8C10AD8FD48C41B19ADCA10432250576 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | D4D0249C2A7041F395E61599FBB87C91 |
| 21 | PackageElement | 9DD39260B7114E929DFBF8CC5D4BE666 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 46D574D5635448C693D022CD924CCEC8 |
| 24 | PackageElement | 88F2665742E94660A5B148756C3C0CF8 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 0C89156D164B4B4A818227760294974B |
| 27 | PackageElement | F20D097184E6483E8557AD9C58F4F230 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 425F7E1A83AB4DD29B6409066CDE654C |
| 30 | PackageElement | E9021EEC46FF45F5A494043A23A582AA |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 6E5DD9A4A33D4385A7F0FF3C035D5B9C |
| 33 | PackageElement | 07CEE6CD4F3E4028878FC308C7394167 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | C064B2BFA1744C6AAFE6A215237FD93D |
| 36 | PackageElement | 4CD1764E727940B0AE5520ABA82DCA45 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 189348EAD78D46F68B22C698A8B0F601 |
| 39 | PackageElement | EC8664B2734943D8A7B6D3EDCA2E451E |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 1191ED3A485941A690C6DECFCB31FD57 |
| 42 | PackageElement | E65FB5075F7D491FA1BE5E194297124E |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 0111C0CCA26E4ED589010EDC8D5B3EB9 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 0541A2FF41A44F59808BE9ED4740EC94 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 32DAB26EDD534920AD4CB49CC1E1150E |
| 49 | PackageElement | 0D7905F2332147EDB341F039A020D99E |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | 7B48BFA398EB4862BD52FAD00623879C |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | C3263E6CE484408EAC78EEA497871BEB |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 0CDD447697994F4C937F37525311DF06 |
| 56 | PackageElement | AF7CF72E2FF54E01A7059FF0061C0CD1 |

### Step 2: created 1

| # | Type | Id |
|---|---|---|
| 1 | Method | B460A5B950224169A92FF0794303CBF5 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | AF7CF72E2FF54E01A7059FF0061C0CD1 |
| 2 | PackageGroup | 0CDD447697994F4C937F37525311DF06 |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | C3263E6CE484408EAC78EEA497871BEB |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | 7B48BFA398EB4862BD52FAD00623879C |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | 0D7905F2332147EDB341F039A020D99E |
| 9 | PackageGroup | 32DAB26EDD534920AD4CB49CC1E1150E |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 0541A2FF41A44F59808BE9ED4740EC94 |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | 0111C0CCA26E4ED589010EDC8D5B3EB9 |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | E65FB5075F7D491FA1BE5E194297124E |
| 16 | PackageGroup | 1191ED3A485941A690C6DECFCB31FD57 |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | EC8664B2734943D8A7B6D3EDCA2E451E |
| 19 | PackageGroup | 189348EAD78D46F68B22C698A8B0F601 |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 4CD1764E727940B0AE5520ABA82DCA45 |
| 22 | PackageGroup | C064B2BFA1744C6AAFE6A215237FD93D |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | 07CEE6CD4F3E4028878FC308C7394167 |
| 25 | PackageGroup | 6E5DD9A4A33D4385A7F0FF3C035D5B9C |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | E9021EEC46FF45F5A494043A23A582AA |
| 28 | PackageGroup | 425F7E1A83AB4DD29B6409066CDE654C |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | F20D097184E6483E8557AD9C58F4F230 |
| 31 | PackageGroup | 0C89156D164B4B4A818227760294974B |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 88F2665742E94660A5B148756C3C0CF8 |
| 34 | PackageGroup | 46D574D5635448C693D022CD924CCEC8 |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 9DD39260B7114E929DFBF8CC5D4BE666 |
| 37 | PackageGroup | D4D0249C2A7041F395E61599FBB87C91 |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 8C10AD8FD48C41B19ADCA10432250576 |
| 40 | PackageGroup | 80020F19B8F04B46A8530C39C886277C |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | 978ED136235A4D3A9F34F7EE378C6AEF |
| 44 | PackageGroup | A89FD755030D4119AFD106C88B92AFC1 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 4452356B3042474884534321EF733D17 |
| 47 | PackageGroup | B046362C5A9C485EBFAA085AD3A7A11B |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | CBE974E2757449D0BEEC1BF0BD8AC5CD |
| 50 | PackageGroup | 06D88DA2500D499592B320453D5ADF18 |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 5287076EAD1646FCA62F347F7B327AC0 |
| 53 | PackageGroup | 55B1C99D85E24C67B550AF287D2F3CBF |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | BEA7E0761EC4464CAC81BDDBC15737D6 |
| 56 | DatabaseUpgrade | B307CEC16E4F44C58877D332F7E09938 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s1-method-generation --force`.
