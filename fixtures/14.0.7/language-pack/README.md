# 14.0.7 language-pack import fixtures

Five recorded runs of engine 14.0.7.35492's `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest) against the dev instance, from `npm run oracle -- --engine 14.0.7 lpimport`. They back `spec/language-pack.md` (`LP-` rules) and are replayed by wayfinder ticket 41. Each case folder holds the oracle's usual record (`run.json`, `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log`) plus `lp/` (the language pack the engine read), `case.json`, `verify.json` and a README.

| Case | What | Calls |
|---|---|---|
| [lp01](lp01/README.md) | no language list: every server language but `en` | 20 |
| [lp02](lp02/README.md) | `languages list="de"` | 20 |
| [lp03](lp03/README.md) | `languages list="de, fr"`, and a property the `label` list drops | 20 |
| [lp04](lp04/README.md) | `--lp-debug`: the temp package is kept (`temp-package/`) | 20 |
| [lp05](lp05/README.md) | `languages list="xx"`: no language qualifies, empty import | 16 |

## What was on dev

- **Languages.** Dev had only `en`. Ticket 45 added `de` and `fr` (`setup.aml`) for the recording and deleted both afterwards, so dev has `en` only again. Adding a Language made the server add a `LABEL_DE` and a `LABEL_FR` column to every table with a multilingual property, and each add took longer than 30 s. After the delete the server's insert statements no longer list those columns. A later ticket that needs real languages re-adds them with `setup.aml` and removes them again.
- **Items.** The packs translate the `label` of two scratch `Forum` items (`LIBSJS-SCRATCH-LP-Forum`, `…-Forum2`, ids in `setup.aml`). They were purged, with their Teams, after the last run (`teardown.aml`). A scratch ItemType was not possible: an ItemType name must match `^[a-zA-Z](\w*| +\w+)*$`, so it cannot be named `LIBSJS-SCRATCH-*` and the oracle's scratch guard would refuse it. `Action` and `CommandBarSection` need a Method id and a classification the scratch rows do not have. `Forum` is non-versionable, so the engine's `edit` takes the plain path (`is_versionable` lookup, call 14).
- **Import bookkeeping.** Each run added a `DatabaseUpgrade` and a `PackageDefinition` named `LIBSJS-SCRATCH-LP` and the host deleted both (ids in `run.json`, `cleanup`). Nothing of this ticket is left on dev.

## No stock language pack

None was found on the captain's machine: the Release 23 and 28 CD images carry only `Utilities/LanguagePackManagementUtility` (`LanguageTool.exe` with a sample `ImportConfig.xml` and `ExportConfig.xml`, no `xml/` rows), and a search of the Desktop, Downloads and `C:\Aras*` folders found no pack folder. These packs are hand-written in the format of `spec/language-pack.md` (LP-010 to LP-023), not exported by Aras. To record against a real pack, supply:

1. a pack folder exported by Aras's Language Pack Management Utility (or a vendor pack): `ImportConfig.xml` plus `xml/<ItemType>.xml`, with `<export><Item …><property __name="…" en="…" de="…"/></Item></export>` rows;
2. for each item in it, a matching **scratch** item on dev named `LIBSJS-SCRATCH-*`, with the pack's `id` (the oracle's guard only checks the `keyed_name`; the engine edits by `id`, so a pack carrying stock ids would edit stock items);
3. the language codes the pack uses, added as `Language` items on dev.

## Rules for this folder

The same as `fixtures/README.md`. The retained temp folder's random name is shown as `LanguagePack_<random>` in the logs (LP-030).
