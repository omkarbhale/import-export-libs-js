# s1-instances-versionable

Instances of a versionable ItemType with a relationship, re-imported. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, ProcessVersionableItem (ticket 05).

## Exercises

ProcessVersionableItem: a versionable root with a relationship that has a related_id is matched by source and related id (ExistRelItemInCurVer) and becomes an edit with a `where`, or an add. The last step gives the root a second generation first, so the root and its relationship's source_id move to the current generation.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | ItemTypes | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 245 |
| 2 | instances, fresh | `LIBSJS-SCRATCH-INST` | defaults | success (0) | 0 | 38 |
| 3 | instances, merge on | `LIBSJS-SCRATCH-INST` | merge=true | success (0) | 0 | 38 |
| 4 | instances, merge on, after versioning the root | `LIBSJS-SCRATCH-INST` | merge=true, versionBefore=[{"type":"LIBSJS_SCRATCH_IT_V","id":"CFC67070B8926819B48BC0B108536FF2"}] | success (0) | 0 | 40 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | F740AF5F3CE747519D3EED183E03289C |
| 2 | PackageDefinition | 00D85A3DC8C6408891DC2E4A24F22E72 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 6271A3E6A7144D2FAA9FA246D30157C5 |
| 5 | PackageElement | 54FCA4E0F8464381BF8DF7FFE6CFC561 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | D69BB8DA97A14E1DB71F764C4DA2F625 |
| 8 | PackageElement | 2A62EF39B4C04B60B8B0F47D916748B2 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | C7C7EB69DF3D43B9B00D308BD7759A27 |
| 11 | PackageElement | 72B5FA884B964C5585D2394098841765 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 396C4205F4F943F0859DAE6463F2B414 |
| 14 | PackageElement | 0A681E2DBBA34EB89F21C8FC39BDA55D |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 30F931BFE3DF447F8FE8BDA217AA6A4D |
| 18 | PackageElement | A2235BE8BFB34AD2846AEB7248439AE9 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 016A43540DBD450492978381A44D3EDD |
| 21 | PackageElement | D0B26A2C8AF64F0ABF587732363643E9 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | B149DA5BEDC9462F91BE994740BE56E3 |
| 24 | PackageElement | 56E1B96D15344E1D810518640927C657 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 0C38AD6BF884467C85A0CCF78C560B88 |
| 27 | PackageElement | 3D2B5A56ABFA427C8851FE7EA03C4E60 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 098E81C151DD44EB99355E12F6241FEF |
| 30 | PackageElement | 379EF9745CB14F478CA12D5EF0F5FA57 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | ABCEC7E53979479FA90A20A4F454F89C |
| 33 | PackageElement | 0D8780AE443B450EAC156A2D64E9D044 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | B93133BFBCF7475096D078257306360C |
| 36 | PackageElement | D19074C843024161B92C9E0362CEEA6B |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | C29A14045839470CAF3EEE858A3C2C6D |
| 39 | PackageElement | 707BDEFEC64D42B6A232BC1A0E7B3B55 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 1252BAEEA21E4B8EB64D7945F59C03A1 |
| 42 | PackageElement | 743C8A776D9A401BA406DB3E6F668CD2 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 05380090261949D99A26FA413BB03B32 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 8E7B18A7D0954DF39BC66236EEB2B608 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | C36A4CB4D02942428EE14119C820F8AA |
| 49 | PackageElement | 0081381D8AA14101A6CAEE4D9677999E |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | 97D77DD37C0A4DAB8ED17649709DB0AF |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 8717EDC975A840B49D58D7355B56F08F |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | A10F1A6BF70F47A99D4BE1A2DF236E6D |
| 56 | PackageElement | DAC23125D49148B5B8B6495EB4F7045E |

### Step 2: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 04BFA96269BF4FD29AF67AB946904D29 |
| 2 | PackageDefinition | 88F13D6C2A5042D8AB566D95810E873A |
| 3 | LIBSJS_SCRATCH_IT_A | 4747CF811D4EFD42FA073ACA3A1BF1BE |
| 4 | PackageGroup | 234C86FB236F4A5A851845DF58297ED7 |
| 5 | PackageElement | 3C74226D31504F63A3C362ADF092C6EB |
| 6 | LIBSJS_SCRATCH_IT_V | CFC67070B8926819B48BC0B108536FF2 |
| 7 | PackageGroup | CA92ACFC349D43A3A024256AD7C8A5ED |
| 8 | PackageElement | BB38874844B54BE59497B0F3736FBD54 |

### Step 3: created 0

