# The CLI export: item selection and package membership

This document specifies the `export` command of `aras-pkg`: how it takes the items to export, how it finds the package each one belongs to, what it hands the engine, and when it refuses. Unlike the other area documents it does not describe the engine. `ImportExportManager.ExportSolutions` takes a ready table of package names to items (EXP-500) and leaves the building of that table to its host. This document is that host. Its rules use the prefix `HOST-` (ids `HOST-001` to `HOST-099`; `HOST-100` to `HOST-199` belong to the console export modes of ticket 66).

Sources:

- the reference for the resolution is the export path of aras-harness (`src/mcp/tools.ts`, `resolveItemPackages`, and `scripts/export.ps1`), which walks `PackageElement` → `PackageGroup` → `PackageDefinition` in batched reads and fills the engine's table the way HOST-020 describes (round 2, Q4). The engine's own console tool takes its items from a manifest or a package list instead, and is the subject of ticket 66;
- the recommendation of ticket 07 (the `Hashtable` research) that a host pins the order of its insertions, because the enumeration order of the table decides the order of packages, items, log lines and `imports.mf` (EXP-508, EXP-514);
- reads of the `dev` instance (12.0 SP9) of the `PackageElement`, `PackageGroup` and `PackageDefinition` items, which the request shapes below rest on. They are reads only and free.

None of the reads in this document is engine behaviour. They are this tool's own logic, so unlike the `EXP-` rules they escape every value they put into AML (AGENTS.md rule 7 concerns the engine's interpolations only). The engine's own requests, and the unescaped interpolation of package and item names in them, are reproduced as the `EXP-` rules specify.

Conventions: **an item** is a pair of an ItemType name and an id. **The table** is the `selItemsTable` of EXP-500. **An id** is compared case-insensitively where this document matches an answer to a request, and is passed to the engine as the user wrote it.

## The command line

### HOST-001: export takes an output folder and the items to export

[14.0.7] `aras-pkg export <outDir> [Type:id…] [options]`. The output folder is the first argument and is required. The items come from exactly one of three sources:

- **arguments**: every argument after the output folder is one item (HOST-002);
- **standard input**: the single argument `-` stands for the items on standard input, one per line (HOST-003);
- **packages**: `--package <name>`, repeatable, stands for every element of the named packages (HOST-004, HOST-015);
- **a console mode**: `--use-import <manifest>`, `--from-manifest <manifest>` or `--all-packages` choose what to export the way Aras's console tool does, and build the table themselves (HOST-100 in `export-modes.md`).

Giving none of the sources, or more than one of them, is a usage error (exit 64): `export needs the items to export: …`. A second `-`, or `-` together with items, is the same error. `--help` prints the usage and exits 0.

[12.0] Same command line.

[14.35] Same.

### HOST-002: an item is written Type:id

[14.0.7] An item is `Type:id`. The text is split at its **first** colon, so an ItemType name cannot contain one and an id can. Both parts are required and are checked before anything is sent:

- the type must not be empty, must not start or end with white space and must not contain a control character or any of `<`, `>`, `&`, `"` and `'`;
- the id must be made only of the letters `A`–`Z` and `a`–`z`, the digits, `_` and `-` (Aras ids are 32 hexadecimal digits; this is the alphabet an `idlist` can carry unchanged, and it is the only check on the form of an id).

A text that fails is a usage error that names it: `'<text>' is not Type:id` or the specific reason. Two items with the same id and a different type are a usage error as well, because the engine's inner table is keyed by id (HOST-020). The same item given twice is allowed and exported once (HOST-020).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-003: items on standard input, one per line

[14.0.7] With `-`, the whole of standard input is read after the arguments have been checked and before any request. Each line is one item (HOST-002). A trailing `\r` is removed, a line that is empty after trimming white space is skipped, and the line's surrounding white space is trimmed. A line that fails HOST-002 is a usage error naming the line number. No line at all is the usage error of HOST-001.

