# Round 2: spec form, CLI and conventions

Answered 2026-10-13.

## Decisions

1. **Spec form.** `spec/` documents with rule ids, `spec/source-map.json`, a coverage test, `@spec` tags in the code, and `spec/bugs.md`.
2. **Language-pack import is in**, as a third operation (`LPImport`, `LanguagePackPreprocessor`).
3. **"Exact" means the observable outcome is exact,** .NET `Hashtable` enumeration order included. A .NET crash becomes the same visible failure.
4. **CLI.** `export` takes items, stdin or `--package`, with package membership resolved. Also `import`, `import-language-pack` and an offline `plan import`. Engine messages go to stderr, a summary to stdout, `--json` is available, and exit codes are 0 ok, 1 failed, 2 completed with engine errors, 64 usage error.
5. **Connection.** `--url --database --user` or `ARAS_URL`/`ARAS_DATABASE`/`ARAS_USER`. The password comes from `ARAS_PASSWORD` or `--password-stdin`, never from a flag. No profile store, no token cache.
6. **Options.** Every behavioural option is a flag, with today's host values as defaults. `--on-item-error` defaults to `continue`. `os_user` is set per platform, with `--os-user` to override. The log has a default path unless `--log` is given.
7. **Version gate.** Left open here, and settled in round 3.
8. **Dev writes.** Everything reasonably non-destructive is allowed on dev. Imports use `LIBSJS-SCRATCH-*` packages with cleanup, and scrubbed fixtures are committed.
9. **Repo conventions.** Named `import-export-libs-js`, with an `aras-pkg` alias. TypeScript strict, ESM, tsup and vitest on Node ≥ 20. Installed from git. Ships `AGENTS.md` and `roadmap/`. One PR per slice.

## Captain's answers (verbatim)

> 1. a
> 2. a
> 3. a
> 4. a
> 5. a
> 6. a
> 7. To be declared
> 8. Everything (reasonably non-destructive) allowed
> 9. a

Later in the same session:

> If behaviour changes significantly, I might be able to obtain all the versions of Aras DLLs and we can support all versions. Let's see what the worker says for thsi new DLL
