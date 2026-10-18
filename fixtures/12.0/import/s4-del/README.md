# s4-del

Delete actions against items an earlier import created. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4 (ticket 05).

## Exercises

The build.xsl drop bug: List, ItemType and Identity deletes are dropped silently (their types are listed, but only for adds and edits); Form delete (its own bucket), Field delete (any action) and Value delete (an unlisted type, last bucket) are kept. The plan the import prints is the engine's answer to which ones ran.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import BASE | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 245 |
| 2 | import DEL | `LIBSJS-SCRATCH-DEL` | merge=true | success (0) | 0 | 20 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 56

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 1939BF1E9DB64FA9A41D494F7E121D3C |
| 2 | PackageDefinition | 9759E9CADD6141618C71EC596C96A4F0 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | 1E2012ECB3204D6CB3BE792C59130C5A |
| 5 | PackageElement | 1AEB73CB1F0D409DA80F80397CF6A30B |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 652523EC19104483A4E2DDEB29F2D799 |
| 8 | PackageElement | F8D2617B1CF4432C9B29C61080B413C8 |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 47230E76CF8C47EE93DEB9E41E786399 |
| 11 | PackageElement | F1905E56DD8345868743E7614D3E189E |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 323587DB7F45480B9166C9E8F2B8F733 |
| 14 | PackageElement | 7AB087CAF9BC483E9CA6C6052326C09A |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | E1D6189350744720A62BAE4EF9ADE63E |
| 18 | PackageElement | A66FE4755D7A42D78214F8C25FB81AF3 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | B39F16DC22F44EBDA07F6E17CD40192B |
| 21 | PackageElement | BA7F4086BF1545F6B45BD834E8F5CAC5 |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | E8B7A89BE42B4406B637403431ADB367 |
| 24 | PackageElement | CC1D8364E939439EB183CA5D7C3FD19D |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 011B915989BE41D88A6C20AA679834D4 |
| 27 | PackageElement | 6F82E7B1D93D4241BD33DE219E017CB1 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | 5BE162EC628644EE913F3602A8754749 |
| 30 | PackageElement | FED0B0A937BF4969B2B40EA1D346D0BE |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | D15A2C0F49CB416DBD0C196EE0B07BA9 |
| 33 | PackageElement | E41B8FAF1B5B45E6AA6F414934FEC68E |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | 6033584DCC0D4E998E1796F9DE3EF41E |
| 36 | PackageElement | C1F4DEC81BA94901BDB36F70B22B1B9A |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | A475DC75141942EC80E94393BF1ADB7D |
| 39 | PackageElement | 7CD433561156477992F66D633151C088 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 7737CA53F3DC492CB68FFC5785267EC8 |
| 42 | PackageElement | 07576EB1DB4540CBB4C1A9D538866869 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | F72B792757374AA89DCBEF8F832F730A |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | 8BA76102C6CD472D9905BD1E051FDAF5 |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 5BBE0D8CE70E45A9995CDFD0A150FC09 |
| 49 | PackageElement | 9E4DB95783F14FAEAF2437D525EBC77D |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | B9F37CCFC01D49478B6D6D177F5F8185 |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | CBB65110E4CE41DA9E2EFC10CD7AE2B1 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | EB7E99CC017749E29E65AD83F8E1BB44 |
| 56 | PackageElement | 4491927FB783493D83C7CDF3908DF789 |

### Step 2: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | A77D8AA5568F40628F139E2BAE7E0470 |
| 2 | PackageDefinition | 0932D0F081424A01AA5FA357586C5887 |

### Deleted by the cleanup: 56

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 0932D0F081424A01AA5FA357586C5887 |
| 2 | DatabaseUpgrade | A77D8AA5568F40628F139E2BAE7E0470 |
| 3 | PackageElement | 4491927FB783493D83C7CDF3908DF789 |
| 4 | PackageGroup | EB7E99CC017749E29E65AD83F8E1BB44 |
| 5 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 6 | PackageElement | CBB65110E4CE41DA9E2EFC10CD7AE2B1 |
| 7 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 8 | PackageElement | B9F37CCFC01D49478B6D6D177F5F8185 |
| 9 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 10 | PackageElement | 9E4DB95783F14FAEAF2437D525EBC77D |
| 11 | PackageGroup | 5BBE0D8CE70E45A9995CDFD0A150FC09 |
| 12 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 13 | PackageElement | 8BA76102C6CD472D9905BD1E051FDAF5 |
| 14 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 15 | PackageElement | F72B792757374AA89DCBEF8F832F730A |
| 16 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 17 | PackageElement | 07576EB1DB4540CBB4C1A9D538866869 |
| 18 | PackageGroup | 7737CA53F3DC492CB68FFC5785267EC8 |
| 19 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 20 | PackageElement | 7CD433561156477992F66D633151C088 |
| 21 | PackageGroup | A475DC75141942EC80E94393BF1ADB7D |
| 22 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 23 | PackageElement | C1F4DEC81BA94901BDB36F70B22B1B9A |
| 24 | PackageGroup | 6033584DCC0D4E998E1796F9DE3EF41E |
| 25 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 26 | PackageElement | E41B8FAF1B5B45E6AA6F414934FEC68E |
| 27 | PackageGroup | D15A2C0F49CB416DBD0C196EE0B07BA9 |
| 28 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 29 | PackageGroup | 5BE162EC628644EE913F3602A8754749 |
| 30 | PackageElement | 6F82E7B1D93D4241BD33DE219E017CB1 |
| 31 | PackageGroup | 011B915989BE41D88A6C20AA679834D4 |
| 32 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 33 | PackageElement | CC1D8364E939439EB183CA5D7C3FD19D |
| 34 | PackageGroup | E8B7A89BE42B4406B637403431ADB367 |
| 35 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 36 | PackageElement | BA7F4086BF1545F6B45BD834E8F5CAC5 |
| 37 | PackageGroup | B39F16DC22F44EBDA07F6E17CD40192B |
| 38 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 39 | PackageElement | A66FE4755D7A42D78214F8C25FB81AF3 |
| 40 | PackageGroup | E1D6189350744720A62BAE4EF9ADE63E |
| 41 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 42 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 43 | PackageElement | 7AB087CAF9BC483E9CA6C6052326C09A |
| 44 | PackageGroup | 323587DB7F45480B9166C9E8F2B8F733 |
| 45 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 46 | PackageElement | F1905E56DD8345868743E7614D3E189E |
| 47 | PackageGroup | 47230E76CF8C47EE93DEB9E41E786399 |
| 48 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 49 | PackageElement | F8D2617B1CF4432C9B29C61080B413C8 |
| 50 | PackageGroup | 652523EC19104483A4E2DDEB29F2D799 |
| 51 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 52 | PackageElement | 1AEB73CB1F0D409DA80F80397CF6A30B |
| 53 | PackageGroup | 1E2012ECB3204D6CB3BE792C59130C5A |
| 54 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 55 | PackageDefinition | 9759E9CADD6141618C71EC596C96A4F0 |
| 56 | DatabaseUpgrade | 1939BF1E9DB64FA9A41D494F7E121D3C |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s4-del --force`.
