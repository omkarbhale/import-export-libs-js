# AGENTS.md

`import-export-libs-js` is a private TypeScript library and CLI (`import-export-libs-js`, alias `aras-pkg`). It re-implements Aras's package import/export engine (`Libs.dll`, `Aras.Tools.SolutionUpgrade`) from a written spec. It runs on any OS with Node ≥ 20 and no .NET. It reproduces the observable behaviour of three engine builds exactly: 12.0.0.13341, 14.0.7.35492 (the default) and 14.35.0.43890.

Decision records are in `roadmap/`, and the spec is in `spec/` (start with `spec/README.md`).

## Commands

| Step | Command |
|---|---|
| Setup | `npm install` (Node ≥ 20.19 for development; the toolchain needs it) |
| Build | `npm run build` (tsup, to `dist/`) |
| Typecheck | `npm run typecheck` |
| Test | `npm test` (vitest, includes the spec coverage test) |
| Lint | There is no separate linter. `npm run typecheck` is the static gate. |
| Source map | `npm run rea-map -- build <engine> --dll <Libs.dll> --host <exe>...` regenerates `.decomp/<engine>/`, `spec/reachable/<engine>.json` and the build in `spec/source-map.json`; `npm run rea-map -- diff <old.dll> <new.dll>` lists the rule ids whose locks break. It needs `rea` 6.4.0, `ilspycmd` 8.2.0.7535 and a .NET 8 SDK; see `tools/rea-map/README.md`. Not part of the gate. |
| Oracle | `npm run oracle -- --engine <v> <export, import, lpimport or dbpatch> ...` records a scrubbed fixture from the real DLLs on dev (WSL with Windows PowerShell 5.1; see `oracle/README.md`). `xsl` records `export.xsl` or `build.xsl` run on given documents, with no server. `npm run oracle -- verify` checks the vendored toolsets. |
| Parity | `npm run parity -- --engine 14.0.7 [--case <id>,…]` (or `--engine 12.0`) runs the oracle and the port on the same inputs against dev and diffs the request AML, output folders, logs, messages and return codes (`oracle/README.md`, "Live parity"). It needs `ARAS_PASSWORD`, touches only `LIBSJS-SCRATCH-*` items and deletes them again, and is not part of the gate. `--list` needs no server. |

The CI-equivalent gate is `npm run typecheck && npm test`. Both must pass before a PR.

`.no-mistakes.yaml` pins these two checks: `commands.lint` is `npm run typecheck` and `commands.test` is `npm test`. `.github/workflows/ci.yml` runs the same two on every pull request and on pushes to `main`. It was generated with `no-mistakes ci-workflow`, with the generator's Go toolchain step replaced by Node setup and `npm ci`. If you change the pinned commands, regenerate it with `no-mistakes ci-workflow --force` and reapply that replacement.

## Delivery

- One PR per wayfinder ticket, delivered through the no-mistakes pipeline (`/no-mistakes`, or `no-mistakes axi run`). The pipeline's lint and test steps run the commands pinned in `.no-mistakes.yaml`, and its CI step waits for the `ci.yml` checks on the PR.
- Never push to `main` directly.

## Layout

- `src/`: the library and CLI. Tests sit beside the code as `*.test.ts`.
- `spec/`: rule documents, `bugs.md`, `source-map.json` and its schema, the generated `reachable/<engine>.json` sets, and the coverage test.
- `tools/rea-map/`: the generator of the decompile, the reachable sets and the method locks.
- `roadmap/`: decision records, and `hold/` records for out-of-scope pieces.
- `oracle/`: the real engine DLLs and the Windows harness that drives them.
- `fixtures/`: recorded engine transcripts and outputs that unit tests replay.

## Adding a new Aras build

A new `Libs.dll` is a fourth engine, and each step is its own PR (one slice, as for the first three). The ticket tracker lives outside the repo, on Firstmate's side. Start from `roadmap/engine-diffs.md` for how the existing builds differ.

