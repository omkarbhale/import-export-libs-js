# `Hashtable` enumeration probes, 14.0.7

Evidence for `MAN-017` and `MAN-018` in `spec/manifest.md`. The engine's tables are .NET Framework `Hashtable`s, and
the order they enumerate in decides the package order, the item order, the log order and the `imports.mf` order. The
emulation is `src/manifest/netfx-hashtable.ts`.

## What was run

The cases are generated, not stored: 77 MB of raw vectors are too large to commit. `generateCases(7)` in
`src/manifest/hashtable-cases.ts` writes them deterministically (mulberry32, seed 7):

- 1,200 `C` cases: one table built by indexer-set (`S`), `Add` (`A`) and `Remove` (`R`) operations, up to 3,273 of them,
  with 32-hex ids, package names, `excludedRefs`-shaped keys, lone surrogates, non-BMP characters, NULs and the empty
  string. 262 of them remove keys.
- 200 `N` cases: the host's nested table, `table[package] = Hashtable(itemId -> item)`, built in the order of
  `scripts/export.ps1`.
- 421,159 `H` lines: the `String.GetHashCode` of every key used.

`probe.ps1` runs the same cases in 64-bit Windows PowerShell 5.1 (CLR 4.0.30319.42000, .NET Framework 4.8.1, randomized
string hashing off, which the hosts run in) through `Add-Type`, the way `export.ps1` builds its table.

| | sha256 of the output (422,559 lines) |
|---|---|
| real .NET, seed 7 | `fd2dd7ffde7fa5b4dc5075e80d9ed294639d797999b6ac7ebb7982a53b523d5f` |
| `evaluateCases(generateCases(7))` | the same; `netfx-hashtable.test.ts` checks it |

Other observations of the same research, which the tests also hold:

- under SysWOW64 (32-bit) PowerShell none of 200 sampled hashes matched, so the port follows the 64-bit hash only;
- 101 keys that share one hash enumerate in a fixed order, identical to the emulation on three runs; 102 give a different
  order on every run. That is the switch to randomized hashing of `MAN-018`, which the emulation refuses (the test builds
  the keys with `collisionCases()`);
- on 5,050 real dev `PackageElement` ids in 55 packages, 48 packages enumerate their items differently when the same
  items are inserted in reverse. The ids are not committed (dev data drifts); the 200 `N` cases hold the same shape.

## Re-running

On Windows, with 64-bit Windows PowerShell 5.1:

```
npx tsx -e "import { writeFileSync } from 'node:fs'; import { generateCases } from './src/manifest/hashtable-cases.ts'; writeFileSync('cases.tsv', generateCases(7).join('\n') + '\n')"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File fixtures/manifest/14.0.7/hashtable/probe.ps1 -InPath cases.tsv -OutPath net.tsv
```

`net.tsv` should hash to the digest above.
