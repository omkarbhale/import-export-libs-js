# s1-method-generation

A versionable Method re-imported after it got a second generation. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1, versionable (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 4C86EC3939394DA2BDB45E5C804792B2 |
| 2 | PackageDefinition | 358195619CD34E21AA90C5F5D60A318F |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 27F0624F196B4714860D644246666E23 |
| 5 | PackageElement | 316B8B3C7B0346B1BB07CEC603F350CF |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 459E9051B35B4E0F9344E0F0080EB50B |
| 8 | PackageElement | 27DEE54FEC544F309512001999C335E3 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 252B7D526A714F32B65804549377D7E9 |
| 11 | PackageElement | 6EAA16172A784623A2995B23D089F280 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | DF7C66AF983D454C9B598D4FC72FF3B6 |
| 14 | PackageElement | F5D507466B3A4381B8BEE4ACBE427BE3 |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 8A3231C7E6D54B96B8962CE32F23E6B4 |
| 18 | PackageElement | 62829C1772A146FB838FBC9AA99115BE |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 68A0C056CE104BE28D147B8BE5E8461F |
| 21 | PackageElement | 8DAAC447FBE14F8287C58B229DE0D3F9 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 8D84BA0EE73A45B7908C80CD906F2FFB |
| 24 | PackageElement | AD95BDA632554F89AE82E0F23576A133 |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | AD7CD7176513422E9AEBB9042689809F |
| 27 | PackageElement | 9F2F96FC7B064461844276EE1EE61275 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 8C5E33105FF94EF4ACC85793B03D2FEA |
| 30 | PackageElement | 8EC64D48992841C88D1525FC4E9E0B46 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 2C5CA211A8A94EF38D8AA8EEB9A58C8D |
| 33 | PackageElement | B0E458D12B8B4236898C636324F5897C |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | DE44951F18834BA3897FA4E8B26FB789 |
| 36 | PackageElement | B622E398196E494591A1E50FB40F9336 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | B0FEC408BC9B463FAD6C5289ED311D79 |
| 39 | PackageElement | 3EED0FD645C94400BF63B8DF85C15B6B |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 5C292F5934344B448950EE32E1AA5078 |
| 42 | PackageElement | 2B5F28CD84B34D1D835C695856A7913E |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | 9BB6F2D2B3AF4A71BF39DC2B4F90B6CC |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 925C689F3C5245548A8D7A7CD8D974B6 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 0305B5C97DE849C09E233A39D030E951 |
| 49 | PackageElement | 49A65D29597D45DD9083DCA07C6A0EA0 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | AFCDCCB6C3CC43F9B814AF7254583C1D |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 69E3A7E53C7349CCA947989A136D20AD |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | DC8E480277104F40A923C1DB9FA24FDC |
| 56 | PackageElement | A390E56E28A34F4497A9376BC97E1C2F |

### Step 2: created 1

| # | Type | Id |
|---|---|---|
| 1 | Method | 281621C1160B4C508AA172C84D049CD7 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | A390E56E28A34F4497A9376BC97E1C2F |
| 2 | PackageGroup | DC8E480277104F40A923C1DB9FA24FDC |
| 3 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 4 | PackageElement | 69E3A7E53C7349CCA947989A136D20AD |
| 5 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 6 | PackageElement | AFCDCCB6C3CC43F9B814AF7254583C1D |
| 7 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 8 | PackageElement | 49A65D29597D45DD9083DCA07C6A0EA0 |
| 9 | PackageGroup | 0305B5C97DE849C09E233A39D030E951 |
| 10 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 11 | PackageElement | 925C689F3C5245548A8D7A7CD8D974B6 |
| 12 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 13 | PackageElement | 9BB6F2D2B3AF4A71BF39DC2B4F90B6CC |
| 14 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 15 | PackageElement | 2B5F28CD84B34D1D835C695856A7913E |
| 16 | PackageGroup | 5C292F5934344B448950EE32E1AA5078 |
| 17 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 18 | PackageElement | 3EED0FD645C94400BF63B8DF85C15B6B |
| 19 | PackageGroup | B0FEC408BC9B463FAD6C5289ED311D79 |
| 20 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 21 | PackageElement | B622E398196E494591A1E50FB40F9336 |
| 22 | PackageGroup | DE44951F18834BA3897FA4E8B26FB789 |
| 23 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 24 | PackageElement | B0E458D12B8B4236898C636324F5897C |
| 25 | PackageGroup | 2C5CA211A8A94EF38D8AA8EEB9A58C8D |
| 26 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 27 | PackageElement | 8EC64D48992841C88D1525FC4E9E0B46 |
| 28 | PackageGroup | 8C5E33105FF94EF4ACC85793B03D2FEA |
| 29 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 30 | PackageElement | 9F2F96FC7B064461844276EE1EE61275 |
| 31 | PackageGroup | AD7CD7176513422E9AEBB9042689809F |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | AD95BDA632554F89AE82E0F23576A133 |
| 34 | PackageGroup | 8D84BA0EE73A45B7908C80CD906F2FFB |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | 8DAAC447FBE14F8287C58B229DE0D3F9 |
| 37 | PackageGroup | 68A0C056CE104BE28D147B8BE5E8461F |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | 62829C1772A146FB838FBC9AA99115BE |
| 40 | PackageGroup | 8A3231C7E6D54B96B8962CE32F23E6B4 |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | F5D507466B3A4381B8BEE4ACBE427BE3 |
| 44 | PackageGroup | DF7C66AF983D454C9B598D4FC72FF3B6 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | 6EAA16172A784623A2995B23D089F280 |
| 47 | PackageGroup | 252B7D526A714F32B65804549377D7E9 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | 27DEE54FEC544F309512001999C335E3 |
| 50 | PackageGroup | 459E9051B35B4E0F9344E0F0080EB50B |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 316B8B3C7B0346B1BB07CEC603F350CF |
| 53 | PackageGroup | 27F0624F196B4714860D644246666E23 |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 358195619CD34E21AA90C5F5D60A318F |
| 56 | DatabaseUpgrade | 4C86EC3939394DA2BDB45E5C804792B2 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s1-method-generation --force`.