1. **Vendor the toolset.** `npm run oracle -- --engine <v> vendor --from <folder>` copies the tool folder into `oracle/native/<v>/` and writes its sha256 and MVID entry in `oracle/native/manifest.json`; `npm run oracle -- verify` checks it. The new engine needs a host script in `oracle/host/`, as the others have (`oracle/README.md`).
2. **Diff against the nearest build.** `npm run rea-map -- diff <old Libs.dll> <new Libs.dll>` lists the methods whose locks break, and the rule ids to re-verify. Then `npm run rea-map -- build <v> --dll … --host … [--entry …]` writes `spec/reachable/<v>.json` and adds the build to `spec/source-map.json` as `inProgress` (`tools/rea-map/README.md`). The new methods arrive `unmapped`.
3. **Write the rules, then the code.** Add a `[<v>]` variant to each rule the diff touches, and a new id (next free in its document's block, `spec/README.md`) for behaviour that is new. A variant that equals another engine's says so. Put `<v>` in `ENGINES` and `ENGINE_ASSEMBLY_VERSIONS` (`src/engines.ts`); the compiler then points at every `Record<Engine, …>` to fill. Code carries `@spec` tags, and the source map gets the symbols (rule 3). Register each reproduced bug (rule 4).
4. **Record fixtures.** Read the engine's behaviour from the oracle, never from memory: `npm run oracle:export-cases -- --engine <v>`, `oracle:import-cases`, `oracle:lp-cases`, `oracle:dbpatch-cases` and `oracle -- xsl`, as the engine supports them (`oracle/README.md`). Keep scratch rules from "Live Aras". Unit tests replay the fixtures offline.
5. **Prove it live and complete it.** `npm run parity -- --engine <v>` (needs `ARAS_PASSWORD`) must have no unexplained difference; record the run in `roadmap/live-parity-<v>.md`. Last, add `<v>` to `COMPLETE_ENGINES` and clear `inProgress` in the same PR, so that `npm test` then fails on any unmapped method of the build.

## Rules

1. **The spec comes first.** Write or update the rule in `spec/` before the code that implements it. Code carries `@spec <RULE-ID>` tags back to its rules.
2. **Every rule has an id with per-engine variants.** Ids look like `EXP-017`, with the prefixes `EXP-`, `IMP-`, `MAN-`, `WIRE-`, `LP-` and `DBP-`. Variants are tagged `[12.0]`, `[14.0.7]` and `[14.35]`. The format is in `spec/README.md`.
3. **`spec/source-map.json` changes in the same PR as the code.** Every reachable C# method of every build is either mapped to rules and TypeScript symbols, or marked `not-ported` with a reason. Each one carries its REA method lock. `npm test` fails on an unmapped method, a missing symbol, or a rule that is defined but cited nowhere. The one exception is a build marked `inProgress`: its unmapped methods are listed as pending, but only while its engine is not in `COMPLETE_ENGINES` (`src/engines.ts`). The engine's final slice must add the engine to `COMPLETE_ENGINES` and clear `inProgress` (all three current engines have). From then on, an unmapped method of that engine always fails.
4. **Every reproduced bug is registered in `spec/bugs.md`.** Engine bugs are reproduced on purpose, never fixed silently. Each one has its own rule id.
5. **No decompiled C# is ever committed.** Regenerate it locally into the gitignored `.decomp/<version>/`. The spec may cite a C# member by name, but it never quotes its code. The XSL logic is re-expressed in TypeScript, not copied.
6. **Fixtures are scrubbed of credentials.** Never commit a password, auth or access token, or password hash, in fixtures or anywhere else. REA method locks and DLL digests are not credentials and belong in `spec/source-map.json` and `spec/reachable/<engine>.json`.
7. **Interpolated values are reproduced exactly.** Values interpolated into AML are reproduced exactly as each engine does it, unescaped where the engine does not escape. The library documents this; it does not "fix" it.

## Live Aras

- Use the dev instance only. Never contact olm or prod.
- Exports and reads are free.
- Imports use only `LIBSJS-SCRATCH-*` packages and items (`LIBSJS_SCRATCH_*` for the ItemType, SQL and other item names that Aras limits to word characters, and `xp-LIBSJS_SCRATCH_*` for extended properties, whose names must start with `xp-`). Each run cleans up after itself and reports the ids it created and deleted.
- The oracle's scratch guard only checks names, not which items the engine will change (it picks them by `id` or `where`). So feed it only this repo's own `LIBSJS-SCRATCH-*` fixture packages. Never feed it a foreign package or language pack whose items carry real ids, `edit`, `merge` or `delete` post-actions, or `--merge` against non-scratch items.
- Clearly non-destructive DB patches are allowed on dev. Anything else goes to the captain first.
- The password reaches tools only through the environment (`ARAS_PASSWORD`) or stdin, never through a flag or a file.
