# 14.0.7 import fixtures

Recorded from engine 14.0.7.35492 on the dev instance, from ticket 05's scratch packages (S1 to S5, S8, S9), its manifest and file-system cases and its import option matrix. Every import used `LIBSJS-SCRATCH-*` packages and items only, and deleted what it created; each case README lists the ids created and deleted.

- A case is one or more runs (`step-<n>/`). A step keeps what it created for the next step; the last step, or the recorder if a step fails, deletes everything. Each case starts from and ends at a dev instance without scratch data.
- The packages are built by `oracle/src/import-packages.ts`, so a case can be rebuilt byte for byte. Each step's `input/` holds what the engine read.
- Names follow `LIBSJS-SCRATCH-*`; ItemType and SQL names, which Aras restricts to word characters, use `LIBSJS_SCRATCH_*`.
- A response of 64 KB or more is stored once in `_blobs/` and named by `responseBlob` in the transcript. Every import begins with the list of all PackageDefinitions (about 2.7 MB), which differs between steps because the earlier steps' scratch packages are in it. `oracle/src/transcript.ts` puts the blobs back.
- Not here: the language-pack import (ticket 45), the 14.35 batch and collected-errors modes (ticket 57), the 12.0 variants (ticket 48), the scratch-seeded export cases (S6, S7 and the export side of S2 and S8; ticket 67), and the merge of core Forum and Change Controlled Relationship (captain decision 2026-10-13, option (a): rules R13 and R14 are pinned by unit tests on synthetic input and are not exercisable on dev).
- The dev state a case ran against can change. `run.json` carries the time of each run.
- Re-record with `ARAS_PASSWORD=… npm run oracle:import-cases` (see `npm run oracle:import-cases -- --help`).

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
| [s4-del](s4-del/README.md) | S4 | Delete actions against items an earlier import created | 2 | 267 | 58 |
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
