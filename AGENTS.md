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

The CI-equivalent gate is `npm run typecheck && npm test`. Both must pass before a PR.

`.no-mistakes.yaml` pins these two checks: `commands.lint` is `npm run typecheck` and `commands.test` is `npm test`. `.github/workflows/ci.yml` runs the same two on every pull request and on pushes to `main`. It was generated with `no-mistakes ci-workflow`, with the generator's Go toolchain step replaced by Node setup and `npm ci`. If you change the pinned commands, regenerate it with `no-mistakes ci-workflow --force` and reapply that replacement.

## Delivery

- One PR per wayfinder ticket, delivered through the no-mistakes pipeline (`/no-mistakes`, or `no-mistakes axi run`). The pipeline's lint and test steps run the commands pinned in `.no-mistakes.yaml`, and its CI step waits for the `ci.yml` checks on the PR.
- Never push to `main` directly.

## Layout

- `src/`: the library and CLI. Tests sit beside the code as `*.test.ts`.
- `spec/`: rule documents, `bugs.md`, `source-map.json` and its schema, and the coverage test.
- `roadmap/`: decision records, and `hold/` records for out-of-scope pieces.
- `oracle/`: the real engine DLLs and the Windows harness that drives them.
- `fixtures/`: recorded engine transcripts and outputs that unit tests replay.

## Rules

1. **The spec comes first.** Write or update the rule in `spec/` before the code that implements it. Code carries `@spec <RULE-ID>` tags back to its rules.
2. **Every rule has an id with per-engine variants.** Ids look like `EXP-017`, with the prefixes `EXP-`, `IMP-`, `MAN-`, `WIRE-`, `LP-` and `DBP-`. Variants are tagged `[12.0]`, `[14.0.7]` and `[14.35]`. The format is in `spec/README.md`.
3. **`spec/source-map.json` changes in the same PR as the code.** Every reachable C# method of every build is either mapped to rules and TypeScript symbols, or marked `not-ported` with a reason. Each one carries its REA method lock. `npm test` fails on an unmapped method, a missing symbol, or a rule that is defined but cited nowhere.
4. **Every reproduced bug is registered in `spec/bugs.md`.** Engine bugs are reproduced on purpose, never fixed silently. Each one has its own rule id.
5. **No decompiled C# is ever committed.** Regenerate it locally into the gitignored `.decomp/<version>/`. The spec may cite a C# member by name, but it never quotes its code. The XSL logic is re-expressed in TypeScript, not copied.
6. **Fixtures are scrubbed of credentials.** Never commit a password, auth or access token, or password hash, in fixtures or anywhere else. REA method locks and DLL digests are not credentials and belong in `spec/source-map.json`.
7. **Interpolated values are reproduced exactly.** Values interpolated into AML are reproduced exactly as each engine does it, unescaped where the engine does not escape. The library documents this; it does not "fix" it.

## Live Aras

- Use the dev instance only. Never contact olm or prod.
- Exports and reads are free.
- Imports use only `LIBSJS-SCRATCH-*` packages and items. Each run cleans up after itself and reports the ids it created and deleted.
- Clearly non-destructive DB patches are allowed on dev. Anything else goes to the captain first.
- The password reaches tools only through the environment (`ARAS_PASSWORD`) or stdin, never through a flag or a file.
