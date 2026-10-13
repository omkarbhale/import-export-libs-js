# Roadmap

Decision records for import-export-libs-js. They were settled in five rounds of questions with the captain on 2026-10-13. Each record summarises the round and keeps the captain's answers verbatim.

| Record | Settles |
|---|---|
| [round-1.md](round-1.md) | Basis, scope, product, platforms, fidelity, parity, order |
| [round-2.md](round-2.md) | Spec form, language-pack import, "exact", CLI, credentials, options, dev writes, conventions |
| [round-3.md](round-3.md) | Which engine versions, engine selection, version gate, vendored oracle DLLs |
| [round-4.md](round-4.md) | The 14.35 additions, 14.35's parallel export, build order |
| [round-5.md](round-5.md) | The confirmed shared understanding, with the captain's corrections |

[`hold/`](hold/) holds the pieces of `Libs.dll` that are deliberately out of scope, each with what would bring it in.

The work itself is tracked as wayfinder tickets outside this repo. Each ticket lands as one PR (see `AGENTS.md`).

## The captain's intent

> New project `import-export-libs-js`: read my library Libs.dll present in committed aras-harness project, use REA (https://github.com/morluto/rea See a feature you like. Understand how it works, down to the binary level. Should be already installed some) and migrate it whole to Node/TypeScript for readability.
