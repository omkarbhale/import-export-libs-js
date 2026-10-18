# s1-base

One item per build.xsl bucket, fresh import. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S1 (ticket 05).

## Exercises

build.xsl ordering of the first-group types, ItemTypes (non-polymorphic, then polymorphic), RelationshipTypes by dependencyLevel, the ItemType-follow-up View and Form deletes, and the per-type package registration. Item files are on disk in an order that differs from the import order.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BASE` | defaults | success (0) | 0 | 211 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 2991FE749EF04F84994397A1F19BF6C4 |
| 2 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 3 | PackageGroup | 8B6D3BC331BE46A0A3D9AEBB8CA8EAB8 |
| 4 | PackageElement | 5FE26C754E4548C284DB167D061A2CB7 |
| 5 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 6 | PackageGroup | 4EE07FD2E42047B3ABB56F55268683D7 |
| 7 | PackageElement | 9B8D2840B60040CCA09C0E75D9FD9867 |
| 8 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 9 | PackageGroup | 81A4E5A88B594B40AA3F963F6E7050F1 |
| 10 | PackageElement | A9F644F8B0B04BB999C1A0A77E3085F6 |
| 11 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 12 | PackageGroup | 4B06233F28694A42A4E0F0258DC73CA2 |
| 13 | PackageElement | F4076697BC5548A3834B96F6239F70E2 |
| 14 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 15 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 16 | PackageGroup | C48E97B6DA444FFA8F5F429FDDAE295E |
| 17 | PackageElement | C3D1EDBC92124553BDF58F30AD7C8BDE |
| 18 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 19 | PackageGroup | C17F2E2A94BA4B58B74DED28DD5FB97D |
| 20 | PackageElement | 4E3FB237170943A2BD4F59AA237859F9 |
| 21 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 22 | PackageGroup | 4D5B72AD7C424A3FBF7BBE51A715A1C8 |
| 23 | PackageElement | 959DF5D601F84F0B85EAD50352BB7515 |
| 24 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 25 | PackageGroup | 1FE6062FF6B74057AFD8C6066C792407 |
| 26 | PackageElement | 00B109FDAD584584AEDBB1D056AE08FE |
| 27 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 28 | PackageGroup | FA3C569FA718400C89153A8EDD1E1BCA |
| 29 | PackageElement | ABB3CFAA373F4CD39EB9839304149C44 |
| 30 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 31 | PackageGroup | 22434AE0AD994F5F9FB6A56975DFF708 |
| 32 | PackageElement | A388B5D2298447B6AD37B8F41714B74B |
| 33 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 34 | PackageGroup | 7E4EFEEBCEC44578AE8D91757FC81D92 |
| 35 | PackageElement | DAEE9965F9CB41A79DF35AF84B3ED61D |
| 36 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 37 | PackageGroup | 54FCF3C35A184A2EA96613BB45038D5E |
| 38 | PackageElement | C47A44673393461A8748F9F48AFF1503 |
| 39 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 40 | PackageGroup | AC4BC00F72514E3FB04E38078173D617 |
| 41 | PackageElement | 2A8FD5342FE74350845FF69A11A99EA2 |
| 42 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 43 | PackageElement | A6C4CAD3E64843CD91AF1A16FAB343B8 |
| 44 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 45 | PackageElement | 03F7B12D10864C57A1BE80683B1FCDFE |
| 46 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 47 | PackageGroup | 17DD8E6A90BA4F7AA0DC4A246BDE3168 |
| 48 | PackageElement | 08D6203012BF4811B3952C1BEC5D289A |
| 49 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 50 | PackageElement | 6C7EFB8A59A049D3BAAA5AA10EF5ED1D |
| 51 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 52 | PackageElement | 377347822B2040C68B50EAB45DC92C05 |
| 53 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 54 | PackageGroup | 66DBAE25CD45422F8C5F7ECE80066B36 |
| 55 | PackageElement | 1448D614E90F470684C4DDC39E827B5C |
| 56 | DatabaseUpgrade | 380E902C22EB46E6A9DE8793D18D00AD |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 380E902C22EB46E6A9DE8793D18D00AD |
| 2 | PackageElement | 1448D614E90F470684C4DDC39E827B5C |
| 3 | PackageGroup | 66DBAE25CD45422F8C5F7ECE80066B36 |
| 4 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 5 | PackageElement | 377347822B2040C68B50EAB45DC92C05 |
| 6 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 7 | PackageElement | 6C7EFB8A59A049D3BAAA5AA10EF5ED1D |
| 8 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 9 | PackageElement | 08D6203012BF4811B3952C1BEC5D289A |
| 10 | PackageGroup | 17DD8E6A90BA4F7AA0DC4A246BDE3168 |
| 11 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 12 | PackageElement | 03F7B12D10864C57A1BE80683B1FCDFE |
| 13 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 14 | PackageElement | A6C4CAD3E64843CD91AF1A16FAB343B8 |
| 15 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 16 | PackageElement | 2A8FD5342FE74350845FF69A11A99EA2 |
| 17 | PackageGroup | AC4BC00F72514E3FB04E38078173D617 |
| 18 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 19 | PackageElement | C47A44673393461A8748F9F48AFF1503 |
| 20 | PackageGroup | 54FCF3C35A184A2EA96613BB45038D5E |
| 21 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 22 | PackageElement | DAEE9965F9CB41A79DF35AF84B3ED61D |
| 23 | PackageGroup | 7E4EFEEBCEC44578AE8D91757FC81D92 |
| 24 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 25 | PackageElement | A388B5D2298447B6AD37B8F41714B74B |
| 26 | PackageGroup | 22434AE0AD994F5F9FB6A56975DFF708 |
| 27 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 28 | PackageElement | ABB3CFAA373F4CD39EB9839304149C44 |
| 29 | PackageGroup | FA3C569FA718400C89153A8EDD1E1BCA |
| 30 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 31 | PackageElement | 00B109FDAD584584AEDBB1D056AE08FE |
| 32 | PackageGroup | 1FE6062FF6B74057AFD8C6066C792407 |
| 33 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 34 | PackageElement | 959DF5D601F84F0B85EAD50352BB7515 |
| 35 | PackageGroup | 4D5B72AD7C424A3FBF7BBE51A715A1C8 |
| 36 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 37 | PackageElement | 4E3FB237170943A2BD4F59AA237859F9 |
| 38 | PackageGroup | C17F2E2A94BA4B58B74DED28DD5FB97D |
| 39 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 40 | PackageElement | C3D1EDBC92124553BDF58F30AD7C8BDE |
| 41 | PackageGroup | C48E97B6DA444FFA8F5F429FDDAE295E |
| 42 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 43 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 44 | PackageElement | F4076697BC5548A3834B96F6239F70E2 |
| 45 | PackageGroup | 4B06233F28694A42A4E0F0258DC73CA2 |
| 46 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 47 | PackageElement | A9F644F8B0B04BB999C1A0A77E3085F6 |
| 48 | PackageGroup | 81A4E5A88B594B40AA3F963F6E7050F1 |
| 49 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 50 | PackageElement | 9B8D2840B60040CCA09C0E75D9FD9867 |
| 51 | PackageGroup | 4EE07FD2E42047B3ABB56F55268683D7 |
| 52 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 53 | PackageElement | 5FE26C754E4548C284DB167D061A2CB7 |
| 54 | PackageGroup | 8B6D3BC331BE46A0A3D9AEBB8CA8EAB8 |
| 55 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 56 | PackageDefinition | 2991FE749EF04F84994397A1F19BF6C4 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s1-base --force`.
