# 14.35 import fixtures

Recorded from engine 14.35.0.43890 on the dev instance, from ticket 05's scratch packages (S1 to S5, S8, S9), its manifest and file-system cases and its import option matrix. Every import used `LIBSJS-SCRATCH-*` packages and items only, and deleted what it created; each case README lists the ids created and deleted.

- **The shared catalogue.** The cases of ticket 05 that `fixtures/14.0.7/import/` holds run again on 14.35 with the same packages, so the engines compare case by case. Where 14.35 ends a case differently the README says so (`s0-mini-cancel`: the package fails with status 2 and the run returns 1).
- **The 14.35 cases** (tickets 53, 55 and 73): `cui-order` (the `build.xsl` groups of `cui_Control` and `cui_WindowSection`), `delayed-*` (the de-duplicated delayed entry and the Property edit addressed by `where`), `lang-*` (the `Languages` selection: unset, one code, `*`, a code the server lacks, and the scan of every `*.xml` of a package), `batch-*` (the AML batch mode) and `collect-*` (the collected-errors mode), on ticket 05's S9 shape. The packages are in `oracle/src/import-packages-14.35.ts`.
- **Dev languages.** A `lang-*` case whose README has a *Dev state* section ran with those `Language` items on dev: `en` only, or `en`, `de` and `fr` while the language-pack cases ran. Dev has `en` only again.
- The server sometimes fails a request for reasons of its own (a deadlock victim, a foreign key race right after the previous case's cleanup). The recorder refuses a run whose outcome is not the case's, so such a run was repeated and only the repeat is committed.
- A case is one or more runs (`step-<n>/`). A step keeps what it created for the next step; the last step, or the recorder if a step fails, deletes everything. Each case starts from and ends at a dev instance without scratch data.
- The packages are built by `oracle/src/import-packages.ts`, so a case can be rebuilt byte for byte. Each step's `input/` holds what the engine read.
- Names follow `LIBSJS-SCRATCH-*`; ItemType and SQL names, which Aras restricts to word characters, use `LIBSJS_SCRATCH_*`.
- A response of 64 KB or more is stored once in `_blobs/` and named by `responseBlob` in the transcript. Every import begins with the list of all PackageDefinitions (about 2.7 MB), which differs between steps because the earlier steps' scratch packages are in it. `oracle/src/transcript.ts` puts the blobs back.
- Not here: the 12.0 variants (ticket 48), and the merge of core Forum and Change Controlled Relationship (captain decision 2026-10-13, option (a): rules R13 and R14 are pinned by unit tests on synthetic input and are not exercisable on dev). The language-pack imports are in `fixtures/14.35/language-pack/`.
- The dev state a case ran against can change. `run.json` carries the time of each run.
- Re-record with `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35` (see `npm run oracle:import-cases -- --engine 14.35 --help`).

| Case | Catalogue | What | Steps | Calls | Created |
|---|---|---|---|---|---|
| [s0-mini-defaults](s0-mini-defaults/README.md) | S0, release/description unset | Six small items, every option at the engine default | 1 | 55 | 17 |
| [s0-mini-merge](s0-mini-merge/README.md) | S0, merge on | The same package with merge on, when nothing exists yet | 1 | 58 | 17 |
| [s0-mini-release-description](s0-mini-release-description/README.md) | S0, release/description both set | Release and Description both set | 1 | 55 | 17 |
| [s0-mini-release-only](s0-mini-release-only/README.md) | S0, release only | Release set, Description left null | 1 | 55 | 17 |
| [s0-mini-release-upsert](s0-mini-release-upsert/README.md) | S0, DatabaseUpgrade upsert | The same release run twice, then a new release | 3 | 155 | 18 |
| [s0-mini-locked-row](s0-mini-locked-row/README.md) | S0, DatabaseUpgrade row locked | A re-import when the package's DatabaseUpgrade row is locked | 2 | 108 | 17 |
| [s0-mini-fast-vault](s0-mini-fast-vault/README.md) | S0, bFast, bVault | Fast and Vault both set | 1 | 55 | 17 |
| [s0-mini-verbose](s0-mini-verbose/README.md) | S0, Verbose | Verbose console output | 1 | 55 | 17 |
| [s0-mini-cancel](s0-mini-cancel/README.md) | S0, cancel | Cancel pressed after the fourth status message | 1 | 29 | 7 |
| [s1-base](s1-base/README.md) | S1 | One item per build.xsl bucket, fresh import | 1 | 213 | 56 |
| [s1-base-merge](s1-base-merge/README.md) | S1, merge on | S1 with merge on, when nothing exists yet | 1 | 246 | 56 |
| [s1-reimport](s1-reimport/README.md) | S1, merge off/on | S1 imported, then re-imported with merge off and with merge on | 3 | 534 | 56 |
| [s1-method-generation](s1-method-generation/README.md) | S1, versionable | A versionable Method re-imported after it got a second generation | 2 | 454 | 57 |
| [s1-instances-versionable](s1-instances-versionable/README.md) | S1, ProcessVersionableItem | Instances of a versionable ItemType with a relationship, re-imported | 4 | 365 | 65 |
| [s2-ref-both](s2-ref-both/README.md) | S2 | A package and the package it depends on, imported together | 1 | 51 | 13 |
| [s2-ref-only](s2-ref-only/README.md) | S2 | A package imported without the package it depends on | 1 | 31 | 7 |
| [s2-ref-dep-present](s2-ref-dep-present/README.md) | S2 | A package imported after its dependency was imported earlier | 2 | 58 | 13 |
| [s3-unres-delayed](s3-unres-delayed/README.md) | S3 | References that resolve once the package is imported | 1 | 47 | 12 |
| [s3-unres-nested-get-code0](s3-unres-nested-get-code0/README.md) | S3 | A nested get that finds nothing, under an unlisted parent | 1 | 20 | 2 |
| [s3-unres-reltype-nested](s3-unres-reltype-nested/README.md) | S3 | A RelationshipType whose source and related ItemTypes are nested gets that find nothing | 1 | 21 | 2 |
| [s4-del](s4-del/README.md) | S4 | Delete actions against items an earlier import created | 2 | 227 | 2 |
| [s4-del-missing](s4-del-missing/README.md) | S4 | A delete of an item that does not exist | 1 | 17 | 2 |
| [s4-del-refused](s4-del-refused/README.md) | S4 | A delete the server refuses | 2 | 265 | 58 |
| [s4-mp-promote](s4-mp-promote/README.md) | S4, R12 | An mp_PromoteItem action on an mp_MacPolicy | 1 | 18 | 2 |
| [s5-sql](s5-sql/README.md) | S5 | A SQL item imported twice | 2 | 45 | 5 |
| [s5-sql-id-child](s5-sql-id-child/README.md) | S5 | A SQL item whose id is only a child element | 1 | 15 | 2 |
| [s8-coll-distinct](s8-coll-distinct/README.md) | S8 | Two packages whose names end in the same segment | 1 | 38 | 10 |
| [s8-coll-duplicate](s8-coll-duplicate/README.md) | S8 | The same item in two packages | 1 | 36 | 8 |
| [s9-batch-bad-relation](s9-batch-bad-relation/README.md) | S9 | The fourth of seven items fails the engine's own check | 1 | 34 | 9 |
| [s9-batch-server-failure](s9-batch-server-failure/README.md) | S9 | The fourth of seven items fails on the server | 1 | 34 | 9 |
| [s9-batch-fatal-reltype](s9-batch-fatal-reltype/README.md) | S9 | A RelationshipType whose source ItemType does not exist | 1 | 32 | 7 |
| [man-cycle](man-cycle/README.md) | manifest | Two packages that depend on each other | 1 | 42 | 12 |
| [man-absent-dependency](man-absent-dependency/README.md) | manifest, P2 | A dependency on a package that exists nowhere | 1 | 26 | 6 |
| [man-duplicate-requested](man-duplicate-requested/README.md) | manifest | The same package requested twice | 1 | 7 | 0 |
| [man-unknown-package](man-unknown-package/README.md) | manifest | A requested package that the manifest does not list | 1 | 13 | 1 |
| [fs-odd-files](fs-odd-files/README.md) | file system | Files the loader treats specially | 1 | 32 | 9 |
| [fs-xml-declaration](fs-xml-declaration/README.md) | file system | An item file that starts with an XML declaration | 1 | 13 | 1 |
| [cui-order](cui-order/README.md) | 14.35, build.xsl | cui_Control and cui_WindowSection items among others | 1 | 77 | 24 |
| [delayed-duplicate](delayed-duplicate/README.md) | 14.35, delayed | The same delayed entry from two files | 1 | 35 | 7 |
| [delayed-property-where](delayed-property-where/README.md) | 14.35, delayed | A Property with no id but a where, whose data_source resolves later | 1 | 31 | 7 |
| [lang-unset](lang-unset/README.md) | 14.35, Languages unset | A package with en and de labels, Languages unset | 1 | 25 | 5 |
| [lang-select-en](lang-select-en/README.md) | 14.35, Languages one code | Languages = en over a package with en and de labels | 1 | 26 | 5 |
| [lang-star-en-only](lang-star-en-only/README.md) | 14.35, Languages * | Languages = * over a package that uses en only | 1 | 26 | 5 |
| [lang-not-installed](lang-not-installed/README.md) | 14.35, Languages not installed | Languages = xx, a code the server lacks | 1 | 8 | 0 |
| [lang-star-not-installed](lang-star-not-installed/README.md) | 14.35, Languages *, Languages not installed | Languages = * over a package that uses a language the server lacks | 1 | 8 | 0 |
| [lang-scan-stray-file](lang-scan-stray-file/README.md) | 14.35, scan | A malformed file in the package folder, Languages unset | 1 | 6 | 0 |
| [lang-apostrophe](lang-apostrophe/README.md) | 14.35, bug | A used language code with an apostrophe | 1 | 20 | 2 |
| [lang-on-item-element](lang-on-item-element/README.md) | 14.35, bug | A skipped language on the Item element itself | 1 | 19 | 2 |
| [lang-select-de](lang-select-de/README.md) | 14.35, Languages one code | Languages = de over a package with en, de and fr labels | 1 | 26 | 5 |
| [lang-star-installed](lang-star-installed/README.md) | 14.35, Languages * | Languages = * over a package with en, de and fr labels | 1 | 26 | 5 |
| [lang-unset-installed](lang-unset-installed/README.md) | 14.35, Languages unset | A package with en, de and fr labels, Languages unset, all installed | 1 | 25 | 5 |
| [lang-two-packages](lang-two-packages/README.md) | 14.35, Languages one code | Two packages cut with their own skip sets | 1 | 40 | 10 |
| [lang-batch-select](lang-batch-select/README.md) | 14.35, Languages one code, AML batch | Languages = de in AML batch mode | 1 | 27 | 5 |
| [batch-size-3](batch-size-3/README.md) | S9, 14.35, AML batch | Seven items in batches of three | 1 | 44 | 17 |
| [batch-size-unset](batch-size-unset/README.md) | S9, 14.35, AML batch | AML batch mode with AmlBatchMaxSize left at 0 | 1 | 49 | 17 |
| [batch-merge-reimport](batch-merge-reimport/README.md) | S9, 14.35, AML batch | A batch re-imported with merge on | 2 | 80 | 17 |
| [batch-skip-existing](batch-skip-existing/README.md) | S9, 14.35, AML batch | A batch re-imported with merge off | 2 | 72 | 17 |
| [batch-relationships](batch-relationships/README.md) | S0, 14.35, AML batch | Items with Relationships among items without | 1 | 53 | 17 |
| [batch-server-failure](batch-server-failure/README.md) | S9, 14.35, AML batch | A batch the server refuses at the fourth item | 1 | 38 | 9 |
| [batch-check-fails](batch-check-fails/README.md) | S9, 14.35, AML batch | The fourth item fails the engine's own check in batch mode | 1 | 34 | 9 |
| [batch-fatal-reltype](batch-fatal-reltype/README.md) | S9, 14.35, AML batch | A RelationshipType whose source ItemType does not exist, in batch mode | 1 | 32 | 7 |
| [batch-cancel](batch-cancel/README.md) | S0, 14.35, AML batch | Cancel pressed with items waiting in the batch queue | 1 | 29 | 7 |
| [batch-delete-missing](batch-delete-missing/README.md) | S4, 14.35, AML batch | A delete of an item that does not exist, in batch mode | 1 | 17 | 2 |
| [collect-server-failure](collect-server-failure/README.md) | S9, 14.35, collected errors | One item the server refuses, errors collected up to 5 | 1 | 48 | 16 |
| [collect-max-unset](collect-max-unset/README.md) | S9, 14.35, collected errors | Collected errors with the maximum left at 0 | 1 | 34 | 9 |
| [collect-two-errors-max3](collect-two-errors-max3/README.md) | S9, 14.35, collected errors | Two failing items, maximum 3 | 1 | 48 | 15 |
| [collect-two-errors-max2](collect-two-errors-max2/README.md) | S9, 14.35, collected errors | Two failing items, maximum 2 | 1 | 38 | 10 |
| [collect-two-packages](collect-two-packages/README.md) | S9, 14.35, collected errors | A failing package followed by a good one | 1 | 86 | 33 |
| [collect-bad-check](collect-bad-check/README.md) | S9, 14.35, collected errors | An item whose reference check fails | 1 | 49 | 16 |
| [collect-cancel](collect-cancel/README.md) | S0, 14.35, collected errors | Cancel with collection on and nothing collected | 1 | 29 | 7 |
| [batch-collect-fallback](batch-collect-fallback/README.md) | S9, 14.35, AML batch, collected errors | A refused batch with collection on | 1 | 38 | 9 |
