# s4-del-refused

A delete the server refuses. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4 (tickets 05 and 75).

## Exercises

The delete-only retry path: a delete is imported without the full reference check, so when its apply fails the engine warns, runs the full check and applies it again, and the second failure ends the package.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import BASE | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 246 |
| 2 | import DELREFUSED | `LIBSJS-SCRATCH-DELREFUSED` | merge=true | engine failure (1) | 1 | 19 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | F48BD304459D4C1DA4E30D5BB2EDB9A7 |
| 2 | PackageDefinition | 63A1C46E174448209D5565B3C2FE6F2A |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 2A1AD90876D04CA795A271996FACBD4E |
| 5 | PackageElement | D6E062D0D2404D7087F0E635A8578176 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | F31DE7CDC1B4452C8D08835912D2886B |
| 8 | PackageElement | 8A5531522B6841E2A0F46FF575AD531F |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 790FC5FE2B0B49ECAF220A82B059A64C |
| 11 | PackageElement | 49E05692780D4F8FB7514998770F17F9 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 8FEE7F7775734F68AC2604CB0FDDDCF9 |
| 14 | PackageElement | ADAC1E05F7B043BF9650CA993D2FC432 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | DAEC492B08884326B45E03A8207A44FD |
| 18 | PackageElement | 070C40D7FDBE4A429B353B63AD71D959 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 1300EF0413C44C16934F4AEF05A0CB66 |
| 21 | PackageElement | B31FDD52DCB04CD2BFC51430498EE086 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 5FF41994878A439D98A34EEFD7091C54 |
| 24 | PackageElement | A6064C23FCB2499481C050E323B4AAAB |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | A2D78ACBF79049F1BD553A4093E6A63F |
| 27 | PackageElement | E8E711AF0B1649D6A5800087B83F84BD |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 3AB610B2F5294D96AB30E50A1B565518 |
| 30 | PackageElement | 9D9451D92BB648ED8392853BA015FD8D |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | D1390006C6D042B8AF0F314DB2990B9A |
| 33 | PackageElement | 68DC4A5D26684B97A1E75C4580D13F54 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 8CFDAE04B42847B98514A844BCB29D3F |
| 36 | PackageElement | 4F8045987B7945E787F25A4F06F373AF |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 6FD40F308F5D4512B2982738B81034F2 |
| 39 | PackageElement | 52712C0849F7442784A9A2DFC2682985 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 45686E6E700441C8B5D529D283D6DEBC |
| 42 | PackageElement | 8935AD3A886E4CEE8677BFAC48163718 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | AFB049B3C37B4CF5B3DC9CCA685C03B2 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 4BFE6818878B4670B855E13C99963DFE |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 00173EC076904E85A92146FC901A98A3 |
| 49 | PackageElement | B18FB350E3244CDFAE19B539B0B2FB8E |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | 61B08AA2AC794687AC8C0EF9C90F8933 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 8B2E176E1A634CD286AE615F972E9FF1 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 403F2B0FA1B74F26A8F6A7F9167EFDD8 |
| 56 | PackageElement | 3EC67E45FBD044F2AD41E1733CB4C3FB |

### Step 2: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 70DE1B2022584BBA8CBBEAE86B80B4F1 |
| 2 | PackageDefinition | B14ED917326E415587642428DAA3F2B3 |

### Deleted by the cleanup: 58

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | B14ED917326E415587642428DAA3F2B3 |
| 2 | DatabaseUpgrade | 70DE1B2022584BBA8CBBEAE86B80B4F1 |
| 3 | PackageElement | 3EC67E45FBD044F2AD41E1733CB4C3FB |
| 4 | PackageGroup | 403F2B0FA1B74F26A8F6A7F9167EFDD8 |
| 5 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 6 | PackageElement | 8B2E176E1A634CD286AE615F972E9FF1 |
| 7 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 8 | PackageElement | 61B08AA2AC794687AC8C0EF9C90F8933 |
| 9 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 10 | PackageElement | B18FB350E3244CDFAE19B539B0B2FB8E |
| 11 | PackageGroup | 00173EC076904E85A92146FC901A98A3 |
| 12 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 13 | PackageElement | 4BFE6818878B4670B855E13C99963DFE |
| 14 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 15 | PackageElement | AFB049B3C37B4CF5B3DC9CCA685C03B2 |
| 16 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 17 | PackageElement | 8935AD3A886E4CEE8677BFAC48163718 |
| 18 | PackageGroup | 45686E6E700441C8B5D529D283D6DEBC |
| 19 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 20 | PackageElement | 52712C0849F7442784A9A2DFC2682985 |
| 21 | PackageGroup | 6FD40F308F5D4512B2982738B81034F2 |
| 22 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 23 | PackageElement | 4F8045987B7945E787F25A4F06F373AF |
| 24 | PackageGroup | 8CFDAE04B42847B98514A844BCB29D3F |
| 25 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 26 | PackageElement | 68DC4A5D26684B97A1E75C4580D13F54 |
| 27 | PackageGroup | D1390006C6D042B8AF0F314DB2990B9A |
| 28 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 29 | PackageElement | 9D9451D92BB648ED8392853BA015FD8D |
| 30 | PackageGroup | 3AB610B2F5294D96AB30E50A1B565518 |
| 31 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 32 | PackageElement | E8E711AF0B1649D6A5800087B83F84BD |
| 33 | PackageGroup | A2D78ACBF79049F1BD553A4093E6A63F |
| 34 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 35 | PackageElement | A6064C23FCB2499481C050E323B4AAAB |
| 36 | PackageGroup | 5FF41994878A439D98A34EEFD7091C54 |
| 37 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 38 | PackageElement | B31FDD52DCB04CD2BFC51430498EE086 |
| 39 | PackageGroup | 1300EF0413C44C16934F4AEF05A0CB66 |
| 40 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 41 | PackageElement | 070C40D7FDBE4A429B353B63AD71D959 |
| 42 | PackageGroup | DAEC492B08884326B45E03A8207A44FD |
| 43 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 44 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 45 | PackageElement | ADAC1E05F7B043BF9650CA993D2FC432 |
| 46 | PackageGroup | 8FEE7F7775734F68AC2604CB0FDDDCF9 |
| 47 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 48 | PackageElement | 49E05692780D4F8FB7514998770F17F9 |
| 49 | PackageGroup | 790FC5FE2B0B49ECAF220A82B059A64C |
| 50 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 51 | PackageElement | 8A5531522B6841E2A0F46FF575AD531F |
| 52 | PackageGroup | F31DE7CDC1B4452C8D08835912D2886B |
| 53 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 54 | PackageElement | D6E062D0D2404D7087F0E635A8578176 |
| 55 | PackageGroup | 2A1AD90876D04CA795A271996FACBD4E |
| 56 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 57 | PackageDefinition | 63A1C46E174448209D5565B3C2FE6F2A |
| 58 | DatabaseUpgrade | F48BD304459D4C1DA4E30D5BB2EDB9A7 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s4-del-refused --force`.
