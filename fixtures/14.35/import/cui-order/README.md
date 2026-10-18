# cui-order

cui_Control and cui_WindowSection items among others. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, build.xsl (tickets 05 and 75).

## Exercises

build.xsl groups G12a and G12b: the cui_Control adds, then the cui_WindowSection adds, come right after the Report group and before the Form (the plan printed in the log reads List, Variable, Report, the two controls, the two window sections, Form), where 14.0.7 imported them at the end sorted by type, after the Form. The files are in an order that differs from the import order. The window sections read a stock cui_Location (ItemView) and nothing else non-scratch; the controls are root ToolbarControls, because the server refuses a tab control without a tab container.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-CUI` | defaults | success (0) | 0 | 77 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 24

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 8266A4F08B044CF6B4C4FADA7F6B50F6 |
| 2 | PackageDefinition | 67D437383FBB4621BCA594F3D515FF15 |
| 3 | List | 67036B55DA6E1228B9095485313908E3 |
| 4 | PackageGroup | 84E57841A94E43048884ECE816BA20AD |
| 5 | PackageElement | E87D0AB0651D4172AD928A52EC12099F |
| 6 | Variable | 4A3C8FAB2CE704D85CB85B9B9BAA9624 |
| 7 | PackageGroup | EEA92B1DC4B94894B73046639C8296F1 |
| 8 | PackageElement | 2DED96BB08BA45818E8D518D4AD23289 |
| 9 | Report | 668C3E10310216638FE69ED249264A6D |
| 10 | PackageGroup | 6A2B79E8154B4F30976E11EC42A79E4C |
| 11 | PackageElement | D6D214CE0857450DB9F55594E0608F67 |
| 12 | cui_Control | 3D1E1322934EAE81CD97328D65CF2618 |
| 13 | PackageGroup | 4E6639BDEA004FCCB8D9CB114C7B8F34 |
| 14 | PackageElement | 037052FE5F87463C9091FE1521ED035A |
| 15 | cui_Control | BBC126D227BE5DAB4261507B2B08CEC3 |
| 16 | PackageElement | 39E7D67F494C4F26AAC8407BF9153764 |
| 17 | cui_WindowSection | 554644A5E7A915C22265463449AF2C0B |
| 18 | PackageGroup | 854EF6E581804F008743C4E4B24501E4 |
| 19 | PackageElement | 3E2827D99CDF46DDAC944896A8B978F1 |
| 20 | cui_WindowSection | 0C2A4EB392288BCD1393BECE50500C8A |
| 21 | PackageElement | D80DBA4C562A4C5FAE3890D9455B42A8 |
| 22 | Form | 02833C34E6C47941AEA72A8678405D49 |
| 23 | PackageGroup | BE11B53304D24977B1E3438FF0F7161E |
| 24 | PackageElement | BD1517AAEF7943B0902A84C59F10F5F2 |

### Deleted by the cleanup: 24

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | BD1517AAEF7943B0902A84C59F10F5F2 |
| 2 | PackageGroup | BE11B53304D24977B1E3438FF0F7161E |
| 3 | Form | 02833C34E6C47941AEA72A8678405D49 |
| 4 | PackageElement | D80DBA4C562A4C5FAE3890D9455B42A8 |
| 5 | cui_WindowSection | 0C2A4EB392288BCD1393BECE50500C8A |
| 6 | PackageElement | 3E2827D99CDF46DDAC944896A8B978F1 |
| 7 | PackageGroup | 854EF6E581804F008743C4E4B24501E4 |
| 8 | cui_WindowSection | 554644A5E7A915C22265463449AF2C0B |
| 9 | PackageElement | 39E7D67F494C4F26AAC8407BF9153764 |
| 10 | cui_Control | BBC126D227BE5DAB4261507B2B08CEC3 |
| 11 | PackageElement | 037052FE5F87463C9091FE1521ED035A |
| 12 | PackageGroup | 4E6639BDEA004FCCB8D9CB114C7B8F34 |
| 13 | cui_Control | 3D1E1322934EAE81CD97328D65CF2618 |
| 14 | PackageElement | D6D214CE0857450DB9F55594E0608F67 |
| 15 | PackageGroup | 6A2B79E8154B4F30976E11EC42A79E4C |
| 16 | Report | 668C3E10310216638FE69ED249264A6D |
| 17 | PackageElement | 2DED96BB08BA45818E8D518D4AD23289 |
| 18 | PackageGroup | EEA92B1DC4B94894B73046639C8296F1 |
| 19 | Variable | 4A3C8FAB2CE704D85CB85B9B9BAA9624 |
| 20 | PackageElement | E87D0AB0651D4172AD928A52EC12099F |
| 21 | PackageGroup | 84E57841A94E43048884ECE816BA20AD |
| 22 | List | 67036B55DA6E1228B9095485313908E3 |
| 23 | PackageDefinition | 67D437383FBB4621BCA594F3D515FF15 |
| 24 | DatabaseUpgrade | 8266A4F08B044CF6B4C4FADA7F6B50F6 |

## Spec rules

IMP-021, IMP-022, IMP-029. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only cui-order --force`.
