# 14.35 language-pack import fixtures

Recorded runs of engine 14.35.0.43890's `lpimport` against the dev instance, from `npm run oracle:lp-cases`. Cases lp01 to lp05 are ticket 45's 14.0.7 runs (`fixtures/14.0.7/language-pack/`) repeated on 14.35 with the same packs; lp06 to lp08 are the 14.35 language selection (`Languages`) and the package name with a dot. They back `spec/language-pack.md` (`LP-` rules) and `spec/import-languages.md` (`IMP-640`). Each case folder holds the oracle's usual record (`run.json`, `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log`) plus `lp/` (the language pack the engine read), `input/` (the empty package folder the host is given), `case.json` and a README.

| Case | What | Calls |
|---|---|---|
| [lp01](lp01/README.md) | no language list: every server language but `en` | 20 |
| [lp02](lp02/README.md) | `languages list="de"` | 20 |
| [lp03](lp03/README.md) | `languages list="de, fr"`, and a property the `label` list drops | 20 |
| [lp04](lp04/README.md) | `--lp-debug`: the temp package is kept | 20 |
| [lp05](lp05/README.md) | `languages list="xx"`: no language qualifies, empty import | 16 |
| [lp06](lp06/README.md) | `Languages` = `de` over a pack that translates `de` and `fr` | 21 |
| [lp07](lp07/README.md) | `Languages` = `*` over a pack that translates `de` and `fr` | 21 |
| [lp08](lp08/README.md) | a package name with a dot | 7 |

## What was on dev

- **Languages.** Dev has only `en`. The recording added `de` and `fr` (`fixtures/14.0.7/language-pack/setup.aml`) and deleted both afterwards, so dev has `en` only again (adding a Language makes the server add a `LABEL_<code>` column to every table with a multilingual property).
- **Items.** The packs translate the `label` of the two scratch `Forum` items of `setup.aml`; they were purged, with their Teams, after the last run (`teardown.aml`).
- **Import bookkeeping.** Each run added a `DatabaseUpgrade` and a `PackageDefinition` named `LIBSJS-SCRATCH-LP` and the host deleted both (ids in `run.json` `cleanup`). Nothing of this ticket is left on dev.
- **Not covered.** The `Property` branch of 14.35's preprocessor (`LP-040` to `LP-044`): it needs a pack row whose keyed_name is a Property, which the scratch guard would refuse. The packs are hand-written in the format of `spec/language-pack.md`, as in ticket 45; no stock language pack exists on the captain's machine.
