# collect-two-packages

A failing package followed by a good one. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, collected errors (tickets 05 and 75).

## Exercises

A package that collected an error ends failed, and the next package starts (IMP-545); the run reports the one error and returns 1.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-COLLPKGA`, `LIBSJS-SCRATCH-COLLPKGB` | collectErrors={"maxCount":5} | 1 errors collected (1) | 1 | 86 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 33

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 712C13BC2CF543618CF124AEFBAC9D4C |
| 2 | PackageDefinition | 967E072D73A747FFAB3C76652EFD5EE8 |
| 3 | Variable | 8E56356C40D26D412D1965EDBF8CA285 |
| 4 | PackageGroup | 7CD69C359DB9448FBA181BE7340D1A04 |
| 5 | PackageElement | 527A6BC5BE5F453DBB3FD21DE03C0A41 |
| 6 | Variable | B5445479B9ACA48E5F805E1E33FFB1DD |
| 7 | PackageElement | 4F5D76A57A2B41CD8F37BCADEC61A939 |
| 8 | Variable | 7CC4B562B0A0CEB67B8E95AF5521C6FC |
| 9 | PackageElement | 5AF016C5DCB34DF086672FA26230F0B9 |
| 10 | PackageElement | 79D8863D2E20487C84FB46B3243D7AB1 |
| 11 | Variable | 1AA8464A44BB23B12494CA033ED00CDF |
| 12 | PackageElement | 157C5DA7046B45EFAE87D44C61D21FBE |
| 13 | Variable | 0539FDF4C8EB496A2506DDCDB6752E8B |
| 14 | PackageElement | 1FB7CE429D494A90A6CC4045CA3FB569 |
| 15 | Variable | 82BC3B746BD7CF01D6550C29E139D59C |
| 16 | PackageElement | 6CA28AA20B5948548587B2BDF4091D3C |
| 17 | DatabaseUpgrade | 9E131B3080D3419988233B258777A508 |
| 18 | PackageDefinition | 2019602E25DF4BA0B4359ABB964D1F98 |
| 19 | Variable | EF06CAEFE11C697DDAEDC80B1F46AB73 |
| 20 | PackageGroup | AA46A12B31C943B2BD6865ABF9E1C8FB |
| 21 | PackageElement | 2C4ABDD4E1874572BDEC5EF82296D468 |
| 22 | Variable | 98ACE235C9FB6FF4BD87D7A5B4A9330B |
| 23 | PackageElement | 8619B26D4D28400CACFD1C26B9BF3A0E |
| 24 | Variable | 6B5F0B205D3F21929628DE0BEB00A7E6 |
| 25 | PackageElement | F9CDFBE7080B47BB89B17A27CDD8E3A7 |
| 26 | Variable | 3A87B9E7C4496B6F661C4BB9191C4755 |
| 27 | PackageElement | E88BFE0BDFB44120BDA1DCB3FF380C91 |
| 28 | Variable | E7693F7E9DEF6DBD0C98AD95E4121574 |
| 29 | PackageElement | 252F4CDAE9F54B1CA5B664A7DA1AF442 |
| 30 | Variable | CE544F4B2AF846CDDB652A2F43247096 |
| 31 | PackageElement | D108F528248A4EB8BB1E03A6B1B5BE7B |
| 32 | Variable | 47766A70CF128964EC7F97419EC1DD40 |
| 33 | PackageElement | BA3FC658A78745ABBA62C7C0EDD297B2 |

### Deleted by the cleanup: 33

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | BA3FC658A78745ABBA62C7C0EDD297B2 |
| 2 | Variable | 47766A70CF128964EC7F97419EC1DD40 |
| 3 | PackageElement | D108F528248A4EB8BB1E03A6B1B5BE7B |
| 4 | Variable | CE544F4B2AF846CDDB652A2F43247096 |
| 5 | PackageElement | 252F4CDAE9F54B1CA5B664A7DA1AF442 |
| 6 | Variable | E7693F7E9DEF6DBD0C98AD95E4121574 |
| 7 | PackageElement | E88BFE0BDFB44120BDA1DCB3FF380C91 |
| 8 | Variable | 3A87B9E7C4496B6F661C4BB9191C4755 |
| 9 | PackageElement | F9CDFBE7080B47BB89B17A27CDD8E3A7 |
| 10 | Variable | 6B5F0B205D3F21929628DE0BEB00A7E6 |
| 11 | PackageElement | 8619B26D4D28400CACFD1C26B9BF3A0E |
| 12 | Variable | 98ACE235C9FB6FF4BD87D7A5B4A9330B |
| 13 | PackageElement | 2C4ABDD4E1874572BDEC5EF82296D468 |
| 14 | PackageGroup | AA46A12B31C943B2BD6865ABF9E1C8FB |
| 15 | Variable | EF06CAEFE11C697DDAEDC80B1F46AB73 |
| 16 | PackageDefinition | 2019602E25DF4BA0B4359ABB964D1F98 |
| 17 | DatabaseUpgrade | 9E131B3080D3419988233B258777A508 |
| 18 | PackageElement | 6CA28AA20B5948548587B2BDF4091D3C |
| 19 | Variable | 82BC3B746BD7CF01D6550C29E139D59C |
| 20 | PackageElement | 1FB7CE429D494A90A6CC4045CA3FB569 |
| 21 | Variable | 0539FDF4C8EB496A2506DDCDB6752E8B |
| 22 | PackageElement | 157C5DA7046B45EFAE87D44C61D21FBE |
| 23 | Variable | 1AA8464A44BB23B12494CA033ED00CDF |
| 24 | PackageElement | 79D8863D2E20487C84FB46B3243D7AB1 |
| 25 | PackageElement | 5AF016C5DCB34DF086672FA26230F0B9 |
| 26 | Variable | 7CC4B562B0A0CEB67B8E95AF5521C6FC |
| 27 | PackageElement | 4F5D76A57A2B41CD8F37BCADEC61A939 |
| 28 | Variable | B5445479B9ACA48E5F805E1E33FFB1DD |
| 29 | PackageElement | 527A6BC5BE5F453DBB3FD21DE03C0A41 |
| 30 | PackageGroup | 7CD69C359DB9448FBA181BE7340D1A04 |
| 31 | Variable | 8E56356C40D26D412D1965EDBF8CA285 |
| 32 | PackageDefinition | 967E072D73A747FFAB3C76652EFD5EE8 |
| 33 | DatabaseUpgrade | 712C13BC2CF543618CF124AEFBAC9D4C |

## Spec rules

IMP-545, IMP-546. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only collect-two-packages --force`.
