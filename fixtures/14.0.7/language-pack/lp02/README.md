# lp02

One requested language: `de`.

- Pack: `lp/ImportConfig.xml` (`languages list="de"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: ConsoleUpgrade's `lpimport` sequence for package `LIBSJS-SCRATCH-LP`, 20 calls.
- Expected: Only `de` elements are generated. The `fr` values in the pack are not applied.
- Server read-back: `verify.json`.
- Rules: LP-011, LP-014, LP-023.
