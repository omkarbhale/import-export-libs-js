# rea-map

Generates the reverse-engineering side of the spec for one `Libs.dll` build:

- the decompiled C#, in the gitignored `.decomp/<engine>/` (never committed);
- `spec/reachable/<engine>.json`: every method the engine's hosts can reach, with its REA method lock and where its C# sits under `.decomp/<engine>/`;
- that build in `spec/source-map.json`, merged so new methods appear as `unmapped`.

## Requirements

- `rea` 6.4.0 on `PATH`.
- `ilspycmd` 8.2.0.7535 (`dotnet tool install -g ilspycmd --version 8.2.0.7535`) and a .NET 8 SDK. ilspycmd 8.2 targets .NET 6; the tool runs it with `DOTNET_ROLL_FORWARD=Major`, and finds it under `$DOTNET_ROOT` (default `~/.dotnet`) and `$DOTNET_ROOT/tools`.

The tool checks both versions before it starts. Neither is needed for `npm test`, which only reads the committed JSON.

## Build

```sh
npm run rea-map -- build 14.0.7 \
  --dll <toolset>/Import/Libs.dll \
  --host <toolset>/Import/import.exe \
  --host <toolset>/Export/export.exe \
  --host <toolset>/ConsoleUpgrade/ConsoleUpgrade.exe
```

14.35 also needs a library entry, because none of its hosts calls DB patch application:

```sh
npm run rea-map -- build 14.35 \
  --dll oracle/native/14.35/Libs.dll \
  --host <toolset>/Import/import.exe \
  --host <toolset>/Export/export.exe \
  --host <toolset>/ConsoleUpgrade/ConsoleUpgrade.exe \
  --entry 'IImportExportManager::ApplyDBUpdateManifest'
```

- `--dll` is the build. `oracle/native/<engine>/` vendors only each toolset's `Import/` folder (see `oracle/README.md`), so the `Export/` and `ConsoleUpgrade/` hosts still come from the captain's machine (WSL: `/mnt/c/Users/omkarb/Desktop/ImportExport/23/` for 14.0.7, `…/12/` for 12.0, `…/Delete me/PackageImportExportUtilities35/` for 14.35). The coverage test fails if the build's sha256 differs from the vendored `Libs.dll`.
- `--entry` names a library method, `Type::Method` (the type with or without its namespace), as an extra root; it may be repeated. It is a scoped library API, not a host reference: it exists for an operation in scope that no shipped host calls. 14.35's `ConsoleUpgrade.exe` reaches only `ProcessExport`, `ProcessImport` and `ProcessExportImport`, so without `--entry 'IImportExportManager::ApplyDBUpdateManifest'` the DB patch application (and `ValidateRootUser`) would be missing from the set and the `DBP-` rules would not be checked. Every overload of the named method is rooted, and an unknown or ambiguous name fails the build. An interface member resolves, as in a host's interface call, to the implementations of the types the walk instantiates; the entry method itself has no body to list. The entries are recorded in `entries` in the reachable set, and the coverage test fails if one reaches no method.
- `--ref` is the folder ILSpy resolves references from (IOM and friends). It defaults to the DLL's folder.
- `--host` names an executable whose references to `Libs` seed the walk. Use the three hosts of the import, export and language-pack operations: `import.exe`, `export.exe` and `ConsoleUpgrade.exe`, the language-pack host. `PackageDefinition.exe` is a separate tool and stays out.

Steps:

1. **Decompile.** `ilspycmd -p` writes the project into `.decomp/<engine>/`, and `ilspycmd -genpdb` writes a portable PDB into `.decomp/.work/<engine>/`. The PDB embeds the same text with one header line, which the tool checks file by file, so its sequence points give exact line numbers in the project.
2. **Inventory.** `rea inspect-managed-members` gives identity, digests and call edges. A small ECMA-335 reader (`metadata.ts`, `names.ts`) adds what REA leaves out: nested type parents, type names behind references, and generic signatures. Method names (`Outer/Inner::Member`) and signatures do not depend on tokens, so they match across builds.
3. **Reachability** (`reachability.ts`). The roots are the host executables' member references into `Libs`, the types they construct, and any `--entry` methods. The walk follows `call`, `callvirt`, `newobj` and `ldftn` edges, and also:
   - dispatches virtual and interface calls, by name and signature, to the types it has seen instantiated;
   - runs a type's static constructor when the type is touched;
   - marks every virtual method of a touched compiler-generated type (async and iterator state machines, which the runtime drives), and framework overrides of instantiated types.

   Methods without a body (interface and abstract members) are walked through but not listed.
4. **Locks.** Each reachable method's C# is sliced out of the project, located by its sequence points. A method's slice is the whole member: the nearest declaration above its span at the member indent of its declaring type (one tab per enclosing type, ignoring compiler-generated ones), from its attributes through its closing brace, or just the declaration line of an `=>` member. An accessor of a block-bodied property is its own `get` or `set` block, an auto-property accessor is the property's one-line declaration, and a lambda ILSpy inlines into its parent keeps its own lines. `rea import-managed-reconstruction` binds the slices to the token, signature digest and normalized IL digest, and fails if any of them disagree with the build. A few methods have no C# of their own (implicit constructors, compiler-generated helpers); they keep REA's lock without a text digest.
5. **Output.** The reachable set is written with stable ordering and no local paths, so a rerun on the same build reproduces it byte for byte. The merge into `source-map.json` reports added, removed and relocked methods.

## Diff

```sh
npm run rea-map -- diff <old Libs.dll> <new Libs.dll>
```

The old build must already be in `source-map.json` (it is found by sha256). The command prints the summary of `rea compare-managed-members`, then reads the new build's member inventory as `build` does. It matches each method of the old build to the new one by name and signature, as the merge does, not by REA's pairing, which can pair different members. It lists each method whose lock breaks, with the rule ids to re-verify: `changed` when the signature or normalized IL digest differs, and `removed` when the new build has no method with that name and signature.
