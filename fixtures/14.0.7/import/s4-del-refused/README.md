# s4-del-refused

A delete the server refuses. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4 (ticket 05).

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
| 1 | DatabaseUpgrade | 4E276086A4D94A92921EFCD5AB450C26 |
| 2 | PackageDefinition | EC346F36E15442C383D51E1312539307 |
| 3 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 4 | PackageGroup | E71764EAEB1C41C3AC9BF045DAE0C90E |
| 5 | PackageElement | 85F94AC6AAA94808AC6EC3076912241E |
| 6 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 7 | PackageGroup | 36AEC7BBED4A4D16A327C99EEF6023B2 |
| 8 | PackageElement | 2845F112A65B4D768C3EC6F13D952FFD |
| 9 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 10 | PackageGroup | 97AF094A15554B9597629F4054D24273 |
| 11 | PackageElement | A4D386C23366471A87DB968638943482 |
| 12 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 13 | PackageGroup | 9CBE733B3C36493DA0D70B42C390C9FF |
| 14 | PackageElement | 0241D6FA2310475092F8E0874676B24E |
| 15 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 16 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 17 | PackageGroup | 191A85156E304DFA9AA37B53FCC64196 |
| 18 | PackageElement | C82A3972A8384D97BECE308CC6B2DD85 |
| 19 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 20 | PackageGroup | 5829A3E28587412DBC2DBE77D894C8F7 |
| 21 | PackageElement | 8AB0E63CA430495B84BBC0AFE0A8BB9E |
| 22 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 23 | PackageGroup | 436710E961AC48168040483132BB3865 |
| 24 | PackageElement | 6A12A3993DE24DE98A3C8E469605DF1D |
| 25 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 26 | PackageGroup | 23E38FFA588145E480D9B7FCEC34AF76 |
| 27 | PackageElement | A4BC5B0049394E168E0FF5DE95CE7566 |
| 28 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 29 | PackageGroup | C9E5000EE18C4FD8B3B527839C46BE13 |
| 30 | PackageElement | F82E1D735FEE491ABBBD9831121261D5 |
| 31 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 32 | PackageGroup | 1078969789BB41D8AF3FD185045FF25D |
| 33 | PackageElement | 11436924BC354B9A918C97C8315C70D9 |
| 34 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 35 | PackageGroup | B0472CBA4B4B4968AF2EE2735D893965 |
| 36 | PackageElement | 457168F8C1CA4ADFBCFB6052356957C1 |
| 37 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 38 | PackageGroup | 61EA740B07284FA5A86F6ADEE75D3B65 |
| 39 | PackageElement | 8E5D1F1223B14195BBAA510A442A90A0 |
| 40 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 41 | PackageGroup | 563DD07B9F1F42D18EC17160FFA1CD8A |
| 42 | PackageElement | CD3B70A87C9D4FB7A7EDEF76AAF93A31 |
| 43 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 44 | PackageElement | EEF7569A197B4B4EB9A35324660C45C9 |
| 45 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 46 | PackageElement | D2C199722CA44403A15BA276DF26C1BF |
| 47 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 48 | PackageGroup | 727FD0107F8D441C9DC1C2EE66CAEDE2 |
| 49 | PackageElement | A23CA6D4D63D4EDEB1BF4421FB79F531 |
| 50 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 51 | PackageElement | A161C5D3C0E7458D8314FF193A365D8C |
| 52 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 53 | PackageElement | 9AAB4CFDCE4D4347A99C31EB32129DC7 |
| 54 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 55 | PackageGroup | 1368E24A92E14058905FABA0714A5AB5 |
| 56 | PackageElement | 0925976E7349439AAB9511DB9AFC5FF4 |

### Step 2: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 9F7CFB9282B94765A6434E6E4346DE14 |
| 2 | PackageDefinition | 48BA3023019149098BCF72F8EAFB439A |