Standard input can serve only one purpose. `-` together with `--password-stdin` is a usage error (the password is read from standard input, WIRE-002).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-004: --package names whole packages

[14.0.7] `--package <name>` is repeatable. Each name is the name of a PackageDefinition, taken as written (no trimming; an empty name is a usage error). A name given twice is a usage error, as for `import`. `--package` cannot be combined with items or with `-` (HOST-001). The packages are looked up on the server (HOST-015), so an unknown name is found only then.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-005: local checks come before any server call

[14.0.7] The command makes these checks, in this order, before it reads standard input for a password, logs in or sends anything. The first failure ends the command, with exit 64 unless noted:

1. the arguments parse (an unknown option, a missing option value);
2. `--help`, which prints the usage and exits 0;
3. `--engine` (or `ARAS_PKG_ENGINE`) names an engine;
4. the output folder is given and usable (HOST-006);
5. the items come from exactly one source and are well formed (HOST-001 to HOST-004); standard input is read here;
6. the export options (HOST-007);
7. the engine has an export (HOST-008; every engine has one now, so this refuses nothing, and an engine without one would be reported as *not yet supported* with exit 1), and the language-resource flags are valid for it (HOST-031);
8. the connection settings (`--url`, `--database`, `--user`, the password, `--timeout`), and the log path (its folder is made, as for the other commands).

Nothing about the output folder's contents is checked. A folder that already holds files is not refused, and the engine's own handling of its package folders is reproduced and not pre-empted (HOST-006).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-006: the output folder is the engine's working directory, used as it is

[14.0.7] The output folder becomes the `WorkingDirectory` of the run, as an absolute path (a relative one is resolved against the current directory), so the engine's log header names it in full. The engine makes the folder and any missing parents itself, deletes each exported package's own subfolder recursively before writing it (EXP-415) and writes `imports.mf` into the folder (EXP-511). The command adds nothing to this: it does not require the folder to exist or to be empty, and a folder that already holds an earlier export keeps whatever the engine does not wipe, including the last-segment collision of EXP-414. The command does not remove files either.

The only check is that the path can be a folder: it is not empty, has no NUL character, and the nearest part of it that exists is a directory (a path through an existing file is a usage error). A folder that cannot be made after that fails in the engine and is reported as the run's failure.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-007: the export options are flags

[14.0.7] Each setting of `SUExportContext` (EXP-501) that a host chooses is a flag:

| Flag | Setting | Default |
|---|---|---|
| `--level <text>` | `sLevel`, the `levels` of types without a fixed one (EXP-022). Passed as written, not parsed. | none (the engine uses `1`) |
| `--export-referenced` | `bExportReferencedItems`, the second pass of EXP-519. | off |
| `--unknown-references <mode>` | `RefToUnknownPacks`: `remove-silently`, `remove-with-warning` or `do-not-remove` (EXP-501, EXP-600). | `do-not-remove`, the setting both reference hosts make |
| `--on-item-error <answer>` | the host's answer to the error question (EXP-516): `continue` or `abort-package`. | `continue`, the answer of the reference hosts |

A value outside the list is a usage error. `--verbose` is accepted and recorded in the context like the other commands do; export does not read it. The common options (`--url`, `--database`, `--user`, `--password-stdin`, `--engine`, `--log`, `--timeout`, `--time-zone`, `--skip-version-check`, `--json`) are those of the other commands. `UseImport` is not an option of this command: `--use-import` sets it (HOST-102).

[12.0] Same as 14.0.7.

[14.35] `--on-item-error` is a usage error when it is given: the engine stops the whole export at the first failed item and does not read the answer (EXP-555, EXP-571). The other flags are the same. Three flags are added: `--language-resources` and `--languages` (HOST-031), and `--parallelism <n>`, the number of items of a package that are exported at once (EXP-551): an integer of 1 or more, default one per logical processor (`os.availableParallelism()`). The engine sets no bound of its own, so the flag is the port's way to bound it. The engine's races (EXP-408, EXP-553) depend on it: with `1` the items run one after another and no race can happen. On engines 12.0 and 14.0.7, which export one item at a time, the flag is a usage error naming the engine.

