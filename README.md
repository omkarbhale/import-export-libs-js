# import-export-libs-js

A readable TypeScript re-implementation of Aras Innovator's package import/export engine (`Libs.dll`, `Aras.Tools.SolutionUpgrade`). It runs on any OS with Node ≥ 20, with no .NET, PowerShell or Aras DLLs.

It reproduces three engine builds exactly, bugs included: **12.0** (12.0.0.13341), **14.0.7** (14.0.7.35492, the default) and **14.35** (14.35.0.43890).

**Status: scaffold.** The CLI (`import-export-libs-js`, alias `aras-pkg`) has no commands yet.

## Install

The repo is private, so install it from git:

```sh
npm install git+ssh://git@github.com/omkarbhale/import-export-libs-js.git
```

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build
```

- `AGENTS.md`: the rules every change follows.
- `spec/`: the behavioural spec, rule ids, bug register and source map.
- `roadmap/`: the design decisions.
