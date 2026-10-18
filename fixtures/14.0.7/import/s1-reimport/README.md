# s1-reimport

S1 imported, then re-imported with merge off and with merge on. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, merge off/on (ticket 05).

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
| 1 | DatabaseUpgrade | 3BE76EB92C5A4880A6DB3D9F350DF565 |
| 2 | PackageDefinition | 533733909C0C419A93BFA14E8A237270 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | D9194044A2FC413396575DAC62F4F14C |
| 5 | PackageElement | 637CAA72EE80462993038915BB47AB72 |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | B84780BD8F0741AB9A9FB7A5F985F20B |
| 8 | PackageElement | 7D4E23D37AAC405B8FF9459783F6C348 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 027C8BC229434091AA49D2284A38370B |
| 11 | PackageElement | 1A3516CA38D446E4ACB2F600093E2BF5 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 4F7E2A5932EF4DDF96EE2AF16FF0DB75 |
| 14 | PackageElement | 0DE6460B4F844594B9C01ABEE05FD4EF |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 141ACBEBBE5F4CAD824AD74AD353A5BB |
| 18 | PackageElement | 7FEF9C1BF15243998B12E4197B8304EB |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 28DBFF9767644F8888B6328BFF9BD393 |
| 21 | PackageElement | FFF5BD05E4EC409D963A9E86516BD9A4 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | FF3E8AA6275A4DBA8865ECAB18FB971A |
| 24 | PackageElement | 73DE610AC1A1429182151D70B68ED759 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 287A260043E046C1859984F4A3F57926 |
| 27 | PackageElement | 59869B84E14E48FD8E1358D8683F25A1 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | BC7E807074BC4D5F8C7E9C542FA40E7F |
| 30 | PackageElement | 865C7AD6654643D6A32ACB6C2BA89DB0 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 62C5137DC90945C0AC17A3C28DD67457 |
| 33 | PackageElement | A081FCDC935749CBB78EE8ADF7B4C8D4 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | EDAD619366C544A6870C60FE77F12B34 |
| 36 | PackageElement | 8F6098186F7F458A9072F46F64BDCC21 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | A144C8D3205F4DAAAAB789DF13CF5959 |
| 39 | PackageElement | A94CEB9265D74C8E86763C5ABD2AEC36 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 07C8D058FAF24834A722CBBC7891E11C |
| 42 | PackageElement | 5DF861A69DA247728871049D8197E607 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 096BA2271FE74F68A97A04FAD86633D1 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 1A42DC4EAD4D432E8CDD2AC209943211 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 05C1EBB1C741488380ECF28F1231D645 |
| 49 | PackageElement | B178A664063B49068C3A8FC057B4ABAD |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | 217B0643416D4AF6AB03ED7DBE3C2E93 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 3FBFE1902FC042E590FB894579121277 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 6ABAD7E2BF6C4F598E45797327DDDA8A |
| 56 | PackageElement | BC6BBCC6D0FB40058DBA620E4424839D |

### Step 2: created 0

None.

### Step 3: created 0

None.

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | BC6BBCC6D0FB40058DBA620E4424839D |
| 2 | PackageGroup | 6ABAD7E2BF6C4F598E45797327DDDA8A |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | 3FBFE1902FC042E590FB894579121277 |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | 217B0643416D4AF6AB03ED7DBE3C2E93 |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | B178A664063B49068C3A8FC057B4ABAD |
| 9 | PackageGroup | 05C1EBB1C741488380ECF28F1231D645 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 1A42DC4EAD4D432E8CDD2AC209943211 |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | 096BA2271FE74F68A97A04FAD86633D1 |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | 5DF861A69DA247728871049D8197E607 |
| 16 | PackageGroup | 07C8D058FAF24834A722CBBC7891E11C |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | A94CEB9265D74C8E86763C5ABD2AEC36 |
| 19 | PackageGroup | A144C8D3205F4DAAAAB789DF13CF5959 |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | 8F6098186F7F458A9072F46F64BDCC21 |
| 22 | PackageGroup | EDAD619366C544A6870C60FE77F12B34 |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | A081FCDC935749CBB78EE8ADF7B4C8D4 |
| 25 | PackageGroup | 62C5137DC90945C0AC17A3C28DD67457 |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | 865C7AD6654643D6A32ACB6C2BA89DB0 |
| 28 | PackageGroup | BC7E807074BC4D5F8C7E9C542FA40E7F |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | 59869B84E14E48FD8E1358D8683F25A1 |
| 31 | PackageGroup | 287A260043E046C1859984F4A3F57926 |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | 73DE610AC1A1429182151D70B68ED759 |
| 34 | PackageGroup | FF3E8AA6275A4DBA8865ECAB18FB971A |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | FFF5BD05E4EC409D963A9E86516BD9A4 |
| 37 | PackageGroup | 28DBFF9767644F8888B6328BFF9BD393 |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 7FEF9C1BF15243998B12E4197B8304EB |
| 40 | PackageGroup | 141ACBEBBE5F4CAD824AD74AD353A5BB |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | 0DE6460B4F844594B9C01ABEE05FD4EF |
| 44 | PackageGroup | 4F7E2A5932EF4DDF96EE2AF16FF0DB75 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 1A3516CA38D446E4ACB2F600093E2BF5 |
| 47 | PackageGroup | 027C8BC229434091AA49D2284A38370B |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | 7D4E23D37AAC405B8FF9459783F6C348 |
| 50 | PackageGroup | B84780BD8F0741AB9A9FB7A5F985F20B |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 637CAA72EE80462993038915BB47AB72 |
| 53 | PackageGroup | D9194044A2FC413396575DAC62F4F14C |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 533733909C0C419A93BFA14E8A237270 |
| 56 | DatabaseUpgrade | 3BE76EB92C5A4880A6DB3D9F350DF565 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s1-reimport --force`.
