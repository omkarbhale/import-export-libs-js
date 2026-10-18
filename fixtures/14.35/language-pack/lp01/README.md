# lp01

no language list: every server language but `en`. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list=""`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP`, `Languages` unset.
- Expected: success (0). Recorded: host exit 0, returned 0, 20 calls.
- An empty `languages list` asks for every language the server has but `en`. 14.35 scans the generated package in its constructor (IMP-640) and imports it; `Languages` is not set, so nothing is deleted.
- Rules: LP-011, LP-014, LP-024, IMP-610, IMP-640.

## Ids created and deleted

Created 2, all deleted by the cleanup (newest first): PackageDefinition 680862CD8B4B45A7BE1B1C038CAD07D2, DatabaseUpgrade B77FA87813984371A3B46352723A9626.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp01 --force`.
