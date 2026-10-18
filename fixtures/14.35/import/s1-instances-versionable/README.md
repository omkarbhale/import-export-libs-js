# s1-instances-versionable

Instances of a versionable ItemType with a relationship, re-imported. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, ProcessVersionableItem (tickets 05 and 75).

## Exercises

ProcessVersionableItem: a versionable root with a relationship that has a related_id is matched by source and related id (ExistRelItemInCurVer) and becomes an edit with a `where`, or an add. The last step gives the root a second generation first, so the root and its relationship's source_id move to the current generation.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | ItemTypes | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 246 |
| 2 | instances, fresh | `LIBSJS-SCRATCH-INST` | defaults | success (0) | 0 | 39 |
| 3 | instances, merge on | `LIBSJS-SCRATCH-INST` | merge=true | success (0) | 0 | 39 |
| 4 | instances, merge on, after versioning the root | `LIBSJS-SCRATCH-INST` | merge=true, versionBefore=[{"type":"LIBSJS_SCRATCH_IT_V","id":"CFC67070B8926819B48BC0B108536FF2"}] | success (0) | 0 | 41 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 757310500A2841C2916FCA533BD49886 |
| 2 | PackageDefinition | 260D71F6007E413581DEF170F1D3F1BE |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 331A0E45A9E3475C9A4422DFB1759FE9 |
| 5 | PackageElement | BE82BCB2BC7E42C2ADFF48F09147759B |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | F3A8DAA2C5654062BF193834E9C83385 |
| 8 | PackageElement | A0101470028A4480AEBD58D7BAD6DB6A |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 884DABDC3CB4488892236EB591CCDD86 |
| 11 | PackageElement | 78D8A210164F4A7399498D28F00A46E6 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | E55AE60A79444952B8E8D5E03FF12EF3 |
| 14 | PackageElement | A32E83F6E59B46EA92CAE8911B99AECC |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 4DAF8C8542E7426F9DD581764BF422C5 |
| 18 | PackageElement | 1E4000A539BF496587F4A3A6BEF49A4F |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 89E4786D56D549B4A8469971E4B60387 |
| 21 | PackageElement | 7D8C5957AB494D9595B37301B80ABE9D |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | E3F0EF657FF04EB9877DE36EA09856C1 |
| 24 | PackageElement | F95F74B969274698856A87D3354165DC |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 27C1C1B9C1934084AD45A6E78DC58F44 |
| 27 | PackageElement | A1A312237F814EE0A0646E429FE19515 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 639FD972F8BB4C31A0C8827F577A464C |
| 30 | PackageElement | E535688E3B754AD7A572A93B79849B3C |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | F0B66916116044ADA6622127F00E1DF8 |
| 33 | PackageElement | 02979EA948AB41C2A6F3166E3F9CAB0E |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | EAC1B66069E744FF9C9151D0CDBD9CAD |
| 36 | PackageElement | E45D0DD88D7E496393E5E6EC47F2195A |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | BF952E4E8EF94059ADF9A6ED4BD845E3 |
| 39 | PackageElement | D88BC79594DA4807B6BF7028261C79E2 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 8C672BBE5EDF410EBC5D90CD18D92D65 |
| 42 | PackageElement | 9E299470F9D64C76BE6DC6547706076C |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 648B208DDA5746BF9BA9EF493C5F6C92 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 1F2CD34819E845DA8CA6EB6E085D4725 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 5076D4FEC73B411980E88F615AB78DFA |
| 49 | PackageElement | 8611675D80F84D96BA2B6B0E34151157 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | 9ABC70251DFF436FB7A227D9E94C51A2 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 00D553ABDA7B4258B3C5FECA22DF732A |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 936F1118AA744CBC9C7D361C600C5E8E |
| 56 | PackageElement | 1ED168B099614F15A0DD109AFDD2EB60 |

### Step 2: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 902696B88EAE4698BB57E5AC777B035F |
| 2 | PackageDefinition | 220AC546B59F4BB7BC6B7D36F058EF05 |
| 3 | LIBSJS_SCRATCH_IT_A | 4747CF811D4EFD42FA073ACA3A1BF1BE |
| 4 | PackageGroup | 21963B77D0154DC4A1B4E20445D355D1 |
| 5 | PackageElement | 82FDBB7085114E37A5EAF1B601951FBA |
| 6 | LIBSJS_SCRATCH_IT_V | CFC67070B8926819B48BC0B108536FF2 |
| 7 | PackageGroup | 3149741348D64BA78D5A448C7C3E5E2D |
| 8 | PackageElement | 36CA940B405F4BBEBBB01E393E2D4429 |

