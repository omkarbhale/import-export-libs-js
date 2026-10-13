# Round 1: basis, scope and product

Answered 2026-10-13.

## Decisions

1. **Basis.** A spec-first re-implementation in a private repo. No decompiled C# is committed. The spec is detailed and carries source mappings back to the DLL, so the port can be verified against it and updated when Aras ships a new build. The XSL logic is re-expressed in TypeScript, not copied.
2. **Scope.** Everything import and export reach, working identically to the DLL. The rest of the DLL goes to hold records. (Round 2 corrected one premise: language-pack import is a third user-facing operation.)
3. **No IOM.** The library carries its own OAuth and SOAP client, so it is cross-platform and standalone.
4. **Product.** A library plus a CLI. Other projects (aras-axi, aras-harness) are not part of this work.
5. **Platforms.** Any OS that runs Node ≥ 20, with no .NET or PowerShell.
6. **Fidelity.** Exact reproduction, bugs included. Every bug is deliberately and correctly recorded.
7. **Parity.** Golden fixtures recorded from the DLL, plus a live parity script. They cover import and export, every kind of schema and every option. Tests are updated whenever new behaviour is found or implemented.
8. **Order.** Import and export are both in scope. Work is ordered only where a real dependency forces it.
9. **Extent.** Build tickets all the way. There is no cutover: the deliverable is the library and the CLI.

## Captain's answers (verbatim)

> 1. a, but detailed, and source mappings so verification/updation is easy.
> 2. a, import and export should work identically. I think Libs.dll doesn't do anything other than import and export for the user, that's why
> 3. b(, so ours become cross-platform)
> 4. b, library+cli right now, other projects don't come into the picture in this wayfinder
> 5. a
> 6. b, with bugs deliberately and correctly recorded
> 7. a, with all kinds of schema and options, tests updated if we find/implement new behaviour. Import and export both included.
> 8. Both in scope, order doesn't matter in our map (unless it does, in which case wayfinder finds it)
> 9. Build tickets all the way (no cutover, deliverable is a library+cli)

Options offered, for reading the letters: Q1 (a) spec-first, nothing decompiled committed, private; Q2 (a) everything import and export reach; Q3 (b) the library's own OAuth + SOAP client; Q4 (b) library + standalone CLI; Q5 (a) any OS, Node ≥ 20; Q6 (b) exact, including bugs; Q7 (a) golden fixtures from the DLL on dev plus a live parity script.
