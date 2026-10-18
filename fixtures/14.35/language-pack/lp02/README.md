# lp02

`languages list="de"`. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list="de"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP`, `Languages` unset.
- Expected: success (0). Recorded: host exit 0, returned 0, 20 calls.
- Only `de` is requested: the generated `edit` items carry the `de` labels only.
- Rules: LP-011, LP-014, LP-024.

## Ids created and deleted

Created 2, all deleted by the cleanup (newest first): PackageDefinition CA1DFF4A60D449C68FF17F9D65B239F3, DatabaseUpgrade B0BA26BB8E9D4735B6E48EFA9B3D319B.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp02 --force`.