None.

### Step 4: created 1

| # | Type | Id |
|---|---|---|
| 1 | LIBSJS_SCRATCH_IT_V | 0DC6DC3DD52E4750A826E40BE450B8BE |

### Deleted by the cleanup: 63

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | LIBSJS_SCRATCH_IT_V | 0DC6DC3DD52E4750A826E40BE450B8BE |
| 2 | PackageGroup | CA92ACFC349D43A3A024256AD7C8A5ED |
| 3 | PackageElement | 3C74226D31504F63A3C362ADF092C6EB |
| 4 | PackageGroup | 234C86FB236F4A5A851845DF58297ED7 |
| 5 | LIBSJS_SCRATCH_IT_A | 4747CF811D4EFD42FA073ACA3A1BF1BE |
| 6 | PackageDefinition | 88F13D6C2A5042D8AB566D95810E873A |
| 7 | DatabaseUpgrade | 04BFA96269BF4FD29AF67AB946904D29 |
| 8 | PackageElement | DAC23125D49148B5B8B6495EB4F7045E |
| 9 | PackageGroup | A10F1A6BF70F47A99D4BE1A2DF236E6D |
| 10 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 11 | PackageElement | 8717EDC975A840B49D58D7355B56F08F |
| 12 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 13 | PackageElement | 97D77DD37C0A4DAB8ED17649709DB0AF |
| 14 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 15 | PackageElement | 0081381D8AA14101A6CAEE4D9677999E |
| 16 | PackageGroup | C36A4CB4D02942428EE14119C820F8AA |
| 17 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 18 | PackageElement | 8E7B18A7D0954DF39BC66236EEB2B608 |
| 19 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 20 | PackageElement | 05380090261949D99A26FA413BB03B32 |
| 21 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 22 | PackageElement | 743C8A776D9A401BA406DB3E6F668CD2 |
| 23 | PackageGroup | 1252BAEEA21E4B8EB64D7945F59C03A1 |
| 24 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 25 | PackageElement | 707BDEFEC64D42B6A232BC1A0E7B3B55 |
| 26 | PackageGroup | C29A14045839470CAF3EEE858A3C2C6D |
| 27 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 28 | PackageElement | D19074C843024161B92C9E0362CEEA6B |
| 29 | PackageGroup | B93133BFBCF7475096D078257306360C |
| 30 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 31 | PackageElement | 0D8780AE443B450EAC156A2D64E9D044 |
| 32 | PackageGroup | ABCEC7E53979479FA90A20A4F454F89C |
| 33 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 34 | PackageElement | 379EF9745CB14F478CA12D5EF0F5FA57 |
| 35 | PackageGroup | 098E81C151DD44EB99355E12F6241FEF |
| 36 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 37 | PackageElement | 3D2B5A56ABFA427C8851FE7EA03C4E60 |
| 38 | PackageGroup | 0C38AD6BF884467C85A0CCF78C560B88 |
| 39 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 40 | PackageElement | 56E1B96D15344E1D810518640927C657 |
| 41 | PackageGroup | B149DA5BEDC9462F91BE994740BE56E3 |
| 42 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 43 | PackageElement | D0B26A2C8AF64F0ABF587732363643E9 |
| 44 | PackageGroup | 016A43540DBD450492978381A44D3EDD |
| 45 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 46 | PackageElement | A2235BE8BFB34AD2846AEB7248439AE9 |
| 47 | PackageGroup | 30F931BFE3DF447F8FE8BDA217AA6A4D |
| 48 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 49 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 50 | PackageElement | 0A681E2DBBA34EB89F21C8FC39BDA55D |
| 51 | PackageGroup | 396C4205F4F943F0859DAE6463F2B414 |
| 52 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 53 | PackageElement | 72B5FA884B964C5585D2394098841765 |
| 54 | PackageGroup | C7C7EB69DF3D43B9B00D308BD7759A27 |
| 55 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 56 | PackageElement | 2A62EF39B4C04B60B8B0F47D916748B2 |
| 57 | PackageGroup | D69BB8DA97A14E1DB71F764C4DA2F625 |
| 58 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 59 | PackageElement | 54FCA4E0F8464381BF8DF7FFE6CFC561 |
| 60 | PackageGroup | 6271A3E6A7144D2FAA9FA246D30157C5 |
| 61 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 62 | PackageDefinition | 00D85A3DC8C6408891DC2E4A24F22E72 |
| 63 | DatabaseUpgrade | F740AF5F3CE747519D3EED183E03289C |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s1-instances-versionable --force`.