### HOST-008: the engines that have an export

[14.0.7] The command runs on `14.0.7`, and on the other engines too, now that their export slices have landed.

[12.0] The command runs as for 14.0.7 (the 12.0 export slice, wayfinder ticket 49, is built), `--use-import` included now that the 12.0 loading of package folders is (wayfinder ticket 50, HOST-113).

[14.35] The command runs as for 14.0.7. The items of a package are exported in parallel (EXP-551), by as many workers as `--parallelism` says, one per logical processor by default (HOST-007). The language-resource modes are chosen with `--language-resources` (HOST-031).

### HOST-009: the host sequence and the exit code

[14.0.7] After the local checks the command does what the engine's hosts do (WIRE-002, EXP-502), with the selection built by HOST-010 to HOST-022 between the login and the export:

1. the context: `Action` is `Export`, the connection settings, `WorkingDirectory`, the log file, the timeout and the export settings (HOST-007);
2. the connection and the helper, and the login with the version probe and gate (WIRE-002);
3. the selection is resolved (HOST-010 to HOST-016; the console modes build the manager first and ask it for the table, HOST-102). A refusal ends the run here: the engine is not built, the output folder is not touched and the log is not opened;
4. the manager is built and `ExportSolutions(exportContext, selItemsTable)` runs (EXP-500). The engine's messages go to standard error as `[PKG]`, `[INFO]`, `[WARN]` and `[ERROR]` lines;
5. logout, whatever happened in steps 3 and 4.

The exit code is 0 when the engine sent no `error` message and no exception left the run, 2 when the run ended normally and the engine sent `error` messages (EXP-507), and 1 when the selection was refused, the login failed, or an exception left the run (for example EXP-542). A refusal and a failure each print the summary of HOST-030 with the reason.

[12.0] Same sequence.

[14.35] Same sequence.

## Package membership

### HOST-010: an item's package is found by walking PackageElement, PackageGroup and PackageDefinition

[14.0.7] Items given as `Type:id` are looked up in four passes, each in batches of at most 200 values, in this order. Every request is sent with `applyAML` (WIRE-006) on the logged-in helper, and the answer of a request that finds nothing (a fault with faultcode `0`) is an empty result, not an error. Any other fault ends the command as a failure (exit 1). Values are escaped for AML (`&`, `<`, `>` in text; also `"` in an attribute), and values in a SQL list are quoted `'…'` with `'` doubled.

1. **config ids and keyed names** (HOST-011), per ItemType;
2. **PackageElement → PackageGroup** (HOST-012);
3. **PackageGroup → PackageDefinition** (HOST-013);
4. **PackageDefinition → name** (HOST-013).

The passes cover the whole input, so the number of requests depends on the number of distinct types and batches and not on the number of items. The order of the requests is fixed: types in the order they first appear among the items; within a pass the batches in the order their first value appears; a batch holds the distinct values in order of first appearance.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-011: the first pass reads the config id and the keyed name of each item

[14.0.7] For each ItemType in turn, and each batch of its distinct ids:

```xml
<Item type="{type}" action="get" select="config_id,keyed_name" idlist="{id1,id2,…}"/>
```

Each answer row is matched to a requested id by its `id` attribute, ignoring case. For a matched item:

- the config id is the text of its `config_id`, or, when the row has none (the type is not versionable), the id of the row. A `PackageElement` records the config id of a versionable item and the id of any other;
- the keyed name is the text of its `keyed_name`, or the id as the user wrote it when that is absent or only white space (the reference host does the same, and the engine names the file of an empty keyed name by the id: EXP-002).

A requested id with no row is **not found**: the item does not exist on the server, or its type does not, or the user cannot read it. A server fault other than faultcode `0` for a type that does not exist is the failure of HOST-010.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-012: the second pass finds the group of each config id

