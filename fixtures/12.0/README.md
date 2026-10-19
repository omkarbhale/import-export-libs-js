# 12.0 fixtures

Recorded from engine 12.0.0.13341 (`Libs.dll` MVID `73656177-…`, ticket 48) on the dev instance, with the same recorders and the same case lists as 14.0.7, so the two engines can be compared case by case.

| Folder | What | Re-record |
|---|---|---|
| [`export/`](export/README.md) | ticket 05's export catalogue and option matrix (read-only), plus the scratch-seeded export cases | `npm run oracle:export-cases -- --engine 12.0`, `npm run oracle:export-scratch-cases -- --engine 12.0` |
| [`import/`](import/README.md) | ticket 05's scratch packages, manifest and file-system cases and option matrix (`LIBSJS-SCRATCH-*` only, cleaned up), plus three cases that exist only for 12.0 | `npm run oracle:import-cases -- --engine 12.0` |
| `xsl/` | `export.xsl` and `build.xsl` run on given documents (ticket 68); `export-items` and `export-fix` are the 14.0.7 sets run again for the engine diffs (ticket 64) | `npm run oracle -- --engine 12.0 xsl …` |

The password arrives through `ARAS_PASSWORD` or stdin. Every import and seed deleted what it created; each case README lists the ids created and deleted.

## Not here

- **A language-pack import.** 12.0 has no `LanguagePackPreprocessor`, so there is no `12.0/language-pack/`; `import-language-pack` refuses on 12.0.
- **The merge of core Forum and Change Controlled Relationship** (R13, R14). Captain decision 2026-10-13, option (a): they are pinned by unit tests on synthetic input and are dev-unexercisable. `fixtures/import-merge/12.0-probe/` holds the offline probe of the 12.0 code.
- **Long and UNC output paths** (R16). 12.0 normalises no path, and the run's folder on dev is short, so no server run reaches the difference. The offline probe is `fixtures/export-write/probe-12.0.txt`.
- **The wire protocol** (R1 to R3, the login dispatch, the version probe and gate). The proxy capture of 12.0's reference host is `fixtures/wire/12.0-reference-host/`.

## Which case pins which variant rule

Rule ids are the spec's (`spec/`); the R-numbers on the import side are the ones in `evidence/libs-12.0-vs-14.0.7-diff.md` that ticket 47 uses.

### Export

| Variant | Rule | Cases |
|---|---|---|
| Float item property recursion scope | EXP-116 | `export/e52-float-item-property` |
| CDATA list (`implementation_query`, `event_data`) | EXP-360, EXP-117 | `export/e31-report-cdata`, `export/s6-dr-family` |
| User `pwd_is_set_on` kept | EXP-315 | `export/e33-user` |
| Change Controlled Relationship Property fix mode | EXP-324 | `export/e08-change-controlled-relationship` |
| `filter_xml`: first occurrence only | EXP-405 | `export/e50-mp-macpolicy`, `export/s6-mac-two-filters` |
| `dr` `implementation_query` not re-indented | EXP-117, EXP-121 | `export/s6-dr-family`, `export/e47-dr-relationshipfamily` |
| No `ac_PolicyAccessItemAttribute` fetch | EXP-118 | `export/s6-ac-attribute` (13 calls; 19 on 14.0.7) |
| Log header and open order, current-culture timestamps | EXP-505, EXP-506 | every export case's `engine.log` |
| The `item.ToString()` faultstring | EXP-516 | `export/e40-workflow-promotion-error-no`, `export/e40-workflow-promotion-error-yes` |
| Levels and select by type | EXP-021 | `export/e53-*`, `export/e14-level-2-ignored` |
| Unknown-package removal | `export-unknown-refs.md` | `export/e06-*` |

### Import

| Variant | Rule | Cases |
|---|---|---|
| R11 `build.xsl` for `ac_PolicyAccessItemAttribute`: every action, in the last bucket | IMP-021, IMP-022 | `import/r11-ac-attribute-actions` (the delete and the purge that 14.0.7 drops are sent) |
| R12 `mp_PromoteItem` dropped | IMP-021 | `import/s4-mp-promote` (14.0.7: the server rejects it and the package fails; 12.0: nothing is sent and it succeeds) |
| R15 `XmlDocument.Load` honours the file's encoding | IMP-007 | `import/r15-latin1-file` (rejected: invalid character in the given encoding), `import/r15-utf16-no-bom` (loaded) |
| R18 an `error` message on every item failure | IMP-427 | the failing cases: `import/s3-unres-*`, `import/s4-del-refused`, `import/s5-sql-id-child`, `import/s9-*`, `import/fs-xml-declaration` |
| Console and log framing, package log not flushed | IMP-421, IMP-422 | every import case's `engine.log` and `host.log` |
| No `tempFullName`, no `File full name` line | IMP-009, IMP-422 | every import case's `engine.log` |

The rule ids in the README of each case are added by the build ticket that pins the case (mapcheck F11).
