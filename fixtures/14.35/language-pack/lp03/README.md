# lp03

`languages list="de, fr"`, and a property the `label` list drops. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list="de, fr"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP`, `Languages` unset.
- Expected: success (0). Recorded: host exit 0, returned 0, 20 calls.
- Both languages are generated (each part is trimmed). The `name` property in the pack is dropped by the `label` property list.
- Rules: LP-011, LP-013, LP-023.

## Ids created and deleted

Created 2, all deleted by the cleanup (newest first): PackageDefinition C126F88E951B4BBFBFFC5C6A2966853C, DatabaseUpgrade 8199766553224429B0A70CE057DB0817.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp03 --force`.
