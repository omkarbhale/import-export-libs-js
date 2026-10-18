# lp07

`Languages` = `*` over a pack that translates `de` and `fr`. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list="de, fr"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP`, `Languages` = `*`.
- Expected: success (0). Recorded: host exit 0, returned 0, 21 calls.
- `*` expands to the languages the generated package uses, `de` and `fr` (never `en`, which the preprocessor leaves out); both are installed, so nothing is deleted.
- Rules: IMP-620, IMP-621, IMP-640.

## Ids created and deleted

Created 2, all deleted by the cleanup (newest first): PackageDefinition 4E36C5BC41814B3BA053942EC0287BD3, DatabaseUpgrade 8F0A1658B2F348C1A17DB8E70A51E6C4.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp07 --force`.
