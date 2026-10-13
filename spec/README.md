# Spec

This folder is the written behavioural spec of Aras's package import/export engine (`Libs.dll`, namespace `Aras.Tools.SolutionUpgrade`). The TypeScript in `src/` is written from this spec, never from decompiled C#. No decompiled C# is ever committed here or anywhere else in the repo.

The spec covers three engine builds:

| Engine | Assembly version | Toolset |
|---|---|---|
| `12.0` | 12.0.0.13341 | Aras 12 |
| `14.0.7` | 14.0.7.35492 | Release 23 (the default) |
| `14.35` | 14.35.0.43890 | Release 35 |

## Files

- One document per area, for example `export-requests.md`. Each document holds rules. No area documents exist yet.
- `bugs.md` registers every engine bug the library reproduces on purpose.
- `source-map.json` maps every reachable C# method of each build to the rules and TypeScript symbols that cover it. It is validated against `source-map.schema.json`.
- `coverage.ts` and `coverage.test.ts` enforce the map (see below).

## Rule ids

Every rule has an id made of an area prefix and three digits, such as `EXP-017`. Ids are never reused or renumbered.

| Prefix | Area |
|---|---|
| `EXP-` | Export: fetch requests, rewrites, the export transform, serialization, orchestration |
| `IMP-` | Import: loading, ordering, reference checks, delayed resolution, merge, registration |
| `MAN-` | Manifest (`imports.mf`) reading, writing and package ordering |
| `WIRE-` | Wire protocol: OAuth login, SOAP requests and faults, the version probe and gate |
| `LP-` | Language-pack import, and 14.35's language-resource export |
| `DBP-` | 14.35 DB patch application |

### Writing a rule

A rule is a heading at level 2 to 4 that starts with its id. Below it, each engine's behaviour is a paragraph or list item that starts with the engine in brackets: `[12.0]`, `[14.0.7]` or `[14.35]`. A rule has at least one variant. When engines behave the same, one variant can say so ("`[14.35]` Same as 14.0.7.").

```markdown
### EXP-017: Item ids are rewritten to config ids before the transform

[14.0.7] Every `id` attribute of a versionable item is replaced by its `config_id` …

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7, but items with `is_null="1"` …
```

A reproduced bug is a rule like any other, and it also gets an entry in `bugs.md`.

## Citing rules

- **From TypeScript.** The code that implements a rule carries a JSDoc `@spec` tag naming it, for example `/** @spec EXP-017 EXP-018 */`.
- **From the source map.** Each mapped method lists its rule ids in `rules`.

## The source map

`source-map.json` has one entry per build. A build records its identity, from REA (`rea inspect-managed-artifact`): `engine`, `assemblyVersion`, `sha256` and `mvid`. It also lists every method reachable from the import, export, language-pack and DB-patch entry points. Each method records:

- `fullName` (`Namespace.Type::Member`) and `signature`;
- `lock`: the REA method lock from `rea import-managed-reconstruction`, which holds the metadata token, the signature digest and the normalized IL digest on that exact build;
- `status`:
  - `mapped`, with `rules` and `symbols`;
  - `not-ported`, with a `reason`;
  - `unmapped`, which is what the generator writes for a method nobody has covered yet.

A symbol is written `src/<path>.ts#<ExportName>`, or `src/<path>.ts#<ExportName>.<member>` for a class member.

## The coverage test

`npm test` runs `spec/coverage.test.ts`. It fails when:

- `source-map.json` does not match its schema, or lists a build or a method twice;
- a method is still `unmapped`;
- a mapped TypeScript symbol does not exist;
- a rule is defined in an area document but cited nowhere (no `@spec` tag and no source-map entry);
- a rule is cited, or registered in `bugs.md`, but defined nowhere, is defined twice, or has no engine variant;
- a rule has a variant for an engine other than `12.0`, `14.0.7` and `14.35`.