[14.0.7] For each batch of the distinct config ids of the found items:

```xml
<Item type="PackageElement" action="get" select="element_id,source_id"><element_id condition="in">'{c1}','{c2}',…</element_id></Item>
```

`source_id` of a `PackageElement` is the id of its `PackageGroup`. Each row maps its `element_id` (compared ignoring case) to that group; when the answer holds several rows for one element id the **first in document order** wins, and a row with an empty `source_id` leaves the item without a package.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-013: the third and fourth passes find the group's package and its name

[14.0.7] For each batch of the distinct group ids found, then each batch of the distinct definition ids found:

```xml
<Item type="PackageGroup" action="get" select="source_id" idlist="{g1,g2,…}"/>
<Item type="PackageDefinition" action="get" select="name" idlist="{d1,d2,…}"/>
```

`source_id` of a `PackageGroup` is the id of its `PackageDefinition`. An item's package name is the `name` of that definition. A group, a definition or a name that is missing along the way leaves the item without a package.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-014: items that cannot be exported are refused by name, and nothing is exported

[14.0.7] When the passes are done, the items are checked in the order they were given. An item that was not found (HOST-011) or has no package (HOST-012, HOST-013) cannot be exported, because the engine takes an item only under a package. The command then exports **nothing**: it refuses the whole selection, writes one `[ERROR]` line per kind to standard error and ends with exit 1.

```text
[ERROR] Export refused: 2 item(s) belong to no package: ItemType "Part" (A1B2…), Method "my_method" (C3D4…). Add them to a PackageDefinition first.
[ERROR] Export refused: 1 item(s) were not found: Method E5F6…
```

The first line names each item as `Type "keyed name" (id)`; the second as `Type id`. Both lines are printed when both kinds occur, the first first. The items are listed in the order they were given, and a repeated item once. The summary of HOST-030 carries the same lists (`noPackage`, `notFound`).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-015: --package finds the named packages, and suggests names for a mistyped one

[14.0.7] The packages are looked up with one request that lists the definitions of the database:

```xml
<Item type="PackageDefinition" action="get" select="name"/>
```

A requested name is **known** when a row's `name` equals it exactly (ordinal, case-sensitive: package names are matched exactly by every other part of the engine and by the folders of an import). An unknown name refuses the whole selection with exit 1 and nothing exported:

```text
[ERROR] Export refused: there is no package 'com.aras.innovator.corre'. Did you mean 'com.aras.innovator.core'?
```

One line per unknown name, in the order they were given. The suggestions are the known names whose edit distance (Levenshtein, ignoring case) from the requested name is at most the larger of 2 and a tenth of its length (rounded up), or one of which contains the other (ignoring case); closest first, ties by ordinal name, at most three, written `Did you mean 'a', 'b' or 'c'?`. With none, the line ends after the name.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-016: a named package gives its elements as the items

[14.0.7] For each known package, in the order given, one request reads its elements:

```xml
<Item type="PackageElement" action="get" select="name,element_id,element_type"><source_id><Item type="PackageGroup" action="get"><source_id>{definition id}</source_id></Item></source_id></Item>
```

where the definition id is the `id` attribute of the row HOST-015 matched. The sub-query selects the `PackageElement` rows whose group belongs to the package. The elements are the package's items: `name` is the keyed name, `element_id` the id the engine is asked for (the config id of a versionable item, which the engine resolves, EXP-011) and `element_type` the ItemType. A row without an `element_id` or an `element_type` is skipped. The elements are put in the order of HOST-021.

A package with no element contributes nothing and the command warns `[WARN] package 'x' has no elements`. When no package has an element the selection is refused (the warnings are still printed first): `[ERROR] Export refused: the named packages have no elements.` (exit 1).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## The table the engine is given

### HOST-020: items fill the table in the order they were given

