# lp04

`--lp-debug`: the temp package is kept after the import.

- Pack: `lp/ImportConfig.xml` (`languages list=""`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: ConsoleUpgrade's `lpimport` sequence for package `LIBSJS-SCRATCH-LP`, 20 calls.
- Expected: Same import as lp01 with `LPDebug`. `temp-package/` is the retained `LanguagePack_<random>` folder (imports.mf and the Fixes file), copied off the Windows temp folder and then deleted there.
- Server read-back: `verify.json`.
- Rules: LP-030 to LP-032, LP-034.
