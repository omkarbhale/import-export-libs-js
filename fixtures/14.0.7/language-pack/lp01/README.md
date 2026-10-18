# lp01

All languages: no `languages` element value, so every server language but `en` is used.

- Pack: `lp/ImportConfig.xml` (`languages list=""`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: ConsoleUpgrade's `lpimport` sequence for package `LIBSJS-SCRATCH-LP`, 20 calls.
- Expected: Fixes/Forum.xml has two `edit` items, each with `de` then `fr` labels (server order: de, en, fr).
- Server read-back: `verify.json`.
- Rules: LP-011, LP-014, LP-015, LP-023 to LP-027, LP-029, LP-032, LP-034.
