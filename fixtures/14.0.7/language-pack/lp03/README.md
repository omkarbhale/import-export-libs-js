# lp03

Two requested languages, with a space after the comma: `de, fr`.

- Pack: `lp/ImportConfig.xml` (`languages list="de, fr"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: ConsoleUpgrade's `lpimport` sequence for package `LIBSJS-SCRATCH-LP`, 20 calls.
- Expected: Both languages are generated (LP-013 trims each part). The `name` property in the pack is dropped by the `label` property list (LP-023, step 2).
- Server read-back: `verify.json`.
- Rules: LP-011, LP-012, LP-013, LP-023.
