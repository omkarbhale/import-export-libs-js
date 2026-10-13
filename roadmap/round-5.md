# Round 5: confirmed shared understanding

Confirmed with corrections on 2026-10-13.

## Destination

A private TypeScript library plus CLI that re-implements Aras's package import/export engine (`Libs.dll`, `Aras.Tools.SolutionUpgrade`). It runs on any OS with no .NET, PowerShell or Aras DLLs at run time. It reproduces three engine versions exactly: 12.0.0.13341, 14.0.7.35492 and 14.35.0.43890.

## The design

- **Basis and spec.**
  - Spec first. No decompiled C# is committed.
  - `spec/` holds rules with ids and per-version variants.
  - `spec/source-map.json` maps every reachable C# method, per build, to its rules and TypeScript symbols, or to "not ported" with a reason. Each reference carries a REA method lock (`rea import-managed-reconstruction`). The reachable set comes from REA's call graph.
  - A test enforces the map.
  - Bugs are reproduced on purpose and registered in `spec/bugs.md`.
  - A new Aras build arrives as `rea compare-managed-members`, then the changed members, then the rules to revisit, then re-recorded fixtures.
- **Scope.**
  - Everything import and export reach, in all three versions.
  - Language-pack import.
  - The four 14.35 additions.
  - Hold records for the rest (see `hold/`). Nothing user-facing is dropped.
- **Fidelity.**
  - Files and bytes, the requests and their order, message and log text, and the outcome and return code are all exact, per version.
  - `Hashtable` order is reproduced.
  - Unbounded recursion becomes a bounded failure. This is the one deviation that cannot be avoided.
- **Version gate.** 12.0 accepts servers 10–12, and 14.0.7 and 14.35 accept 12–14. Plus `--skip-version-check`.
- **Product.**
  - The library takes the engine version as a parameter and has its own OAuth (password grant) and SOAP client.
  - CLI commands: `export`, `import`, `import-language-pack`, `plan import`, and the 14.35 operations including `apply-db-patches`.
  - `--engine 12.0|14.0.7|14.35` (env `ARAS_PKG_ENGINE`), defaulting to 14.0.7.
- **Proof.**
  - The oracle is the real DLLs on Windows, vendored and hash-checked, with a recording wrapper around IOM's `CallAction`.
  - Fixtures cover every schema kind and option for every version, with credentials scrubbed.
  - Live parity runs on dev.
- **Order.** 14.0.7 complete first, then 12.0 and 14.35 as variant slices.

## Captain's corrections (verbatim)

> Line 21 - any single export can't confirm they're trule same.
> Line 8 - Clearly non-destructive database patches allowed on dev.
> Scope is deliberately this, because wayfinder doesn't care how many tickets it takes. Keep each ticket reasonably sized (Not "build this entire thing", "RE this entire DLL version", etc)

What the corrections settle:

- **Line 8.** Clearly non-destructive DB patches may be applied on dev without asking. Anything not clearly non-destructive still waits for the captain.
- **Line 10** was not corrected, so 14.35's parallel export is emulated.
- **Line 21.** A live export cannot prove two engines are the same, so it is not a test for folding engines together. The three engines stay three versions. Live three-engine diffs are evidence and fixture work: they pin the documented differences and surface any the code reading missed.
- **Ticket sizing.** The scope is deliberately all of it. Every ticket is reasonably sized: one area, one version delta, or one fixture family.
