# s7-xp-empty

Unclassified instance of an ItemType whose class has extended properties. Engine 14.35, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 57). Catalogue: E44, S7, xp-* values (ticket 05).

## Exercises

EXP-106: an item of the same type that is in no class: its fetch returns no xp-* element, so the step has nothing to rewrite.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-XPROPINST | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A | LIBSJS-SCRATCH-XIT_Empty |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 15 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s7-xprop`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: types and extended properties (`LIBSJS-SCRATCH-XPROP`; default options)

Created 22, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | E45D7BCB41874E20A7E6148302B9AC75 |
| 2 | PackageDefinition | 67CFA47C84EE4A8A9265A7310845BF12 |
| 3 | Permission | 0656C7682C3FA862608961EFAE2F41FD |
| 4 | PackageGroup | 2B37BC2F8DE7421FB4B76C55ECB8F850 |
| 5 | PackageElement | 597B7649827742148BE5698EBC0E1271 |
| 6 | xPropertyDefinition | E9DB12E50F5C07ABAE874CCDAFCFFBBB |
| 7 | PackageGroup | 717B527EBB694BF68867347805741590 |
| 8 | PackageElement | 89095D0874CA4C3499A694DDFC345760 |
| 9 | xPropertyDefinition | 76E3B4CED43EE1E91FCD3DD85C99B2AF |
| 10 | PackageElement | 6842F6EFC2DF43F1A11CAA5F9D2BAF65 |
| 11 | Permission_ItemClassification | C48CF1C1287BBDFE96E06E35676D17FD |
| 12 | PackageGroup | E9AEDB10E6464971874278D08CD5D32E |
| 13 | PackageElement | 55A49046C36A4B1F8D302C419F13AE32 |
| 14 | Permission_PropertyValue | 22F24EA57E40B8D59BAD8E0E2E5382CA |
| 15 | PackageGroup | A30E012EF12A4EE2AA9235D52433CC34 |
| 16 | PackageElement | A521BBE8EB154846BFDF79AE655DF5B6 |
| 17 | ItemType | 534A999320CB43385FFE3D51D2BA2F9A |
| 18 | PackageGroup | 66446C1E9A134A99BB6B8EE0CE683363 |
| 19 | PackageElement | 220D327C4DFA44F3A7F5B9EE13B0CA29 |
| 20 | xClassificationTree | 92EEF539A9A190D05A5AA0BAE1D113E0 |
| 21 | PackageGroup | E59DE40094CC4E5988534139845E72B7 |
| 22 | PackageElement | 9AC79C3A9765472A8B2CAE3F1FEF71FD |

### Seed step 2: instances (`LIBSJS-SCRATCH-XPROPINST`; default options)

Created 7, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 3296384FD2B14C12AA273B815EE21F9A |
| 2 | PackageDefinition | B93AE64765924BF9A83067FB2E1FFC85 |
| 3 | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A |
| 4 | PackageGroup | F19B59AEAD9849B4A81E00661764D062 |
| 5 | PackageElement | FEF69F78D01A4177BEDB5C1EF4D6806D |
| 6 | LIBSJS_SCRATCH_XIT | BB375A03ED9E92E2098011DDF895576F |
| 7 | PackageElement | C4293E754FAF4A6F80AA1627479B2804 |

### Deleted by the cleanup: 29

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | C4293E754FAF4A6F80AA1627479B2804 |
| 2 | LIBSJS_SCRATCH_XIT | BB375A03ED9E92E2098011DDF895576F |
| 3 | PackageElement | FEF69F78D01A4177BEDB5C1EF4D6806D |
| 4 | PackageGroup | F19B59AEAD9849B4A81E00661764D062 |
| 5 | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A |
| 6 | PackageDefinition | B93AE64765924BF9A83067FB2E1FFC85 |
| 7 | DatabaseUpgrade | 3296384FD2B14C12AA273B815EE21F9A |
| 8 | PackageElement | 9AC79C3A9765472A8B2CAE3F1FEF71FD |
| 9 | PackageGroup | E59DE40094CC4E5988534139845E72B7 |
| 10 | xClassificationTree | 92EEF539A9A190D05A5AA0BAE1D113E0 |
| 11 | PackageElement | 220D327C4DFA44F3A7F5B9EE13B0CA29 |
| 12 | PackageGroup | 66446C1E9A134A99BB6B8EE0CE683363 |
| 13 | ItemType | 534A999320CB43385FFE3D51D2BA2F9A |
| 14 | PackageElement | A521BBE8EB154846BFDF79AE655DF5B6 |
| 15 | PackageGroup | A30E012EF12A4EE2AA9235D52433CC34 |
| 16 | Permission_PropertyValue | 22F24EA57E40B8D59BAD8E0E2E5382CA |
| 17 | PackageElement | 55A49046C36A4B1F8D302C419F13AE32 |
| 18 | PackageGroup | E9AEDB10E6464971874278D08CD5D32E |
| 19 | Permission_ItemClassification | C48CF1C1287BBDFE96E06E35676D17FD |
| 20 | PackageElement | 6842F6EFC2DF43F1A11CAA5F9D2BAF65 |
| 21 | xPropertyDefinition | 76E3B4CED43EE1E91FCD3DD85C99B2AF |
| 22 | PackageElement | 89095D0874CA4C3499A694DDFC345760 |
| 23 | PackageGroup | 717B527EBB694BF68867347805741590 |
| 24 | xPropertyDefinition | E9DB12E50F5C07ABAE874CCDAFCFFBBB |
| 25 | PackageElement | 597B7649827742148BE5698EBC0E1271 |
| 26 | PackageGroup | 2B37BC2F8DE7421FB4B76C55ECB8F850 |
| 27 | Permission | 0656C7682C3FA862608961EFAE2F41FD |
| 28 | PackageDefinition | 67CFA47C84EE4A8A9265A7310845BF12 |
| 29 | DatabaseUpgrade | E45D7BCB41874E20A7E6148302B9AC75 |

## Spec rules

None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).

## Files

| File | What |
|---|---|
| `case.json` | this case's input and result, machine-readable |
| `run.json` | the oracle's run record: toolset identity, parameters, host info |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `output/` | the export folder, byte for byte |

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 14.35 --only s7-xp-empty --force` (it seeds, exports and cleans up again).
