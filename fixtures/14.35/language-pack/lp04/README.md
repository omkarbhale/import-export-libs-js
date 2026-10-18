# lp04

`--lp-debug`: the temp package is kept. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list=""`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP`, `Languages` unset, `LPDebug`.
- Expected: success (0). Recorded: host exit 0, returned 0, 20 calls.
- The same import as lp01 with `LPDebug`: the preprocessor keeps its temp package, which the host copies off the Windows temp folder into `temp-package/`.
- Rules: LP-030, LP-031, LP-032, LP-034.

## Ids created and deleted

Created 2, all deleted by the cleanup (newest first): PackageDefinition C7D6487E15C349B3806C330498527D20, DatabaseUpgrade 36E1A25524B24420A343B7E07CCD0263.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp04 --force`.