[14.0.7] The engine's table is a `Hashtable` of package name to a `Hashtable` of item (EXP-500). Its enumeration order, which decides the order of packages and items in the run, the log, the messages and `imports.mf`, comes from the sequence of insertions (EXP-508, EXP-514; ticket 07 found 48 of 55 dev packages reorder when the sequence is reversed), so the sequence is pinned. For `Type:id` items the sequence is that of the reference host:

1. the items are taken in the order given (arguments left to right, or standard input top to bottom);
2. for each item, its package is added to the outer table when it is not there yet (`table[package] = new Hashtable()` on the first item of the package, `Add`);
3. the item is stored in the package's inner table under its id, as the user wrote it, with the indexer (`inner[id] = item`). An item given again keeps the place of its first insertion and takes the later `ExportItem` (which is the same by HOST-022).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-021: a named package's elements fill its table in a fixed order

[14.0.7] The packages are added in the order of the `--package` flags, each with all its elements, so a package's inner table is complete before the next package is added. The elements of a package are stored under their `element_id` with the indexer, in the **ordinal** order of `element_type`, then of `element_id` (compared as UTF-16 code units, case-sensitive). The command sorts them itself so that the insertion sequence does not depend on the order in which the server answers.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### HOST-022: the engine's item is built from the keyed name, the id and the type

[14.0.7] `new ExportItem(keyedName, idName, typeName)` (EXP-002): for `Type:id` items the keyed name of HOST-011, the id as the user wrote it, and the type as the user wrote it; for the elements of a package the `name`, `element_id` and `element_type` of HOST-016, each as the server sent it. The id is not changed to a config id: the engine resolves it (EXP-011).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## The result

### HOST-030: the summary

[14.0.7] The summary on standard output (text, or the same facts as JSON with `--json`) holds: `command` (`export`), `engine`, `result` (`success`, `completed with engine errors`, `refused` or `failed`), `exitCode`, `url`, `database`, `user`, `server`, `outDir` (absolute), `source` (`items`, `stdin`, `packages`, `use-import`, `from-manifest` or `all-packages`; HOST-130 gives the packages of the last three), `packages` (name and number of items, in the table's order of insertion), `items` (the total), `noPackage` and `notFound` (HOST-014, only when refused), the log path, the message counts and the error text of a failure.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## Language-resource export (14.35)

### HOST-031: --language-resources and --languages choose the language modes

[14.0.7] Neither flag exists: engines 12.0 and 14.0.7 have no language-resource export (LP-100), and either flag is a usage error naming the engine.

[12.0] Same as 14.0.7.

[14.35] The two modes of LP-100 are chosen as `ConsoleUpgrade.exe` chooses them (LP-101), with the same checks, made before the server is contacted:

| Flag | Setting |
|---|---|
| `--language-resources only` | the context's `Action` is `ExportLanguageResourcesOnly`, the host's `export-only-translations` |
| `--language-resources with-metadata` | `Action` is `ExportMetadataWithLanguageResources`, the host's `export-with-translations` |
| `--languages <codes\|*>` | the context's `Languages`, the host's `langs=`: the text split on `,`, empty entries dropped, exact duplicates removed, nothing trimmed (LP-101) |

- Any other value of `--language-resources` is a usage error. Without the flag, `Action` is `Export`.
- A language mode with no `--languages` is a usage error: the host ends the run with `'langs' list can't be empty` (LP-101), and a list that is empty after the split is refused the same way.
- `--languages` may also be given without `--language-resources`: the action stays `Export` and the engine only checks that each language is installed (LP-110, LP-114).
- A list that is not empty, does not start with `*` and has no `en` (compared ignoring case) is a usage error, as the host's `'en' language is required` (LP-101). A list that starts with `*` is never checked, so `*,de` is accepted and left to the engine (LP-111).
- The list is passed to the engine unchanged; the engine resolves `*`, drops `en`, and refuses a language the server does not have (LP-110 to LP-115). A refusal there is the run's failure, exit 1.
- The command does not restrict the modes by the source of the items (HOST-001, HOST-100): it sets `Action` and `Languages` in the context before the manager is built, whatever builds the table.
