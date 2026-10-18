# lp08

a package name with a dot. Engine 14.35, `lpimport` (ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest), recorded on dev against the scratch Forums of `setup.aml`.

- Pack: `lp/ImportConfig.xml` (`languages list="de"`, `Forum` properties list `label`) and `lp/xml/Forum.xml` (two scratch `Forum` items, `en`/`de`/`fr` labels).
- Engine call: package `LIBSJS-SCRATCH-LP.Dot`, `Languages` unset.
- Expected: constructor refused (exception). Recorded: host exit 2, returned exception, 7 calls.
- The host ended with an exception: `System.IO.DirectoryNotFoundException: Could not find a part of the path 'C:\Users\omkarb\AppData\Local\Temp\LanguagePack_gu3a3hu0.2sw\Dot\Import'.`
- The preprocessor writes its fixes where LP-033 says, the manifest points elsewhere, and the folder the 14.35 scan lists does not exist: `DirectoryNotFoundException` ends the constructor, so the run ends with an exception and no return code (14.0.7 failed later, inside the import).
- Rules: LP-033, IMP-612, IMP-640.

## Ids created and deleted

Created nothing.

Re-record: `ARAS_PASSWORD=… npm run oracle:lp-cases -- --only lp08 --force`.
