# lp05

A requested language the server does not have: `xx`.

- Pack: `lp/ImportConfig.xml` (`languages list="xx"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: ConsoleUpgrade's `lpimport` sequence for package `LIBSJS-SCRATCH-LP`, 16 calls.
- Expected: Nothing qualifies, so no row produces a translation, no Fixes file is written and the import runs on an empty package and succeeds (LP-011). The Language get is still sent. No ItemType lookup or `edit` call follows.
- Server read-back: `verify.json`.
- Rules: LP-011, LP-014, LP-026.
