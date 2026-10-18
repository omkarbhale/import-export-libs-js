# s7-xp-empty

Unclassified instance of an ItemType whose class has extended properties. Engine 14.0.7, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 67). Catalogue: E44, S7, xp-* values (ticket 05).

## Exercises

EXP-106: an item of the same type that is in no class: its fetch returns no xp-* element, so the step has nothing to rewrite.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-XPROPINST | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A | LIBSJS-SCRATCH-XIT_Empty |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 13 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s7-xprop`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: types and extended properties (`LIBSJS-SCRATCH-XPROP`; default options)

Created 22, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | FE7BF7F8037F4CA29CCCE33005F6EEC1 |
| 2 | PackageDefinition | 29ED62E5F852450C845F810A71CF4530 |
| 3 | Permission | 0656C7682C3FA862608961EFAE2F41FD |
| 4 | PackageGroup | F700BC3E4FDC4239A850FD72234DD919 |
| 5 | PackageElement | B89DB4D4172F44C6AC8A6D23EBEB0E9A |
| 6 | xPropertyDefinition | E9DB12E50F5C07ABAE874CCDAFCFFBBB |
| 7 | PackageGroup | 60C0EED783784FC2BD3A58C44EA5C694 |
| 8 | PackageElement | 1429BD487BE64E298C757D85D5D4162E |
| 9 | xPropertyDefinition | 76E3B4CED43EE1E91FCD3DD85C99B2AF |
| 10 | PackageElement | C855EE318A0245B79920371D2783FAAC |
| 11 | Permission_ItemClassification | C48CF1C1287BBDFE96E06E35676D17FD |
| 12 | PackageGroup | 0372589AE01244618974150C66BB9910 |
| 13 | PackageElement | A4D5AE525F9E4C4689121F8ED97E3C68 |
| 14 | Permission_PropertyValue | 22F24EA57E40B8D59BAD8E0E2E5382CA |
| 15 | PackageGroup | 5E380D0E4B7442BABC70AFFB093C0259 |
| 16 | PackageElement | FAD19E942C754F3D95DBB52350819DAC |
| 17 | ItemType | 534A999320CB43385FFE3D51D2BA2F9A |
| 18 | PackageGroup | D41D8FB05C4B47CF83E5429731C79BED |
| 19 | PackageElement | 90BD1A9B63CD49B2921FF9C140534C35 |
| 20 | xClassificationTree | 92EEF539A9A190D05A5AA0BAE1D113E0 |
| 21 | PackageGroup | B73281755E094E20B30F2EA878B9A025 |
| 22 | PackageElement | 759CFB0ED9E24E4CB3EF51959FF735EA |

### Seed step 2: instances (`LIBSJS-SCRATCH-XPROPINST`; default options)

Created 7, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | EA7FCFC87B11403DA8D878A0CB6FFBCA |
| 2 | PackageDefinition | A33DDEE0A2254ABCBB3E37C2E78AF420 |
| 3 | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A |
| 4 | PackageGroup | EF92B1A26A61455F93EB0D36F92FD66E |
| 5 | PackageElement | DD035C2CFE3F489FBAA8BEA6E695375D |
| 6 | LIBSJS_SCRATCH_XIT | BB375A03ED9E92E2098011DDF895576F |
| 7 | PackageElement | 205D95C9581C42A5A0C2F052893585CB |

### Deleted by the cleanup: 29

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 205D95C9581C42A5A0C2F052893585CB |
| 2 | LIBSJS_SCRATCH_XIT | BB375A03ED9E92E2098011DDF895576F |
| 3 | PackageElement | DD035C2CFE3F489FBAA8BEA6E695375D |
| 4 | PackageGroup | EF92B1A26A61455F93EB0D36F92FD66E |
| 5 | LIBSJS_SCRATCH_XIT | F06E6941DE328CB42A63A668AB03B22A |
| 6 | PackageDefinition | A33DDEE0A2254ABCBB3E37C2E78AF420 |
| 7 | DatabaseUpgrade | EA7FCFC87B11403DA8D878A0CB6FFBCA |
| 8 | PackageElement | 759CFB0ED9E24E4CB3EF51959FF735EA |
| 9 | PackageGroup | B73281755E094E20B30F2EA878B9A025 |
| 10 | xClassificationTree | 92EEF539A9A190D05A5AA0BAE1D113E0 |
| 11 | PackageElement | 90BD1A9B63CD49B2921FF9C140534C35 |
| 12 | PackageGroup | D41D8FB05C4B47CF83E5429731C79BED |
| 13 | ItemType | 534A999320CB43385FFE3D51D2BA2F9A |
| 14 | PackageElement | FAD19E942C754F3D95DBB52350819DAC |
| 15 | PackageGroup | 5E380D0E4B7442BABC70AFFB093C0259 |
| 16 | Permission_PropertyValue | 22F24EA57E40B8D59BAD8E0E2E5382CA |
| 17 | PackageElement | A4D5AE525F9E4C4689121F8ED97E3C68 |
| 18 | PackageGroup | 0372589AE01244618974150C66BB9910 |
| 19 | Permission_ItemClassification | C48CF1C1287BBDFE96E06E35676D17FD |
| 20 | PackageElement | C855EE318A0245B79920371D2783FAAC |
| 21 | xPropertyDefinition | 76E3B4CED43EE1E91FCD3DD85C99B2AF |
| 22 | PackageElement | 1429BD487BE64E298C757D85D5D4162E |
| 23 | PackageGroup | 60C0EED783784FC2BD3A58C44EA5C694 |
| 24 | xPropertyDefinition | E9DB12E50F5C07ABAE874CCDAFCFFBBB |
| 25 | PackageElement | B89DB4D4172F44C6AC8A6D23EBEB0E9A |
| 26 | PackageGroup | F700BC3E4FDC4239A850FD72234DD919 |
| 27 | Permission | 0656C7682C3FA862608961EFAE2F41FD |
| 28 | PackageDefinition | 29ED62E5F852450C845F810A71CF4530 |
| 29 | DatabaseUpgrade | FE7BF7F8037F4CA29CCCE33005F6EEC1 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --only s7-xp-empty --force` (it seeds, exports and cleans up again).