### Deleted by the cleanup: 58

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 48BA3023019149098BCF72F8EAFB439A |
| 2 | DatabaseUpgrade | 9F7CFB9282B94765A6434E6E4346DE14 |
| 3 | PackageElement | 0925976E7349439AAB9511DB9AFC5FF4 |
| 4 | PackageGroup | 1368E24A92E14058905FABA0714A5AB5 |
| 5 | UserMessage | 48CC1F963C2BD3526D145E6EF7622AE1 |
| 6 | PackageElement | 9AAB4CFDCE4D4347A99C31EB32129DC7 |
| 7 | RelationshipType | B1728187A78D330129D6FC48530DD38F |
| 8 | PackageElement | A161C5D3C0E7458D8314FF193A365D8C |
| 9 | RelationshipType | 2CAA9483C5AF745CE43A9975AB133C39 |
| 10 | PackageElement | A23CA6D4D63D4EDEB1BF4421FB79F531 |
| 11 | PackageGroup | 727FD0107F8D441C9DC1C2EE66CAEDE2 |
| 12 | RelationshipType | 2E86BE71406A024A7610EBE387CA19FA |
| 13 | PackageElement | D2C199722CA44403A15BA276DF26C1BF |
| 14 | ItemType | E2855368158C72AE7E4BF3B6E8D1D337 |
| 15 | PackageElement | EEF7569A197B4B4EB9A35324660C45C9 |
| 16 | ItemType | 0B033B1E3B6425C1276A61E3F5E5F283 |
| 17 | PackageElement | CD3B70A87C9D4FB7A7EDEF76AAF93A31 |
| 18 | PackageGroup | 563DD07B9F1F42D18EC17160FFA1CD8A |
| 19 | ItemType | E0FAE5389340631DC4962AE25970C7BB |
| 20 | PackageElement | 8E5D1F1223B14195BBAA510A442A90A0 |
| 21 | PackageGroup | 61EA740B07284FA5A86F6ADEE75D3B65 |
| 22 | Grid | DBEA5052DEBB3FE9304F72623D0E0489 |
| 23 | PackageElement | 457168F8C1CA4ADFBCFB6052356957C1 |
| 24 | PackageGroup | B0472CBA4B4B4968AF2EE2735D893965 |
| 25 | Life Cycle Map | 8B5690F5CDA03F7F570CFF04DF20BA30 |
| 26 | PackageElement | 11436924BC354B9A918C97C8315C70D9 |
| 27 | PackageGroup | 1078969789BB41D8AF3FD185045FF25D |
| 28 | Workflow Map | 97036156528C7C8959E5E0D9E2B89E1D |
| 29 | PackageElement | F82E1D735FEE491ABBBD9831121261D5 |
| 30 | PackageGroup | C9E5000EE18C4FD8B3B527839C46BE13 |
| 31 | Form | 80C1916ED13FB91AABE8B59712B5B25D |
| 32 | PackageElement | A4BC5B0049394E168E0FF5DE95CE7566 |
| 33 | PackageGroup | 23E38FFA588145E480D9B7FCEC34AF76 |
| 34 | Report | 13E641DA215894EBC9281A99B5BA656B |
| 35 | PackageElement | 6A12A3993DE24DE98A3C8E469605DF1D |
| 36 | PackageGroup | 436710E961AC48168040483132BB3865 |
| 37 | Action | 6E1629D001235406CBAF1C1BC71F19E1 |
| 38 | PackageElement | 8AB0E63CA430495B84BBC0AFE0A8BB9E |
| 39 | PackageGroup | 5829A3E28587412DBC2DBE77D894C8F7 |
| 40 | Method | 5E0832E42849900FA499343A85F8A1D0 |
| 41 | PackageElement | C82A3972A8384D97BECE308CC6B2DD85 |
| 42 | PackageGroup | 191A85156E304DFA9AA37B53FCC64196 |
| 43 | Permission | 51F2FDF85AB07DF3C25F71CA50B4FF4C |
| 44 | Member | 0FD85985D9C574513CB9B6D231B177B4 |
| 45 | PackageElement | 0241D6FA2310475092F8E0874676B24E |
| 46 | PackageGroup | 9CBE733B3C36493DA0D70B42C390C9FF |
| 47 | Identity | 8D1FA15B385BD9268D12CDB127520F9C |
| 48 | PackageElement | A4D386C23366471A87DB968638943482 |
| 49 | PackageGroup | 97AF094A15554B9597629F4054D24273 |
| 50 | Variable | 9DFD42E0D1D332A37468535A17E9E071 |
| 51 | PackageElement | 2845F112A65B4D768C3EC6F13D952FFD |
| 52 | PackageGroup | 36AEC7BBED4A4D16A327C99EEF6023B2 |
| 53 | Sequence | 67CBD9B47C02D5104BC5C97C25A2483E |
| 54 | PackageElement | 85F94AC6AAA94808AC6EC3076912241E |
| 55 | PackageGroup | E71764EAEB1C41C3AC9BF045DAE0C90E |
| 56 | List | 02FC1773E9FCF8E024A3FE0C37D824D2 |
| 57 | PackageDefinition | EC346F36E15442C383D51E1312539307 |
| 58 | DatabaseUpgrade | 4E276086A4D94A92921EFCD5AB450C26 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s4-del-refused --force`.
