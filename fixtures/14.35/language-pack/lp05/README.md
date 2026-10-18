# lp05

`languages list="xx"`: no language qualifies, empty import. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list="xx"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP`, `Languages` unset.
- Expected: success (0). Recorded: host exit 0, returned 0, 16 calls.
- Nothing qualifies, so no row produces a translation and no Fixes file is written; the import runs on an empty package and succeeds. The `Language` get is still sent.
- Rules: LP-011, LP-014, LP-026.

## Ids created and deleted

Created 2, all deleted by the cleanup (newest first): PackageDefinition 2E7C509EA1BD464EA653354A9E499CCB, DatabaseUpgrade 3ACD3CE2C7794BEE9BF2ED2F5524F694.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp05 --force`.
