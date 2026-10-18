# lp06

`Languages` = `de` over a pack that translates `de` and `fr`. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list="de, fr"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP`, `Languages` = `de`.
- Expected: success (0). Recorded: host exit 0, returned 0, 21 calls.
- ConsoleUpgrade's `langs=de` (accepted for `lpimport` without `en`): the skip set is `fr`, so every generated `edit` item is sent without its `fr` elements (IMP-640).
- Rules: IMP-601, IMP-630, IMP-631, IMP-640.

## Ids created and deleted

Created 2, all deleted by the cleanup (newest first): PackageDefinition A2691C103B594A73B9E1878263448D0A, DatabaseUpgrade B2907A45CBCA4770815C4DC1CAE62C43.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp06 --force`.