### Step 3: created 0

None.

### Step 4: created 1

| # | Type | Id |
|---|---|---|
| 1 | LIBSJS_SCRATCH_IT_V | 6BE170C6F48047EF8293899794E583AF |

### Deleted by the cleanup: 63

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | LIBSJS_SCRATCH_IT_V | 6BE170C6F48047EF8293899794E583AF |
| 2 | PackageGroup | 3149741348D64BA78D5A448C7C3E5E2D |
| 3 | PackageElement | 82FDBB7085114E37A5EAF1B601951FBA |
| 4 | PackageGroup | 21963B77D0154DC4A1B4E20445D355D1 |
| 5 | LIBSJS_SCRATCH_IT_A | 4747CF811D4EFD42FA073ACA3A1BF1BE |
| 6 | PackageDefinition | 220AC546B59F4BB7BC6B7D36F058EF05 |
| 7 | DatabaseUpgrade | 902696B88EAE4698BB57E5AC777B035F |
| 8 | PackageElement | 1ED168B099614F15A0DD109AFDD2EB60 |
| 9 | PackageGroup | 936F1118AA744CBC9C7D361C600C5E8E |
| 10 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 11 | PackageElement | 00D553ABDA7B4258B3C5FECA22DF732A |
| 12 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 13 | PackageElement | 9ABC70251DFF436FB7A227D9E94C51A2 |
| 14 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 15 | PackageElement | 8611675D80F84D96BA2B6B0E34151157 |
| 16 | PackageGroup | 5076D4FEC73B411980E88F615AB78DFA |
| 17 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 18 | PackageElement | 1F2CD34819E845DA8CA6EB6E085D4725 |
| 19 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 20 | PackageElement | 648B208DDA5746BF9BA9EF493C5F6C92 |
| 21 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 22 | PackageElement | 9E299470F9D64C76BE6DC6547706076C |
| 23 | PackageGroup | 8C672BBE5EDF410EBC5D90CD18D92D65 |
| 24 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 25 | PackageElement | D88BC79594DA4807B6BF7028261C79E2 |
| 26 | PackageGroup | BF952E4E8EF94059ADF9A6ED4BD845E3 |
| 27 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 28 | PackageElement | E45D0DD88D7E496393E5E6EC47F2195A |
| 29 | PackageGroup | EAC1B66069E744FF9C9151D0CDBD9CAD |
| 30 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 31 | PackageElement | 02979EA948AB41C2A6F3166E3F9CAB0E |
| 32 | PackageGroup | F0B66916116044ADA6622127F00E1DF8 |
| 33 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 34 | PackageElement | E535688E3B754AD7A572A93B79849B3C |
| 35 | PackageGroup | 639FD972F8BB4C31A0C8827F577A464C |
| 36 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 37 | PackageElement | A1A312237F814EE0A0646E429FE19515 |
| 38 | PackageGroup | 27C1C1B9C1934084AD45A6E78DC58F44 |
| 39 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 40 | PackageElement | F95F74B969274698856A87D3354165DC |
| 41 | PackageGroup | E3F0EF657FF04EB9877DE36EA09856C1 |
| 42 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 43 | PackageElement | 7D8C5957AB494D9595B37301B80ABE9D |
| 44 | PackageGroup | 89E4786D56D549B4A8469971E4B60387 |
| 45 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 46 | PackageElement | 1E4000A539BF496587F4A3A6BEF49A4F |
| 47 | PackageGroup | 4DAF8C8542E7426F9DD581764BF422C5 |
| 48 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 49 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 50 | PackageElement | A32E83F6E59B46EA92CAE8911B99AECC |
| 51 | PackageGroup | E55AE60A79444952B8E8D5E03FF12EF3 |
| 52 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 53 | PackageElement | 78D8A210164F4A7399498D28F00A46E6 |
| 54 | PackageGroup | 884DABDC3CB4488892236EB591CCDD86 |
| 55 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 56 | PackageElement | A0101470028A4480AEBD58D7BAD6DB6A |
| 57 | PackageGroup | F3A8DAA2C5654062BF193834E9C83385 |
| 58 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 59 | PackageElement | BE82BCB2BC7E42C2ADFF48F09147759B |
| 60 | PackageGroup | 331A0E45A9E3475C9A4422DFB1759FE9 |
| 61 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 62 | PackageDefinition | 260D71F6007E413581DEF170F1D3F1BE |
| 63 | DatabaseUpgrade | 757310500A2841C2916FCA533BD49886 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s1-instances-versionable --force`.
