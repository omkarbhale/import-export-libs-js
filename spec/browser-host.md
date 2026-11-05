# The browser host: the seam between the engine and the machine it runs on

The engine (`Libs.dll`) ran on Windows with .NET Framework and read and wrote files, the clock, the user name and the network through the framework. This port re-implements the engine's behaviour; everything it needs from the machine goes through a **host**, so that the same code runs on Node and in a browser. These rules describe this library's own structure, not the engine's, and so, like `cli-export.md` and `export-modes.md`, they belong to no build of `Libs.dll` and the source map does not list them. They have variants only to say that the three builds share them.

The rules take the block `HOST-200` to `HOST-299`. The decisions behind them are in `roadmap/browser-host.md` (D1 to D14); a rule here says what the code does, and the record says why.

| Ids | Area |
|---|---|
| `HOST-200` to `HOST-209` | The seam and the environment |
| `HOST-210` to `HOST-229` | The file system |
| `HOST-230` to `HOST-239` | The transport |
| `HOST-240` to `HOST-249` | Digest, clock and time zone |
| `HOST-250` to `HOST-259` | The adapters that mount and commit a package |
| `HOST-260` to `HOST-269` | The bundle and its entry points |
| `HOST-270` to `HOST-299` | The facade and the Worker |

A later ticket defines a rule in the same pull request as the code that cites it (the coverage test fails on a rule that nothing cites), so only the rules of the code that exists appear below.

## HOST-200: the host seam

[14.0.7] Everything the engine's code asks of the machine goes through two interfaces, declared in `src/host/types.ts`:

- `HostFs`, the file system: `stat`, `readdir`, `readFile`, `writeFile`, `mkdir`, `rm`, `exists` and `openAppend`. Every method is synchronous, because the engine's file calls sit in synchronous chains (`io/windows-fs.ts`, `import/package-files.ts`, `export/run-log.ts`), and the File System Access API cannot be called from those.
- `HostEnv`, the rest: `platform`, `cwd`, `tmpdir`, `osUser`, `availableParallelism`, `monotonicNs`, `randomBytes`, `randomUuid`, `yieldTurn`, `windowsTimeZoneId` and `locale`.

Each member is named after the Node call it replaces, and its JSDoc gives the call site, so that a reader can check the interface against the code. The calls it replaces are:

| Node call | Host member |
|---|---|
| `statSync` | `HostFs.stat` |
| `readdirSync` (with and without `withFileTypes`) | `HostFs.readdir` |
| `readFileSync` | `HostFs.readFile` |
| `writeFileSync` | `HostFs.writeFile` |
| `mkdirSync` | `HostFs.mkdir` |
| `rmSync` | `HostFs.rm` |
| `existsSync` | `HostFs.exists` |
| `openSync` (`"a"`), `writeSync`, `closeSync` | `HostFs.openAppend` and `AppendHandle.write` and `close` |
| `process.platform` | `HostEnv.platform` |
| `process.cwd()` | `HostEnv.cwd` |
| `os.tmpdir()` | `HostEnv.tmpdir` |
| `os.userInfo()`, `os.hostname()`, `process.env.USERDOMAIN` | `HostEnv.osUser` |
| `os.availableParallelism()` | `HostEnv.availableParallelism` |
| `process.hrtime.bigint()` | `HostEnv.monotonicNs` |
| `crypto.randomBytes` | `HostEnv.randomBytes` |
| `crypto.randomUUID` | `HostEnv.randomUuid` |
| `setImmediate` | `HostEnv.yieldTurn` |
| the machine's time zone (`tzutil` or `Intl`) | `HostEnv.windowsTimeZoneId` |
| `Intl.DateTimeFormat().resolvedOptions().locale` | `HostEnv.locale` |

`PathEnvironment` (`io/host-path.ts`), which `ImportExportManager` already passes to the manifest, the output folder, `RunLog`, the loader and the DB-patch host, carries the two interfaces as optional members, `fs` and `host`. An absent member means the default host of the running platform, `defaultHost()`, so that a caller that passes neither behaves as it did before the seam. On Node the default host calls `node:fs`, `node:os`, `node:crypto` and the process as the code did before, and nothing a Node caller can observe changes.

The interfaces are the contract; the code that reads them (`fs ?? defaultHost().fs`) and the hosts that implement them come in later slices, and each says which of its members it covers. A host adds no behaviour of the engine: the Windows path rules (MAN-033, EXP-419 to EXP-423) stay in the file layer, above `HostFs`, and `HostFs` sees only the POSIX-form paths the layer hands it.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-201: errors carry the Node errno code

[14.0.7] A `HostFs` method that fails throws an error whose `code` property is the Node errno code of the failure, whichever host implements it:

| Code | Raised when |
|---|---|
| `ENOENT` | the path, or a folder on the way to it, does not exist |
| `ENOTDIR` | a folder on the way to the path is a file; `readdir` of a file |
| `EISDIR` | `readFile` or `writeFile` of a folder |
| `EACCES`, `EPERM` | the host refuses the operation |
| `EEXIST` | `mkdir` of a path that exists |
| `EBUSY` | a file is held open by another writer |

The file layer turns these codes into the exceptions .NET raises for the same failure and never reads the error's message: `translateFileError` (`io/host-path.ts`) for a read or write, `translateListError` (`import/package-files.ts`) for a folder listing, and the callers of `mkdir` and `rm` in `io/windows-fs.ts`, which read `EEXIST`, `EACCES` and `EPERM`. A host whose own errors carry other codes (a browser file API raises named `DOMException`s) maps them to these before they leave the host, so the file layer has one table.

An operation not in the table is an error of the host and keeps its own `code`; the file layer passes it up unchanged, as it does for a Node error it does not know.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-202: one portable path module, equal to Node's

[14.0.7] The file layer's path operations (`join`, `dirname`, `normalize`, `parse`, `isAbsolute`, `basename`, `relative`, `resolve`) are those of `src/io/path.ts`, on every host, and no file of the core imports `node:path`. The module has two flavours, `posix` and `win32`, and `flavourOf(platform)` gives the one a host platform's own file system follows (`win32` for `"win32"`, POSIX for any other name). Both are needed on every host: the engine's path strings are Windows paths whatever the OS (MAN-033), so `getFullPath` (MAN-004) runs the `win32` rules on Linux, in a browser and on Windows alike, and a browser has no `node:path` to ask.

For every function the core uses, each flavour returns exactly what the same flavour of Node's `path` returns for the same arguments: UNC roots (`\\host\share\x`), device roots (`\\.\pipe\x`, `\\?\C:\x`), a drive-relative `C:foo`, `..` above the root, repeated and trailing separators, forward slashes in `win32`, and the colon rule of `win32.normalize` that keeps a relative path from becoming a drive. The two functions that Node answers from the process, `resolve` and `relative`, take the current directory as an argument instead (`resolveFrom(cwd, …)`, `relativeFrom(cwd, …)`); a caller passes the current directory of its `PathEnvironment` (`environment.cwd`, the process's own when it has none). `resolveFrom(process.cwd(), x)` equals `resolve(x)`. One thing of Node's `win32.resolve` is not modelled: the per-drive current directories that Windows keeps in the `=C:` environment variables; a path on a drive other than the current directory's starts at that drive's root.

The module follows the device-path rules of the Node releases that read `\\.\` and `\\?\` as a root of their own (Node 20.20.2 and 24.18.1); `src/io/path.test.ts` compares every function with `node:path` over a hand-written list of the cases above and a seeded corpus of 20 000 pairs of paths on every run, and leaves the device paths out when it runs on a Node that reads them otherwise.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-240: the password digest is computed in-process, in pure TypeScript, identically on every host

[14.0.7] The MD5 and SHA-256 digests of WIRE-014 and WIRE-055 are computed by this library's own synchronous code (`src/client/hash.ts`: RFC 1321 and FIPS 180-4, over bytes, with no dependency, no Node built-in and no `Buffer`), on every host. They do not call `node:crypto` or Web Crypto, because the digest is taken in the constructors of the connection classes, which are synchronous (Web Crypto is asynchronous) and because Web Crypto has no MD5. The result is byte-for-byte what `node:crypto` gives for the same bytes. The text is turned into bytes by .NET's `Encoding.ASCII` as before (every code point above 0x7F, an astral one included, becomes one `?`), and the lowercase or uppercase form, the "already a hash is kept" rule and the `PasswordDigest` errors are those of WIRE-014 and WIRE-055.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-203: environment values come from the host environment

[14.0.7] The platform, the current directory, the temporary folder, the account name, the processor count, the monotonic clock, random bytes and UUIDs, the scheduler's turn and the process culture are read from `HostEnv` (HOST-200), and from nothing else: the code of the core does not read `process`, `node:os` or `node:crypto`, and does not call `setImmediate`. A `PathEnvironment` carries them as `host`; when `host` is absent they come from the default environment of the running platform, which on Node is `nodeHost` (`src/host/node.ts`), whose members call what the code called before the seam (`process.platform`, `process.cwd()`, `os.tmpdir()`, `os.userInfo()`, `os.hostname()`, `process.env.USERDOMAIN`, `os.availableParallelism()`, `process.hrtime.bigint()`, `crypto.randomBytes`, `crypto.randomUUID`, `setImmediate` and `Intl.DateTimeFormat().resolvedOptions().locale`). The module that names `nodeHost` is `src/host/default-host.ts`, the one module a browser build replaces.

A member of the `PathEnvironment` itself wins over the host: `platform` and `cwd`, where the caller gives them, are used as given, and the host's are the default (`envOf` in `io/host-path.ts`). The two are different things: the host says what machine the code runs on, and the environment's `platform` says which path rules a run follows, which tests set to Windows on a POSIX machine. The account name of the audit row (IMP-452) and the processor count (EXP-551) are the host's alone.

What the host answers is the host's own: a value that a caller sets for a run (the `culture` and `parallelism` options of `ImportExportManager`, the `osUser` of a helper, the `newId` of a DB-patch run) is used as given, and the host is asked only when the caller gave none.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-241: the monotonic clock and the wall clock are separate

[14.0.7] Two clocks are in use and they are not the same thing. The elapsed time of a step, which the import writes in the log as a `TimeSpan` (IMP-514), is measured on `HostEnv.monotonicNs`, a clock that never goes back and has an arbitrary origin, so that a change of the system time during a run does not change a duration. The date and time that the log, the audit row and the manifest write are the wall clock, `new Date()` (or the run's `now` option), and stay so: they are not taken from the host, and the host has no member for them.

## HOST-260: the browser entry exposes the portable core and the browser host, and no Node API

[14.0.7] The library has three source entry points, and they differ only in the implementations of the host seam (HOST-200) that they add to one shared surface:

- `src/core.ts` is everything portable: the engine's code (the client, the manifest, export, import, language packs, DB patches, the XML loader and the item-file writer) and the seam's own types, `Host`, `HostFs`, `HostEnv`, `HostFsError`, `HostStat`, `HostDirent`, `AppendHandle` and `PathEnvironment`, so that a caller can write a file system or an environment of its own. It names no `node:*` module and reads no `process`.
- `src/index.ts`, the Node entry (`dist/index.js`, with `dist/cli.js`), is `core.ts` and `nodeTransport` (HOST-230). Its set of exported names is what it was before the split, with the seam's types added; no function, class or constant was added or removed. The Node file system and environment (`nodeFs`, `nodeHost`) are the default host and are not exported.
- `src/browser.ts`, the browser entry (`dist/browser.js`), is `core.ts` and `createBrowserHost` with its option types (HOST-243), `createFetchTransport` with its option types (HOST-230 to HOST-233), `MemoryVfs` with its option types (HOST-215), the zip adapter, `vfsFromZip`, `vfsToZip` and `ZipError` with their option types (HOST-250, HOST-251), the adapters `mountFileList` and `mountDataTransfer` with `defaultInclude`, `stubsOf`, `STUB_THRESHOLD` and their option types (HOST-254, HOST-255), the directory adapter `mountDirectory`, `commitToDirectory`, `isFileSystemAccessSupported` and `CommitError` with its handle, option, progress and result types (HOST-252, HOST-253) and `LIBRARY_VERSION`, the version of `package.json`. It has no Node API: `nodeTransport` is not in it, and nothing it reaches imports `node:*`, reads `process` or `__dirname`, or calls `setImmediate`.

What makes that true is one replaced module. `src/host/default-host.ts` is the only module of the core that names the Node implementations (HOST-200), and the browser build resolves it to `src/host/default-host.browser.ts`, which builds the browser host on first use. The bundle does it with an esbuild plugin (`tools/browser-bundle.ts`, `replaceDefaultHost`: esbuild's `alias` maps packages, not files), and the browser typecheck (`tsconfig.browser.json`) does it with `moduleSuffixes` of `.browser` first. The same two settings inject `src/browser/buffer-shim.ts`, which defines the global `Buffer` the core is written against (HOST-262).

The browser bundle is built from `src/browser.ts` as an ES module for browsers (`target es2022`, `platform browser`) in one file, `dist/browser.js`, with its map and `dist/browser.d.ts`. It imports nothing: the three dependencies, `@xmldom/xmldom`, `xpath` and `fflate` (the zip adapter, HOST-250), are inlined, with the `buffer` package that the shim re-exports and its two (`base64-js`, `ieee754`), and the licence text of all six is in the comment at the head of the file. It is not minified, so that a consumer's bundler decides that; its size is the budget of the guard below.

The rules above are held by tests, and each fails where it is broken:

- `tools/browser-bundle.test.ts` builds the entry with the options the shipped bundle is built with and fails if an input of the build is a `node:*` module, if the replaced module or a Node module of the host is in the graph, if any of `process`, `__dirname`, `__filename`, `setImmediate` or `global` is a free identifier of the output (esbuild's `define` replaces a reference to a name that nothing in the bundle declares, and only that, so a string or a property of that name does not count), if the output imports anything, or if it exceeds its size budget. It builds without the plugin and requires the build to fail on `node:fs`, so that the plugin is known to do the work. It loads the bundle in Node and runs `createBrowserHost` against fakes. It builds the Node entry as the Node build does and requires `node:http`, `node:https`, `node:fs` and `node:crypto` in it, so that the replacement did not leak into the Node build.
- `tsc -p tsconfig.browser.json`, whose only root is `src/browser.ts`, compiles the whole closure with no Node types (`types: []`), so that `process`, `NodeJS.*`, `setImmediate` and every `node:*` import are compile errors. `tools/browser-closure.test.ts` names the file when it fails.
- `src/entry-points.test.ts` requires the Node entry's names to be the core's and `nodeTransport`, and the browser entry's to be the core's and the ones above, and the Node entry to have the 198 names it had before.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-261: the package exports a browser condition and a `./browser` subpath

[14.0.7] `package.json` says which file a consumer gets:

- `"."` is `{ "types": "./dist/index.d.ts", "browser": "./dist/browser.js", "import": "./dist/index.js" }`. Conditions are matched in the order written, so a bundler that resolves for browsers takes the `browser` condition and gets the browser bundle, and Node, which does not name `browser`, takes `import` and gets the Node build. `types` is first, as TypeScript requires, and is the Node entry's declarations for both, which are the browser's with `nodeTransport` added.
- `"./browser"` is `{ "types": "./dist/browser.d.ts", "import": "./dist/browser.js" }`, the explicit way to the browser bundle for a consumer that resolves its own conditions, or that wants it under Node (a test, a Worker host).
- `"sideEffects": false`: no module of the library has an effect when it is imported (the browser's default host is made on first use, HOST-243), so a bundler may drop what a consumer does not use.
- `"files"` is `["dist"]`, which holds `index.js`, its shared chunk, `cli.js`, `browser.js` and the declarations.

`npm run build` runs two tsup builds, one after the other: the Node build (`tsup.config.ts`, which cleans `dist/` and is unchanged by the browser entry) and the browser build (`tsup.browser.config.ts`), so that the two never race for the output folder. `prepare` runs both. `tools/browser-bundle.ts` holds what the browser build and its guard test share.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-262: the browser's `Buffer` is the `buffer` package, proven equal to Node's for every call the core makes

[14.0.7] The core's bytes are `Buffer`s (UTF-8 BOMs, latin1, UTF-16 with `swap16`, single-byte tables, base64): its source calls `Buffer.from`, `Buffer.concat`, `Buffer.alloc`, and the instance members `toString`, `swap16`, `subarray`, `length`, `readUInt16LE` and `writeUInt16LE`. In the browser bundle the global `Buffer` is the `buffer` package (feross, MIT), injected from `src/browser/buffer-shim.ts`; on Node it is Node's own. The two are required to give the same bytes and the same text for every call the source makes. This is proved, not assumed:

- `src/browser/buffer-shim.test.ts` runs each (method, encoding, corpus) triple of `src/browser/buffer-conformance.ts` on both and requires equal results: the bytes (as hex), the length, whether the result is a `Buffer`, and the text. The corpora are every UTF-16 code unit from U+0000 to U+FFFF in blocks of 256 (lone surrogates included), lone high and lone low surrogates in every position, astral characters, strings that mix them, NUL, the 0x7F, 0x80 and 0xFF boundaries, empty input, 500 seeded random strings of up to 10 000 code units, and for decoding all 256 byte values, valid and invalid UTF-8 and 500 seeded random byte strings. The encodings are `utf8`, `latin1`, `utf16le` and `base64`. A call that throws in Node must throw in the shim; the exception type and message need not be equal, and the suite prints the differences.
- `tools/buffer-usage.test.ts` reads the source with the TypeScript checker and fails when it calls a `Buffer` member (or an encoding of one) that the suite does not compare, so a new `Buffer` call must extend the suite.

The suite found two differences in UTF-8, which the core could observe, and the core does not call the shim there. `Buffer.from(text, "utf8")` (and `Buffer.byteLength`) of a string that ends in two or more unpaired high surrogates drops the last one in the package, and `buffer.toString("utf8")` of a truncated or invalid multi-byte sequence gives one U+FFFD per byte in the package where Node gives one per maximal subpart (the WHATWG decoder). Every UTF-8 encode and decode in the core therefore goes through `utf8Bytes(text)` and `utf8Text(bytes)` (`src/io/utf8.ts`), which use `TextEncoder` and `TextDecoder` (a byte-order mark is kept, as `toString` keeps it), and the suite proves those equal to Node's `Buffer` over the same corpora with the shim as the global `Buffer`. The guard test fails on a direct `Buffer.from(text, "utf8")` or `toString("utf8")` in the source. The package is pinned to an exact version, so the difference cannot appear or vanish without a change to `package.json`.

The browser typecheck (`tsconfig.browser.json`, which has no Node types) takes the type of `Buffer` from the package (`src/browser/globals.d.ts`).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-263: the browser tests run in real browsers through one vitest project, on the bundle's module graph, and read fixtures only through restricted commands

[14.0.7] The tests that must hold in a browser are the `*.browser.test.ts` files of `src/` and the unit tests that HOST-264 selects, and they run in the `browser` project of `vitest.config.ts`: headless Chromium, Firefox and WebKit through the Playwright provider, one instance of each, so a failure names the browser it happened in. `npm run test:browser` runs that project alone and `npm test` runs the `node` project alone, whose files are the ones it ran before the browser project existed (a `*.browser.test.ts` file is excluded from it), so the browsers are not a prerequisite of the gate. The Playwright browsers are installed by `npx playwright install chromium firefox webkit`, and an installation that is already on the machine is reused (`PLAYWRIGHT_BROWSERS_PATH` names where they are, the default being the Playwright cache of the user).

The code a browser test loads has the graph of the shipped bundle (HOST-260), not the Node one:

- `src/host/default-host.ts` is replaced by `src/host/default-host.browser.ts` (`tools/browser-vitest.ts`, `replaceDefaultHostForVite`, the resolve hook that `tools/browser-bundle.ts` has for esbuild), so no module of the browser graph names `node:*`.
- The global `Buffer` is the `buffer` package (HOST-262), defined by `src/browser/buffer-setup.browser.ts` before any test file is loaded. A per-file transform cannot inject a global the way the bundler's `inject` does, so the setup file does what that injection does.

A test in a page cannot read the disk, so the recorded fixtures reach it through three commands that the Vitest server runs and the page calls (`tools/browser-vitest.ts`): `readFixtureTree(dir)`, the files under a folder as `{path, bytesBase64}` (paths relative to the folder, in code-unit order), `readFixtureBytes(path)`, one file as base64, and `readFixtureText(path)`, one file as UTF-8 text. A path is the repository-relative path, in POSIX form, and it must start with `fixtures/`, have no `.`, `..` or empty segment and no backslash or NUL, and resolve (links followed) to a place under `fixtures/`; any other path is refused with an error that names the rule. A folder is read without following links. `src/browser/test-support.browser.ts` wraps the commands for a test (`loadFixtureTree`, `readFixtureBytes`, `readFixtureText`). The cases that the browser replays use are listed in `src/browser/fixture-set.ts`, with the recorded blobs their transcripts name, a blob recorded in several places being read from one file, and a test of the Node project holds the list to the disk (every case exists and carries what the replays read, and each blob read is the bytes its hash names) and to a size budget.

The rule is held by `src/browser/smoke.browser.test.ts` (the bundle's imports, the host, the digests and the XML core and an item-file save, in each browser), by `tools/browser-vitest.test.ts` (the path restriction and the replaced module) and by `src/browser/fixture-set.test.ts`.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-264: the unit tests that reach no Node API run unedited in the browsers, and the places a browser could differ have a test of their own

[14.0.7] The `browser` project (HOST-263) runs, besides the `*.browser.test.ts` files, the `*.test.ts` files of `src/` listed in `src/browser/pure-tests.json`, unedited, in Chromium, Firefox and WebKit. A test file is on the list when its closure is *pure*: the test and every file it imports at run time, with `src/host/default-host.ts` replaced by `default-host.browser.ts` as in the bundle (HOST-260), where

- no module is a Node built-in (with or without the `node:` prefix) and no string literal names one (`vi.mock("node:fs")`);
- no file lies outside `src/` (`oracle/`, `tools/`, `spec/` and `fixtures/` are Node-side files and data);
- no file uses a global that only Node has (`process`, `__dirname`, `__filename`, `require`, `setImmediate`, `global`, `module`, `exports`) that it does not declare itself, or locates a module with `import.meta.url`, `import.meta.dirname` or `import.meta.filename`.

`Buffer` is not on that list because the page has the `buffer` package as its `Buffer` (HOST-262). The tests of `spec/`, `tools/` and `oracle/` are Node-side by where they are and are never selected. A test that reads a recorded fixture does so through `node:fs`, so it is not selected; the browser tests that replay fixtures read them through the commands of HOST-263 instead.

`tools/browser-test-selection.ts` computes the list from the import graph (one esbuild run over every test file, whose metafile gives each closure) and `npx tsx tools/browser-test-selection.ts --write` writes the file. A test of the Node project (`tools/browser-test-selection.test.ts`) recomputes the list and fails when the file differs, so a test that became pure, or stopped being pure, is noticed, and it holds the classification to a set of small synthetic test trees.

The tests that would be on the list but read a fixture or a temporary folder, and that cover the places where a browser could differ from Node, have a browser twin in `src/browser/engine-compat.browser.test.ts`, which runs the same expectations over the in-memory tree (HOST-215) and the restricted fixture commands: the byte rules of the XML core on the recorded `read-bytes` vectors of `fixtures/xml-core/vectors.json` (UTF-8 with the engine's replacement rule, UTF-16 and UTF-32 with and without a byte-order mark, lone surrogates), each checked for the decoded text and for the loaded tree or the failure, except the vector the port refuses (IMP-016), the legacy encodings that an XML declaration may name and that are decoded by `TextDecoder(name)` (Shift_JIS, windows-125x, ISO-8859-x, GBK, GB2312, EUC-KR, EUC-JP, Big5, KOI8-R, macintosh, windows-874, ISO-2022-JP), the failure for a name the browser does not know, which is the engine's `System does not support '<name>' encoding.`, the order of the language codes (`normalize("NFD")`), the NLS word sort and the upper-case table of the recorded fixtures, and the date patterns of the run log with the process culture from `Intl`.

The browsers decode the labels of the WHATWG Encoding Standard, the same as Node's ICU, and all three agreed with Node on every encoding above, so there is no deviation to record: every browser failure that the selection or the twin would show is a defect to fix, and none has been found. If a browser lacked an encoding that the engine accepts, it would be a deviation of this document, listing the encodings, and the loader would raise the engine's failure for it.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.


## HOST-266: the recorded import, language-pack and DB-patch runs replay in the browsers with equal output

[14.0.7] `src/browser/import-replay.browser.test.ts` runs the recorded cases of `fixtures/<engine>/import`, `language-pack` and `dbpatch` that `fixture-set.ts` lists (HOST-263) in Chromium, Firefox and WebKit, as the Node replays on the in-memory file system do (HOST-218) and with the same comparisons, but in a page: every file of a recording, the transcript, the blobs it names, the log, the console text, the messages and the package folder, comes through the fixture commands, and the run is made with the browser's own host environment (`createBrowserEnv`, platform `browser`, HOST-243), a `MemoryVfs` (HOST-215) and the engine classes of `src/browser.ts` (HOST-260). The modules that the disk replays shared with the page are split so that a page imports the parts that read no file: `import/replay-compare.ts` (the shape of a step and the comparison of the log and the console), `import/sequential-connection.ts` and `db-patches/recorded-connection.ts` (the connections that serve a recording), each exported again from the module it was moved out of under its old name, unchanged.

- **Import.** The package folder of a step is mounted at `/input`, `ImportExportManager.importSolutions` runs it against the recorded answers, and the requests (each the next recorded call), the messages, the return code, the log (after the replacement of the run's own paths and date-times that HOST-218 applies, and for 12.0 the cut of a package's log after the last full 1024 characters, IMP-412), the console and the package folder, which an import reads and does not change, are the recording's. A run that the engine refused in the constructor (IMP-612, IMP-621) ends with the recorded exception and sends the recorded requests. The steps of a case run one after the other on one tree: the package folder of a step replaces `/input`, its log is a file of its own below `/work`, and the log of an earlier step is as it was after the later steps.
- **Language pack.** The pack is mounted at `/lp`, and the temporary package is made in the host's temp folder, which is `/tmp/` for the browser (`pathGetTempPath`, LP-030), with a name from the host's own random bytes (`pathGetRandomFileName`, eleven characters of `a-z0-5` with a dot after the eighth). The log, the messages and the console are compared after the name that was drawn is put back to the recorded one. A kept temporary package (`lpdebug`, LP-034) equals the recorded one byte for byte, the others are removed, and a run that fails leaves in the temp folder what `leftBehindTempFolder` names and nothing else (LP-035).
- **DB patch (14.35).** `ApplyDBUpdateManifest` runs over the step's input with the recorded ids (`DbPatchHost.newId`), and again with the ids from the browser host's `randomUuid` (the new row of DBP-030 and the link of DBP-043 are given one): the ids it drew are 32 upper-case hexadecimal characters, distinct, and not the recorded ones, and with each put back to the recorded id in what the engine sent, said and logged, the run is the recorded one.
- **Counts.** A test counts the steps it ran against the steps of the set, so a case left out fails the run: the import steps, the language packs and the DB-patch runs, for each engine, in each browser. The per-engine counts are in the pull request that introduced this rule, and the file prints them.
- **A corrupted recording fails.** A test changes one recorded request (an attribute added to the first item request after the login) and requires the replay of that step to fail, and requires the same step with the unchanged recording to pass.
- **Size.** In Chromium only, once, the test holds the whole folder `fixtures/14.0.7/import` (722 files, 38.3 MB: every case's package folder, transcript and recorded blob) in the tree of a `MemoryVfs`, runs all four steps of the largest recorded import (`s1-instances-versionable`) on that same tree, checks after the last heap reading that the folder is still held byte for byte, and prints `IMPORT-SIZE-SMOKE` with the browser, the file and byte counts, the milliseconds taken to read, mount and run, and the heap before, with the folder mounted and after the run. The heap is `performance.measureUserAgentSpecificMemory()` where the page is cross-origin isolated, the DevTools protocol's `Runtime.getHeapUsage` in Chromium, else `performance.memory`, which Chromium rounds, else it is left out. The numbers are the input of the memory budget of ticket 31 and are not asserted.

A case the Node replay runs is not left out here, and a defect that a browser shows is a defect of the library: it is fixed in the library with a test of the Node project first.

[12.0] Same as 14.0.7. A 12.0 step logs in with one request fewer (`LOGIN_CALLS_12_0`, WIRE-017), writes no log header (IMP-410), and has no language-pack or DB-patch run.

[14.35] Same as 14.0.7. The cases add the AML batch mode and the collected errors (IMP-500 to IMP-599), the scan of the installed languages in the constructor (IMP-610 to IMP-613), and the DB-patch runs (DBP-001 to DBP-044).

## HOST-210: the file layer touches files through `HostFs`, and Node's implementation is `node:fs` itself

[14.0.7] Every file the file layer reads, writes, lists, creates or deletes is reached through the `HostFs` (HOST-200) of the `PathEnvironment`, `environment.fs`, and where the environment has none through the default host, `defaultHost().fs`. That covers `fileExists`, `readFileBytes`, `writeFileBytes` and `translateFileError` (the check that the folder of a missing file exists) in `io/host-path.ts`, and every operation of `io/windows-fs.ts`: the lookup of a name, the listing of a folder to find a fold-equal spelling (EXP-420), `directoryExists`, `directoryCreateDirectory` and its single `mkdir`, `directoryDelete`, `writeVolumeFile` and `fileWriteAllText`. A path that these functions open never reaches `node:fs` by another way, so a host that stands in for the disk sees every file touch. The callers that pass the environment to them (the manifest, the output folder, the loader and the saver, the DB-patch host, the language-pack preprocessor) pass the whole of it, `fs` included. The package listing (`import/package-files.ts`) and the log file (`export/run-log.ts`) go through it too (HOST-212, HOST-213), so that no file of the core outside the CLI reaches `node:fs` except the Node implementation `nodeFs` itself.

On Node the default host's file system, `nodeFs` (`src/host/node-fs.ts`), is `node:fs`: `stat` is `statSync`, `readdir` is `readdirSync` with `withFileTypes`, `readFile` is `readFileSync` (a `Buffer`), `writeFile` is `writeFileSync`, `mkdir` is `mkdirSync` without `recursive`, `rm` is `rmSync` with `force` off, `exists` is `existsSync` and `openAppend` is `openSync(path, "a")` with `writeSync` and `closeSync`. It adds no behaviour and catches nothing: a failure is Node's own error, rethrown, so its `code` is the real errno (HOST-201) and its `path` the one Node names, which `directoryDelete` reads to name the file the host refused to delete (EXP-415). A `write` of `AppendHandle` writes all of the bytes or throws; Node's `writeSync` may write fewer, and the handle goes on until all are written. Nothing of what a Node caller can observe changes with the seam: the exceptions, their messages and the files written are those of the code before it.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-211: relative host paths in an exception resolve against the environment's current directory

[14.0.7] The full path that `translateFileError` puts in the exception it builds (`FileNotFoundException`, `DirectoryNotFoundException`, `UnauthorizedAccessException`) is the host path resolved against the current directory of the `PathEnvironment` (`environment.cwd`, and where it has none, `HostEnv.cwd()`; HOST-203), not the current directory of the process, and by the path rules of the environment's platform (HOST-202). The function takes the environment as its fourth argument, which defaults to `{}` (the default host); a caller that has an environment passes it, so that an exception names the same path the rest of the run uses. What the file system does with a relative path it is handed is its own: `HostFs` takes the path as the layer gives it, and a host whose current directory is not the environment's is the caller's mistake, not one the layer corrects.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-212: a folder listing is the host's, and the order it is read in is the engine's

[14.0.7] The import lists the folders of a package, the `*.xml` files of one, and (for the language scan of 14.35) every `*.xml` file below a folder, through `HostFs.readdir` of the `PathEnvironment` (HOST-210): `directoryGetDirectories`, `directoryGetXmlFiles` and `directoryGetXmlFilesRecursive` in `import/package-files.ts` (IMP-002 to IMP-006, IMP-611). A link in a listing is a folder or a file by what it points to, which `HostFs.stat` says (a link whose target is missing is neither). A file the import reads from a listing, `readListedFile`, is read through `HostFs.readFile`, and its bytes are a `Buffer` whichever host gave them; the exception of a file another process holds, `EBUSY` (HOST-201), is the `IOException` of a sharing violation, and any other failure goes through `translateFileError` (HOST-211). A failed listing is turned into the exception of .NET by its `code` (HOST-201, `translateListError`), and the full path in it is the folder resolved against the environment's current directory (HOST-211), not the process's.

The order of a listing is the engine's, never the host's: `HostFs.readdir` says in which order it lists a folder only that it is the host's own, and the import sorts every listing with `compareNtfsNames` (IMP-004), the one ordering of names in the code, before it uses it, whatever the host gave (a folder listed by creation order, by hash, reversed or shuffled gives the same result). The short (8.3) names that the sort of a file with a long name needs are computed from the set of names, not from the order they came in (`shortNamesOf`). Two names that differ only by case are told apart by their code units, so the order is total.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-213: the log's append handle is the host's, the one-writer rule is the engine's

[14.0.7] The log file (EXP-505) is opened for append with `HostFs.openAppend` of the `PathEnvironment` (HOST-210), once, when `RunLog.open` succeeds; the text of the run is held in memory and written as UTF-8 without a BOM through the handle's `write` when the log is disposed, and the handle's `close` is then called once, also when `write` threw. Disposing a second time does nothing.

The rule that one writer holds a log file at a time (bug EXP-541: a second `RunLog.open` on a path that an open one holds fails with the `IOException` of a sharing violation, `The process cannot access the file '<full path>' because it is being used by another process.`) is the log's own, and holds on every host: a process-wide set of the paths that are open, keyed by the full path of the host path in the environment's current directory and by the rules of the environment's platform (HOST-211), is checked before the host is asked and cleared when the writer is disposed. The host is never asked to refuse the second writer, and the rule does not depend on how it treats two handles on one file. The full path in the message, on a Windows path, is `GetFullPath` of the path as the engine was given it. A failure of `openAppend` goes through `translateFileError` as a failure of a write (a missing folder is a `DirectoryNotFoundException`), and does not enter the set.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-214: a `HostFs` is a case-sensitive POSIX tree with errno errors, and the suite `fs-conformance.ts` is its definition

[14.0.7] The file system under the file layer, `HostFs` (HOST-200), is a tree of folders and files as a POSIX disk has it, whatever machine stands behind it, and the suite `src/host/fs-conformance.ts` (`describeHostFs(name, makeFs)`) is the definition of that: a host is a `HostFs` when it passes every case, and a case that a host fails is the host's defect, not the case's. The suite is a vitest helper (the library's entry does not export it; it uses no Node built-in, no `Buffer` and no DOM, so a browser run can use it). `nodeFs` passes it against a temporary folder (`src/host/node-fs.conformance.test.ts`), so the cases describe what a disk really does, and the in-memory file system is held to the same cases. Each case names the call of the engine layer that depends on it (`file`, line, function and `HostFs` member); these `needs` tags document the call sites at the commit that adds the suite and are not checked against the code. `src/host/fs-conformance.test.ts` fails when the suite has fewer than sixty cases or when a `HostFs` member has no case.

What the cases require, over what HOST-200 and HOST-201 say of each member:

- **Names are exact and case-sensitive.** `A` and `a` are two entries, a file and a folder may differ only in case, and a spelling in another case is a missing path (`ENOENT`). The NTFS folding of the engine's volume (EXP-420, `ntfsFoldKey`) is done by the layer, above the host: `lookup` in `io/windows-fs.ts` asks `stat`, and on a miss lists the folder and compares the folded names itself. A name is stored and listed with the code points it was created with: `é` as one code point and as two are two different names, and a name ending in a dot or a space is not the name without it.
- **Errors are the errno of POSIX** (HOST-201): a missing path or a missing parent is `ENOENT`; a path that goes through a file is `ENOTDIR`, for every member that takes a path and for `readdir` of a file itself; `readFile`, `writeFile` and `openAppend` of a folder are `EISDIR` (`openAppend` may say `EPERM` where the host does); `mkdir` of anything that exists is `EEXIST`, and `mkdir` with a missing parent is `ENOENT` and makes nothing (there is no `recursive`). A failed call changes nothing, and `exists` never throws: it is false for a missing path, for a path below a file and for the empty path.
- **`rm` has no `force` and refuses a folder without `recursive`.** A missing path is `ENOENT` whichever flag is set. A folder without `recursive` is an error, empty or not, and nothing is removed: this is Node's own `rmSync`, which refuses a folder before it looks inside (`ERR_FS_EISDIR`), and the suite pins it as the disk does and pins no code for it, because the layer passes such an error up unchanged. With `recursive`, the path and everything under it go, siblings and the parent stay, and a removed name can be created again.
- **Bytes go in and out unchanged and are not shared.** `writeFile` creates or truncates and takes any bytes (every value, NUL, byte-order marks, CR LF, a zero-length array, three megabytes, a view of a larger buffer); `readFile` returns exactly those bytes. Neither keeps the array it was given nor hands out one the host still holds: changing the array after `writeFile`, or the one `readFile` returned, changes nothing in the file. The type of what `readFile` returns is a `Uint8Array` and no more (`nodeFs` gives a `Buffer`; the layer wraps it where it needs one).
- **`readdir` has no order.** The suite sorts what it gets, and the layer sorts with `compareNtfsNames` (HOST-212). It lists only the folder's own entries and never `.` or `..`; each entry has exactly `name`, `isFile`, `isDirectory` and `isSymbolicLink`, and a link is an entry of its own kind that is not followed.
- **`openAppend` appends.** It creates the file, appends each write after the one before (a zero-length write changes nothing), and appends across two handles opened one after the other, to what a `writeFile` left too. What was written is visible once the handle is closed and is not required to be before. A write of any size is written whole.
- **Paths are what the layer hands over**: POSIX form, absolute, with no `.` or `..` segment (the layer resolves them, HOST-202, and never passes one), so no case depends on how a host treats them. Names of 255 characters, an absolute path of 4 095 characters (the `PATH_MAX` of 4 096 with its terminator), and a tree a hundred folders deep work.

Some cases need something a particular disk lacks: links (the engine reads them in a package listing, `import/package-files.ts`, and a browser has none), a case-sensitive disk, names kept as given in Unicode normalisation, names with a trailing dot or space, long names, a path of 4 095 characters, and `ENOTDIR` from a path through a file. A case that needs one is marked `optional`, and the suite probes the capability once, by trying it on the host under test, and skips the cases that depend on it. A developer's Windows or macOS laptop therefore skips what its disk cannot do and runs the rest; the in-memory host declares no links and meets all the others, and the library's behaviour on a disk is the disk's.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-215: the browser's file system is a tree in memory: case-sensitive, spelled as created, without links, empty at the start

[14.0.7] `MemoryVfs` (`src/host/memory-fs.ts`) is the `HostFs` (HOST-200) of a page, a Worker or a test: a tree of folders and files that lives in memory and nowhere else, which imports no Node module and uses neither `Buffer` nor `process`. It meets every case of the suite of HOST-214 except the ones that need a link, which it declares it cannot do (the capability `symlink` of the suite): `memory-fs.conformance.test.ts` runs the suite on it, and a test there asserts that the cases it runs are exactly those `nodeFs` runs on a disk, less the cases that need a link. What the tree is, beyond HOST-214:

- **Empty at the start, in memory only.** A new tree has the root `/` and nothing in it, and two trees share nothing. Nothing is read from or written to a disk, a store or the network; the tree is gone with the page, and what a run leaves in it is for the caller to take out (`snapshot`, `toTree`) before that.
- **Case-sensitive and spelled as created.** A name is stored and listed with the code points it was given, with no normalisation, no folding of case, of dots or of spaces; the NTFS rules are the file layer's (HOST-210).
- **No links.** Every entry of `readdir` has `isSymbolicLink: false`, and `stat` has no link to follow.
- **The paths.** A path is resolved against the tree's current directory, `cwd` (default `/`, an absolute POSIX path, which need not exist), with the `posix` rules of `src/io/path.ts` (HOST-202): `.` and `..` segments, repeated separators, and `..` at the root staying at the root. The empty path is no path (`ENOENT`) and is not `cwd`. The root can be read, listed and asked about, but not written (`EISDIR`), made (`EEXIST`) or removed (`EPERM`). The tree's `cwd` is its own: it is the folder a relative host path that reaches it is resolved against, and a caller that sets `cwd` in the `PathEnvironment` of a run (HOST-211) gives the tree the same one.
- **The errors** are the ones of HOST-214 with the message Node gives (`ENOENT: no such file or directory, open '/x'`: the code, its text, the call and the path as it was given), and `code`, `syscall` and `path` set, so that `translateFileError` and `translateListError` treat them as a disk's. A folder removed without `recursive` is `ERR_FS_EISDIR`, as Node's `rmSync`. A write that would take the tree past its capacity is `ENOSPC` (`no space left on device, write '<path>'`), a code of no .NET exception, so that the file layer passes it up as it is, and the facade of the browser API (HOST ticket 28) turns it into a message for the caller.
- **The capacity** is `maxBytes`, the most bytes of file content the tree holds (the folders and names take none), default unlimited; it can be changed between calls. `writeFile` and `mount` throw `ENOSPC` for a write that would pass it and change nothing of the file they failed on; replacing a file with one that is not larger is never refused. `size` is the bytes of content now in the tree, which the memory budget of HOST ticket 31 reads.
- **Append handles buffer.** `openAppend` creates the file, empty, when it opens it, and what a handle is given is held in the handle and added to the end of the file when the handle is closed, in the order it was given, after whatever the file holds then; so a handle's writes are visible after `close` and not before (HOST-214 requires no more). A second handle on the same path while one is open is allowed, and each adds its own writes at its own `close`; the rule that a log has one writer is the engine's (HOST-213). A write past the capacity is `ENOSPC` at the write, counting what the handle holds. A handle stands for the file whatever is done to it: when the file is rewritten under it, its writes follow the new content, and when the file is removed they go nowhere and take no space, as appends to an unlinked file do. A write or a second `close` of a closed handle is `EBADF`.
- **Bytes are copied in and out.** What `writeFile`, `mount` and a handle's `write` are given is copied, so that the caller can reuse its array; what `readFile` and `snapshot` return is a copy, a plain `Uint8Array` and not a `Buffer`, so that the caller can change it.
- **What a disk does that the tree does not copy.** The matrix of HOST-217 found two, and both are left as they are. A name is a JavaScript string kept as it was given, so a name with an unpaired surrogate stays that name, where a disk stores UTF-8 and turns the unpaired surrogate into U+FFFD, which makes it another name. And the tree has no limit on the length of a name or of a path, where a Linux disk refuses a name of more than 255 bytes of UTF-8 with `ENAMETOOLONG` (the layers above the host keep the limits of the engine's volume, 255 UTF-16 units to a name and the path lengths of EXP-421, which hold on both). Neither bound is one the engine's results depend on: the engine cannot write the first on Windows, and the second is checked before the host is asked wherever the engine checks it. A disk cannot run a case that crosses them, so the two are not in the matrix: direct tests of `MemoryVfs` in `src/host/memory-fs.test.ts` pin them, that a name with an unpaired surrogate is kept and listed as given, and that a name of 300 characters and a path far past 255 bytes are accepted and read back.

What it offers beyond `HostFs`:

- `new MemoryVfs(files?, { cwd?, maxBytes? })` makes a tree and `mount(files)` puts files into it: `files` maps a path to bytes or to a string, written as UTF-8 without a byte-order mark. Each file is written as `writeFile` writes it after the folders above it that are missing are made, so a file that is there is replaced and a folder that is there is kept; a path that ends with `/` makes an empty folder and takes an empty content. A failure (a file in the way of a folder is `ENOTDIR`, a folder in the way of a file is `EISDIR`, or `ENOSPC`) throws as the call that failed does, and what was put before it stays.
- `snapshot(root = "/")` is a `Map` from the path of every file under the folder `root` (relative to it, with `/`) to a copy of its bytes, in the order of the paths by code unit. A stub has no bytes and is left out (HOST-252). A missing folder is `ENOENT`, a file `ENOTDIR`.
- `toTree(root = "/")` is the sorted list of the same files and, with a trailing `/`, of every folder that has a file anywhere below it: the list the replay tests compare an output folder with (`tree()` in `src/export/run-replay.test.ts`), so a folder with no file in it is not listed.
- `size`, `clear()` (the tree is empty again) and `cwd`.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-218: a run on the in-memory file system leaves what a run on a disk leaves, byte for byte

[14.0.7] An export, an import, a language-pack import and a DB-patch application give the same result whichever `HostFs` (HOST-200) stands under the file layer. A `PathEnvironment` with `fs` a `MemoryVfs` (HOST-215) and `host` a `HostEnv` that is no machine's (HOST-203) makes every file of the run, the package folder it reads, the output folder it writes, the manifest, the log and the temporary language package, a file of the virtual tree, and the run reads nothing from the process and touches no file of the disk. Given the recorded answers of the server, a recorded case run that way:

- sends the requests the engine sent, in the order the disk replay of the same case accepts, and returns what the engine returned, with the same messages, the same console text and the same return code;
- leaves an output folder equal to the recorded one: the same files and the same folders that hold a file, each file with the same bytes (`MemoryVfs.toTree` and `snapshot` against the folder of the case);
- writes a log that equals the recorded log after the same replacement of the run's own paths and date-times as the disk replay applies, and for a 14.35 export compares it in the parts the disk replay compares as a set (EXP-558);
- leaves a package folder it only reads as it found it, and a language pack's kept temporary package (LP-034) equal to the recorded one.

The cases are those of the disk replays: the 14.0.7 and 12.0 export cases (EXP-500 to EXP-520), the 14.35 export cases at one item at a time and, where the disk replay does it, with eight in flight (EXP-551), the import steps of the three builds (IMP-400 to IMP-471), the language-pack runs of 14.0.7 and 14.35 (LP-001 to LP-036) and the DB-patch steps of 14.35 (DBP-001 to DBP-044). A case that the disk replay leaves out, a 12.0 or 14.35 export that removes references to unknown packages, which wait for EXP-600 to EXP-699, is left out here for the same reason, and the test counts it. The current directory of the virtual run is `/work` on a `linux` platform: no recorded case runs the disk replay with a `win32` platform, so the virtual replay runs none either (the Windows path rules over the virtual tree are those of `fs-matrix.test.ts`, a later slice). The comparisons that the disk replays and these share are in the `replay-support.ts` modules beside them, so that no comparison is written twice.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-230: the HTTP transport is a seam; Node's implementation lives in the Node host

[14.0.7] The client is written against `HttpTransport`, and the types of the exchange (`TransportRequest`, `TransportResponse`, `TransportFailure`, `TransportError`, `HttpTransport`) are declared in `src/client/transport.ts`, a file that imports nothing from Node. The Node implementation, `nodeTransport` over `node:http` and `node:https`, is in `src/host/node-transport.ts`, the one file of `src/` that imports `node:http`; its behaviour is the engine's (WIRE-050 and the failure classes of `TransportError`) and is unchanged by being moved. The default host (HOST-203) answers a transport as its `transport` member, `defaultTransport()` in `src/host/default-host.ts`: `nodeTransport` on Node, and nothing in a host that has none.

`HttpServerConnection` uses `settings.transport`, and when that is absent the default host's. When both are absent, which no Node caller can see, the constructor throws `Error("a transport is required in this environment")`, so that a missing transport is a clear error at construction and not a `TypeError` at the first call. The public API of the Node entry is as before: `import { nodeTransport } from "import-export-libs-js"` still works; the portable client exports the types and not the implementation.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

The browser's implementation is `createFetchTransport` (`src/browser/fetch-transport.ts`), which has the contract of `nodeTransport` where a browser permits it: the request is sent as the engine built it, a status of 400 or above is a response and not an error, and the response carries its status, reason phrase, headers and whole body. Where a browser does not permit it, the differences are HOST-231 (failures), HOST-232 (headers and the reason phrase) and HOST-233 (cookies and credentials). The `fetch` it calls is injectable, so that its code is tested under Node's own `fetch` against a local server (`src/browser/fetch-transport.test.ts`) and in the browsers by the browser suites. Redirects are followed (`redirect: "follow"`; a manual redirect is opaque in a browser), nothing is cached (`cache: "no-store"`), the request is cross-origin capable (`mode: "cors"`), and the body is the request's bytes as they are. The browser caps the connections to one host (six on HTTP/1.1), so 14.35's parallel export (EXP-551) runs as it does elsewhere, only slower; nothing in the transport limits it further. `fetch` decompresses a compressed response itself, as `nodeTransport` does not; no Aras server compresses its answers.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-231: the browser transport's failures and timeouts

[14.0.7] `fetch` rejects with a `TypeError` for a network failure, a refused cross-origin request (CORS), a blocked mixed-content request, a name that does not resolve and a TLS failure alike, and the page cannot tell them apart. The browser transport therefore reports every one of them as `TransportError("refused", "Unable to connect to the remote server", host)`, where `nodeTransport` tells a refused connection from an unresolved name (`"unresolved"`, "The remote name could not be resolved: 'host'") and a failed TLS handshake (`"other"`). A caller that needs the cause reads the browser's console; a facade that reports the error says that a missing CORS entry on the server is the usual one. This is a deviation of the host, not an engine behaviour, and is not in `spec/bugs.md`. A failure while the body is being read (the connection drops, or the browser's own limit is hit) is `TransportError("other", <the error's message>)`, as `nodeTransport` has it.

The two timeouts of the request are kept, with the same error as `nodeTransport` (`TransportError("timeout", "The operation has timed out")`). `responseTimeoutMs`: an abort fires that long after the request is sent if the headers have not arrived. `readTimeoutMs`: the body is read chunk by chunk, and a wait for the next chunk that lasts that long aborts the exchange; a body that streams steadily is never timed out, however long it takes. A value of 0 or less waits for ever (the body is then read in one piece). A timer is cleared as soon as it has done its work, so nothing outlives the exchange.

A caller can cancel the exchange with the `signal` option. The cancel rejects `send` with the signal's own reason (an `AbortError`, as `fetch` raises it), not with a `TransportError`, so that a caller that cancelled is not told that the server could not be reached.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-232: forbidden request headers are dropped, and the reason phrase is filled in

[14.0.7] A browser's `fetch` ignores a request header whose name is forbidden (`Host`, `Cookie`, `Content-Length`, `Connection`, `Expect`, `Accept-Encoding`, `User-Agent`), and sets the real ones itself. The transport drops those names, compared without regard to case, before the call, and nowhere else: the `TransportRequest` the engine built, which the recorded exchanges and the captures pin, keeps them (the connection adds `Host`, `Cookie` and `Content-Length` to every SOAP request, `client/connection.ts`). The other headers go in the order they were given, with their names and values unchanged. The request's `Host` is the URL's, and its `Content-Length` is the body's length, which is what the engine sent.

The header `Aras-Request-ReadOnly` is dropped too unless the caller sets the option `sendReadOnlyHint`. A server whose CORS configuration does not list a header refuses the whole request, with no detail, and R35 as shipped does not list this one; the header is a hint, and no recorded exchange depends on it. The headers of the legacy login (`AUTHUSER`, `AUTHPASSWORD`, `DATABASE`) are sent; a legacy-only server must list them in its `Access-Control-Allow-Headers` (`roadmap/browser-cors-poc.md`).

The response's `reason` is `statusText` when that is not empty. Over HTTP/2, which has no reason phrase, Chromium and Firefox give an empty `statusText`, and the transport fills it from the standard phrase of the status (RFC 9110: the 40 statuses from 200 to 505 that a server answers with, `OK`, `Bad Request`, `Internal Server Error`, …), so that the client's `The remote server returned an error: (500) Internal Server Error.` (WIRE-050) reads as it does on Node. A status the table does not know keeps an empty phrase, as on Node. The client decides by the status number, never by the phrase. The response headers are what `Headers` gives: lower-case names, and repeated headers combined (`Set-Cookie` is not exposed to a page, HOST-233), where `nodeTransport` gives the names as sent and each repeated header apart. A header the server did not list in `Access-Control-Expose-Headers` is not readable cross-origin, and none of the three servers lists any: the engine reads only the body.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-233: cookies and credentials belong to the browser

[14.0.7] A page cannot read `Set-Cookie` or set `Cookie`, so the client's cookie jar (`client/connection.ts`, WIRE-005), which replays what the server set, stays empty in a browser: it is inert, and the transport does nothing for it. The browser keeps its own cookies and sends them as its rules say. The Aras session cookie is not needed: the requests that follow `ValidateUser` carry the bearer token and succeed without it on all three servers (`roadmap/browser-cors-poc.md`), and it cannot work across origins (it is `SameSite=Lax`).

The transport sends `credentials: "omit"` on every request by default. A request with credentials is refused by a server that answers `Access-Control-Allow-Origin: *`, which R23 and R35 do as shipped. A caller whose page is served from the server's own origin sets the option `credentials` to `"same-origin"` (or `"include"` for a server that names the page's origin and allows credentials) and gets the browser's cookies then; nothing else changes.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-242: the time zone id comes from the host, and a browser's is the CLDR mapping of its IANA zone

[14.0.7] The `TIMEZONE_NAME` header of a connection that was not given a time zone (WIRE-005) is `localWindowsTimeZoneId` (`src/client/timezone.ts`), which keeps its two paths and takes what it needs from the host environment (HOST-203): its platform is the host's `platform` and, on `win32`, its Windows id is `HostEnv.windowsTimeZoneId()`, with the line break of the answer trimmed. On Node that member is the `tzutil /g` call the code made before the seam (`src/host/node.ts` is the one file of the core that imports `node:child_process`). A `win32` host that has no Windows id to give (`undefined`) falls through to the second path. On every other platform, and so in a browser, whose `platform` is not `win32` and which has no `tzutil`, the id is the CLDR mapping (`WINDOWS_ZONE_IDS`, generated from CLDR 47) of the IANA zone that `Intl.DateTimeFormat().resolvedOptions().timeZone` says; a zone that the table does not know throws `UnmappedTimeZoneError` with its message as before (`pass the Windows id with --time-zone <id>`), and a caller passes `timeZoneName` in the connection settings, which is used as given and never reaches the host.

Every IANA zone that the runtime can report as its own zone (`Intl.supportedValuesOf("timeZone")`, the canonical zones of the ICU of the browser or Node) has an entry in the table, except those listed under "Time zones that the table does not map" below, each with its decision. `src/client/timezone-host.test.ts` fails on a zone of the running ICU that is neither in the table nor listed there; it runs in the browser project too (HOST ticket 23).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### Time zones that the table does not map

The table is CLDR 47's `windowsZones.xml` (WIRE-005) with a short list of supplements in the generator (`tools/windows-zones/generate.ts`). Checked against `Intl.supportedValuesOf("timeZone")` of Node 24.18.1 (ICU 78.3, tzdata 2026b), two zones were missing:

| IANA zone | Decision |
|---|---|
| `America/Coyhaique` | **Added** to the generator's supplements as `Magallanes Standard Time`, which is what CLDR 48 maps it to (tzdata 2025b made it a zone of its own, after CLDR 47). The supplement is dropped when the table moves to CLDR 48 or later. |
| `Antarctica/Troll` | **Documented, not mapped.** CLDR has no Windows zone for it (Troll Station keeps UTC and UTC+2, which no Windows zone does), and an invented one would send a wrong `TIMEZONE_NAME`. A browser or Node whose zone is `Antarctica/Troll` gets `UnmappedTimeZoneError`, and the caller passes the Windows id as `timeZoneName` (`--time-zone`). |

A zone that a later ICU adds and the table lacks fails the test above, which is the prompt to decide it the same way.

## HOST-243: the browser host's values: platform, current directory, temporary folder, parallelism, clock, randomness and yield

[14.0.7] `createBrowserHost(options)` (`src/browser/host.ts`) is the `Host` (HOST-200) of a page, a Worker or a test: the `HostEnv` of `createBrowserEnv`, the `fs` of the options and the `transport` of the options. It imports nothing from Node and reads the page's globals only when a member is used, so that importing the library reads none. `src/host/default-host.browser.ts` is the module that the browser bundle and the browser test configuration put in the place of `src/host/default-host.ts`; it exports the same `defaultHost`, `defaultHostEnv` and `defaultTransport`, answers the host of `createBrowserHost()` made on first use, and imports no `node:*` module.

The members of the `HostEnv` it answers:

| Member | Value |
|---|---|
| `platform` | `"browser"`, which every `platform === "win32"` test of the core reads as POSIX (HOST-202), so a path of the engine is relative or rooted by `\`, never a drive letter (HOST-216). |
| `cwd()` | the `cwd` option, default `"/"`. |
| `tmpdir()` | `"/tmp"`. |
| `osUser()` | `{ user, machine: "browser" }` with no `domain`; `user` is the `osUser` option, default `"user"`. The audit row (IMP-452) is `browser\<user>` for 12.0 and 14.0.7 and `<user>` for 14.35. The default is a placeholder so that no run throws for the want of one: the user name is a product-visible value, and the facade of the browser API gives it explicitly. |
| `availableParallelism()` | `navigator.hardwareConcurrency` when it is a whole number of at least 1, and 4 otherwise (a browser may leave it out, or round it, and a Worker has it as the page does). |
| `monotonicNs()` | `BigInt(Math.round(performance.now() * 1e6))`: a clock that never goes back, with the page's time origin (HOST-241). |
| `randomBytes(n)` | `n` bytes from `crypto.getRandomValues`, which works in a page that is not a secure context, filled in pieces of 65 536 bytes, the most one call accepts. |
| `randomUuid()` | `crypto.randomUUID()` where the page has it (a secure context), else an RFC 4122 version 4 UUID built from `randomBytes(16)`: lower-case, hyphenated, the version nibble `4` and the variant `8`, `9`, `a` or `b`. |
| `yieldTurn()` | resolves after a `MessageChannel` message has made the round trip, which runs the other tasks that are ready and, unlike `setTimeout`, is not held back by the browser's clamp of nested timers, in a window and in a Worker alike; a page with no `MessageChannel` waits `setTimeout(…, 0)` instead. Each call opens its own channel and closes both ports when the message arrives. |
| `windowsTimeZoneId()` | `undefined`: a browser has no `tzutil`, so `localWindowsTimeZoneId` takes the mapping of the IANA zone (HOST-242). |
| `locale()` | `Intl.DateTimeFormat().resolvedOptions().locale`. |

A host made without an `fs` has none to give: its file calls, `exists` included, fail with an error whose `code` is `ENOSYS` and whose message says to pass `fs`. That code is not one of the errno codes of HOST-201 on purpose, so that the file layer does not turn the error into the .NET exception of a missing file and hide the cause. A caller that runs the engine in a browser passes the file system it mounted (the in-memory tree of a later slice), and a host made without a `transport` has the fetch transport (HOST-230).

The `globals` option replaces `navigator`, `performance`, `crypto`, `MessageChannel` and `setTimeout`, one by one, which is how the Node tests run every member with fakes (`src/browser/host.test.ts`) and how the same members run, unfaked, in the browsers (the browser suites).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-216: a drive-letter or a UNC engine path is refused on every host that is not Windows, the browser's included

[14.0.7] A path of the engine that names a drive (`C:\out`, `C:rel`) or a network share (`\\server\share`) has no meaning on a host whose `platform` is not `win32`, and the file layer refuses it with `PathNotUsableError` (MAN-033) before it reaches the file system: `toHostPath` for a path that is read, and the path model of `io/windows-fs.ts` for a folder that is created, listed or deleted. The browser's `platform` is `"browser"` (HOST-243), so the rule is the one that already holds on Linux and macOS: in a browser a path of the engine is relative, or rooted by `\`, which is the root `/` of the file system that was mounted. A caller of the browser API is told so before the run, by the error, and not by a failure in the middle of it. The error message names the path.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-217: the file layer gives the same answer on every `HostFs`, which the matrix `fs-matrix.test.ts` pins

[14.0.7] The Windows-volume emulation (`io/windows-fs.ts`: NTFS case folding, the spelling of the first creation, trailing dots and spaces, device names, the 255-character name and the `\\?\` and UNC forms, EXP-420 to EXP-422), the host path (`io/host-path.ts`), the language-pack file primitives, the package loader and its listing in NTFS order (`import/package-files.ts`, `import/load-package-dom.ts`, IMP-002 to IMP-012) and the output folder of the export give the same result on any `HostFs` (HOST-214): the same return value, the same exception type and message, and the same tree left behind. They hold no state of their own about the host and rely on nothing of a disk beyond the members of the interface, so the in-memory tree (HOST-215) can stand in for it in a page.

`src/io/fs-matrix.test.ts` is the proof. The case tables of the unit tests of those modules (`io/windows-fs.cases.ts`, `io/host-path.cases.ts`, `io/language-pack-io.cases.ts`, `import/load-package-dom.cases.ts`, `export/export-folders.cases.ts`, each the data its test file used to hold inline and now imports) and the odd-name tables beside them are each run twice, once on `nodeFs` in a temporary folder and once on `MemoryVfs` under the same path, and the two runs must give equal outcomes, step by step, and equal trees, file for file and byte for byte. A difference is one of two things, and never an unexplained one: a defect of `MemoryVfs`, which is fixed, or something a disk does that a tree in memory cannot copy, whose case then carries a capability tag (the capabilities of HOST-214, probed on the host under test as the suite there does) and is skipped, with its reason, on the host that lacks it. The cases that need a link are skipped on the tree (HOST-215), and the two differences no disk can run, unpaired surrogates in a name and names and paths past a disk's limit, are pinned by the direct tests of `MemoryVfs` in `src/host/memory-fs.test.ts` (HOST-215) instead of by the matrix; the cases that need Windows itself (a hidden attribute, a locked file, a UNC share) are not run on either, as in the unit tests.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-250: a zip is mounted into the virtual file system; junk is skipped, a path that leaves the root and a zip too large are refused

[14.0.7] `vfsFromZip(bytes, options)` (`src/browser/zip.ts`) turns the bytes of a `.zip` into a `MemoryVfs` (HOST-215), which is how a package a user uploaded reaches an engine whose file calls are synchronous (HOST-200). It runs in one synchronous call, on `fflate`'s inflate, and holds the input, the tree and one inflated entry at the same time. It reads the central directory, not the local headers, and validates all of it before it inflates a byte: a zip that is refused leaves a new tree unmade and a tree given as `into` untouched, except by an entry whose data turns out to be damaged (below), which stops the mount with the entries before it in the tree.

- **The central directory.** The end record is found from the end of the file (a comment of any length), and ZIP64 (the 64-bit end record, and the 64-bit sizes and offset of an entry) is read where the 32-bit fields say `0xFFFF` or `0xFFFFFFFF`. A zip that is spread over several disks, an entry that is encrypted, an entry whose method is neither 0 (stored) nor 8 (deflate), and a size or offset past 2^53 are refused with `ZIP_UNSUPPORTED`. A file that is not a zip, a record that runs past the end of the file, an entry whose local header is not where the central directory says, an entry whose data runs past the end of the file, and a name or an extra field that does not fit its record are `ZIP_INVALID`. An empty zip (an end record only) is an empty tree.
- **The names.** A name is the entry's name as bytes, turned into text and then into a tree path: with the UTF-8 flag (bit 11) as UTF-8; without it, as the Unicode Path field (`0x7075`) of the entry gives it when the field's checksum is that of the name, otherwise as UTF-8 when the bytes are valid UTF-8 (the zips of Info-ZIP and Python on Linux and macOS, which write UTF-8 and leave the flag off), otherwise as code page 437 (the zips of Windows Explorer, which writes the OEM code page and leaves the flag off). Then each `\` is a `/` (the zips of Windows tools); every leading `./` and `/` is dropped; repeated `/` count as one; a `.` segment is dropped; a `..` segment removes the segment before it; and a `..` that has none to remove, because the path would leave the root of the zip, is refused with `ZIP_PATH_ESCAPES_ROOT` (zip-slip), even for an entry that would have been skipped. An entry whose name ends with `/` (after the `\` step) is a folder, and its data is not read. A name that is nothing after this (`./`, `/`) is the root and is dropped. Two entries with one path are two writes in the order of the central directory, the later replacing the earlier; a path that is a file in one entry and a folder in another (`a` and `a/b`, whether or not `root` would remove one of them), or a file in the zip and a folder in a tree given as `into` or the reverse, is `ZIP_CONFLICT`. Names are case-sensitive and kept as they are spelled, as in the tree (HOST-215).
- **Skipped.** An entry is skipped, whatever its content, when any segment of its path is `__MACOSX` or starts with `._` (AppleDouble files, which Finder's "Compress" puts next to the folder and inside it), or when its last segment is `.DS_Store` or `Thumbs.db`. The import lists every `*.xml*` file of a folder as a package file (IMP-004, `directoryGetXmlFiles`), so a `._item.xml` that reached the tree would be read as an item file. A skipped entry is not inflated, not counted in `maxBytes`, and does not decide the folder `root: "auto"` strips.
- **`root`.** By default, and with `root: "keep"`, the paths are kept. `root: "auto"` removes the first segment when every path that is kept has it and at least one is below it (a zip of one folder, the way a folder is zipped by hand); a zip with a file at its top, or with two top-level names, is mounted as it is. Paths are mounted at the root of the tree. `into` is the tree to mount into (an entry replaces a file that is there, and keeps the other files of the tree); without it a new `MemoryVfs` is made.
- **The size limit.** `maxBytes` (default 500 MiB, 524 288 000 bytes, the package budget; a caller may pass another value, `Infinity` included) bounds the bytes of the entries that are kept, as the central directory says they inflate to, and a zip over it is refused with `ZIP_TOO_LARGE` before any entry is inflated: the guard against a zip bomb. A tree given as `into` bounds them too, by its remaining capacity (its `maxBytes` minus its `size`, with no credit for a file an entry would replace), under the same refusal, whatever `maxBytes` says. Two further checks do not depend on the option: an entry that claims more than 1032 times the bytes it is stored in (the most a deflate stream can expand to) is `ZIP_INVALID`, so that a lie in the header cannot make the call reserve memory it does not need, and an entry whose data inflates to other than the size it declared, or does not match its CRC-32, is `ZIP_INVALID`.

The errors are `ZipError`s, an `Error` with a `code` (`ZIP_INVALID`, `ZIP_UNSUPPORTED`, `ZIP_PATH_ESCAPES_ROOT`, `ZIP_CONFLICT`, `ZIP_TOO_LARGE`) and a message that names the entry or the field.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-251: a zip is written from the tree deterministically, in the engine's directory order

[14.0.7] `vfsToZip(fs, folder = "/", options)` (`src/browser/zip.ts`) returns the files and folders under `folder` of a `HostFs` (a `MemoryVfs` in the browser) as the bytes of a `.zip`, with paths relative to `folder` written with `/`. The same tree gives the same bytes, on every host and in every time zone, so that an export can be compared and diffed:

- **Order.** In each folder the files and folders are put in the order the engine reads a directory in, NTFS order (IMP-004, `compareNtfsNames`), and a folder's entry (its name with a trailing `/`) comes before what is in it. A link is skipped, as the tree has none.
- **Time.** Every entry has one modification time: the option `mtime` (a `Date`, read in UTC, rounded down to the 2 s of the DOS format, between 1980 and 2107) or, by default, the DOS epoch, 1980-01-01 00:00:00. The wall clock is never read.
- **Names and flags.** The name is UTF-8, with the UTF-8 flag (bit 11) set for a name that has a non-ASCII character and not for the others. A name over 65 535 bytes is refused. The attributes mark a folder with the DOS directory bit and carry no Unix mode; there is no comment and no extra field.
- **Data.** `level: 6` (the default) deflates a file with `fflate`'s level 6 and stores it instead when that is not smaller; `level: 0` stores every file. An empty file is stored. No entry has a data descriptor. The compressed bytes depend on the version of `fflate`, which `package.json` pins exactly.
- **Size.** Up to 4 294 967 294 bytes in all and in each entry: a tree over it is refused with `ZIP_TOO_LARGE`. An archive of 65 535 entries or more gets the ZIP64 end record and the 32-bit end record says `0xFFFF`, which `vfsFromZip` reads and Info-ZIP and 7-Zip read.

The call holds the tree, the compressed entries and the zip it returns at one time. What the output holds is what `vfsFromZip` reads back: the files by bytes, the folders (the empty ones too) by name; a name with a `\` in it is the one thing that does not survive, because the reader takes `\` for `/` (HOST-250).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-254: a folder input's file list is mounted into the tree, by its relative paths, and an empty folder is not in it

[14.0.7] `mountFileList(files, options)` (`src/browser/file-list.ts`) puts the files of `<input type="file" webkitdirectory>` into a new `MemoryVfs` (HOST-215), rooted at `/`, before a run, and returns the tree. The library draws no control: the caller owns the input and passes `input.files` (or any iterable of `File`s). Every browser the library supports has the input, and it is the only way Firefox and WebKit give a page a folder from a picker.

- **The path of a file** is its `webkitRelativePath` (`Folder/sub/a.xml`), as the browser gives it: the picked folder's name first, then the folders, then the name. A file with no relative path (a plain multi-file input) goes to the root of the tree under its own name. A path is split on `/`; empty and `.` segments are dropped, and a `..` segment is refused with the code `ERR_MOUNT_UNSAFE_PATH` before anything is mounted, since it would leave the tree. Names are kept as the browser gives them (HOST-215).
- **The root.** `root: "keep"` (the default) keeps the first segment, so a picked folder `Pkg` mounts as `/Pkg/imports.mf`; `root: "auto"` removes it when every path of the list starts with the same folder, so that `imports.mf` is at the root of the tree. A file at the top of the list, or first segments that differ, leave the paths as they are. The caller decides, because what a folder's name means is the caller's.
- **What is read.** The files are read in the order of the list, one at a time, with `arrayBuffer()`, and the tree holds their bytes exactly. `include(path, kind, size)` decides per entry (`src/browser/mount-options.ts`): `content` reads the file; `stub` puts the name in the tree with no bytes, so that the 8.3 short names of its siblings (`shortNamesOf`, `import/ntfs-order.ts`) are numbered as with the file there, and lists its path in `stubsOf(vfs)`; `skip` leaves the entry out, a folder with everything below it. `path` is relative to the root of the tree with `/`, after the root is stripped. The default, `defaultInclude`, is `content` for every name that has `.xml` or `.mf` in it (what `matchesXmlPattern` and the manifest reader read) and for every file of 1 MiB or less, and `stub` for another file above 1 MiB (a binary the package carries). A file list shows files and no folders, so `include` is called for files only here.
- **A stub is the state of the file in the tree.** `stubsOf(vfs)` lists the paths that are stubs now. A full write of the path (`writeFile` or a re-mount), with bytes or empty, ends it, and so does removing the path or a folder above it; a file made there later is not a stub. `readFile` and `openAppend` of a stub fail with `EIO` (HOST-252): an empty read would hide the missing content, and an append would build a file without it.
- **The limit.** `maxBytes` is the most bytes of content one call may read. It is checked against the sizes of the files that would be read (stubs and skipped files are not counted) before the first one is read, and a list that needs more is refused with an error whose `code` is `ENOSPC`, so that nothing is half-read. By default a file list or a drop has no limit; a zip is limited by its reader, so with `vfsFromZip` and no `maxBytes` it has the 500 MiB default of HOST-250 and a larger one is refused with `ZIP_TOO_LARGE`.
- **Stopping and reporting.** `signal` is checked before each file; an abort rejects with the signal's reason. `onProgress` is called after each file, with its absolute path, the number of files put in so far and the bytes of content so far.
- **A zip.** A list of exactly one file with no folder in its path is a package archive and not a file of a package when its name ends in `.zip` (any case) or its first bytes are the magic of a zip (`PK` and `\x03\x04`, or `\x05\x06` for an empty archive); only those first bytes are read to see that. It is given to the zip reader of the options, `unzip`, which is `vfsFromZip` (HOST-250) with the root and the limit, and a `.zip` that is not a zip fails with the reader's own error. Without `unzip` the archive is refused with `ERR_MOUNT_NO_UNZIP` and a message that names the option. `include` and stubs apply to a file list and a drop and not to a zip: the reader takes the root and the limit only, so every entry of the archive is in the tree, under `maxBytes`, and `stubsOf` lists none of them. The unzipped tree is returned as it is, and after the unzip `onProgress` is called once per file of it, in the order of the paths compared by code unit, with the cumulative files and bytes (the unzip itself reports nothing). The files are read one at a time for it, so that the reports hold no second copy of the tree. `signal` is checked after the archive is read, before the unzip, and before each report. An archive in a picked folder, or among other files, is a file like any other.
- **An empty folder is not in the list.** A file list names files, so a folder with no file below it is not in it and not in the tree: a package folder with an empty sub-folder lists one fewer directory than the disk has. That has no effect on an import. The engine lists a folder's sub-folders (`Directory.GetDirectories`, IMP-002) and imports the `*.xml` files of each, and an empty folder has none; a folder that holds only other empty folders is the same. The count of listed folders differs, so a caller that compares trees (`toTree()` lists folders that have a file below them only, HOST-215) sees no difference, and one that lists `readdir` does. A caller that needs the empty folders drops the folder (HOST-255) or mounts a directory handle (HOST-252).

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-255: a drop is walked through its entries, in batches until the reader is empty, with the empty folders

[14.0.7] `mountDataTransfer(items, options)` (`src/browser/file-list.ts`) puts what a user dropped, files and folders, into a `MemoryVfs` (HOST-215) and returns the tree. It takes the `DataTransferItemList` of the drop event and the options of HOST-254; the library draws no drop target.

- **The entries are taken before the first `await`.** A browser empties the item list when the `drop` handler returns, so the function reads each item's `webkitGetAsEntry()` in its first, synchronous step, and walks the entries after. A caller calls it in the handler and awaits the result.
- **The entries are the way in.** `webkitGetAsEntry()` is in Chromium, Firefox and WebKit and gives the same tree in each; it is used for every item. An item with no entry (`null`) is ignored, and so are items that are not files (`kind` is not `file`). `getAsFileSystemHandle()` is not called: it is Chromium's only, and gives what the entry gives; a caller that has a handle mounts it with the directory adapter (HOST-252).
- **A folder is read to its end.** A reader's `readEntries` gives a batch, not the folder (Chromium gives at most 100), and gives an empty batch when the folder is done; a walk that calls it once loses the rest of a folder with more entries. The walk calls it until it answers empty, whatever the size of the batches, so a folder of 250 entries, or of exactly 200, is whole.
- **Empty folders are in the tree.** A folder is made when it is walked, with or without a file below it, which a file list cannot do (HOST-254).
- **The paths** are the entries' names from the dropped item down; several dropped items are several first segments, each with its name. `root: "auto"` removes the first segment when one folder was dropped (HOST-254). The order is the order the browser lists, and a reader or file that fails rejects the call with its error.
- **A zip.** A drop of exactly one file is read from its entry and, when it is a zip by its name or its magic, routed as in HOST-254.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-252: a folder behind a directory handle is mounted into the in-memory tree whole, with large files as stubs

[14.0.7] `mountDirectory(handle, options)` (`src/browser/fsa.ts`) copies the folder behind a `FileSystemDirectoryHandle` into a `MemoryVfs` (HOST-215) and returns the tree. It reaches the browser through the handle's own methods alone (`values()`, `getFile()` and the file's `size` and `arrayBuffer()`), so it works on a handle to the origin private file system (`navigator.storage.getDirectory()`, in every browser) and on a folder chosen with `showDirectoryPicker()` (Chromium). The tree it fills is `options.into` or a new one, and the contents of the handle go into its folder `options.at` (default `/`, made when it is missing). Every folder, however deep, is made, an empty one too.

- **Every name is present.** The import reads only the files its pattern matches (`*.xml…` by IMP-003 and IMP-004) and `imports.mf`, but the order and the 8.3 short names of a folder's files are computed from all of its sibling names (`shortNamesOf`, IMP-004), so the tree lists every file of the folder. A file that is not copied is a **stub**, as HOST-254 defines it: an entry with the name and no bytes, made by mounting an empty file and calling `MemoryVfs.markStub`, and listed by `MemoryVfs.stubs` and `stubsOf`. A stub is listed and has the type of a file, so a listing of the folder is the same with a stub as with the content; `stat` says it is a file; it counts nothing in `MemoryVfs.size`; `readFile` and `openAppend` of it fail with `EIO` (`EIO: i/o error, read '<path>'`, and `open` in place of `read` for `openAppend`), a code of no .NET exception, so that the file layer passes it up unchanged and a run that reads a stub fails with a cause and does not read an empty file; `writeFile` of its path makes it an ordinary file; `snapshot` leaves it out.
- **`include` decides each entry** by `(path, kind, size)`: `path` is relative to the handle, written with `/`; `size` is the file's size in bytes (0 for a folder). It answers `"content"` (copy the bytes), `"stub"` (a file: keep the name only; for a folder it is the same as `"content"`) or `"skip"` (leave the entry out; a folder is left out whole). A `"skip"` removes the name from the listing the engine reads, so a caller that skips a file takes the changes to the order and to the short names on itself; the default never skips. The default, `defaultInclude`, answers `"content"` for a folder, for a file whose name matches `/\.(xml|mf)/i` (the package files, `.xmlbak` and its kind, and the manifest) whatever its size, and for any other file of at most 1 MiB (`STUB_THRESHOLD`, 1 048 576 bytes); it answers `"stub"` for any other file above that.
- **A budget.** `maxBytes` bounds the bytes of content that the mount copies, counted over the files whose decision is `"content"`, and the room the target tree has left (`maxBytes - size` of `into`) bounds it too; every byte is counted as new, also where it replaces a file. A file that would pass the bound is refused before it is read, with an error whose `code` is `ENOSPC` (the facade of the browser API turns it into a message for the caller, HOST-215). A file's size is the `File`'s `size`; the bytes read are what is counted at the end.
- **All or nothing.** The walk takes a folder at a time and an entry at a time, in the order the handle lists them, and holds what it found; the tree is changed only when the whole walk has succeeded, in one step with no wait in it. A failure of the handle, a refusal by `maxBytes` and an abort by `options.signal` (checked before every entry and after each wait, rejecting with the signal's reason) leave the tree exactly as it was. The one failure after the walk is a clash with what `into` already holds (a file where a folder is needed, or the reverse), which fails as `MemoryVfs.mount` does and leaves what was put before it. `onProgress` is called after each entry with the counts so far (`files`, `directories`, `stubs`, `bytes`) and the path of the entry.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

## HOST-253: a tree is committed into a directory handle, nothing is removed unless asked, and a refused name is reported at the end

[14.0.7] `commitToDirectory(vfs, handle, options)` (`src/browser/fsa.ts`) writes the folder `options.from` of a `MemoryVfs` (default `/`) into the folder behind a `FileSystemDirectoryHandle`: each folder with `getDirectoryHandle(name, {create: true})` and each file with `getFileHandle(name, {create: true})`, `createWritable()`, one `write` of all the bytes and `close()`. A folder is written whole before the next: the files of a folder, up to 8 at a time, in the order of their names compared by code unit, then each subfolder in turn, in that order. An empty folder is made too. A stub (HOST-252) has no bytes and is not written, and is counted. It resolves with the counts (`files`, `directories`, `bytes`, `stubs`).

- **Nothing is removed unless the caller says.** By default the target keeps everything it holds, and a file with the name of one written is replaced. With `clean: true` the commit first removes every entry of the target (`removeEntry(name, {recursive: true})`); nothing else removes anything, and the library never sets `clean` itself.
- **`clean` never deletes what a stub stands for.** With `clean: true`, when the folder `options.from` of the tree holds stubs at any depth, the commit rejects before it touches the target: no `removeEntry`, no write, and the target stays as it was. The target may hold the only copy of a stubbed file, and a mount never causes the loss of a user's only copy. The error names the number of stubs. A stub elsewhere in the tree does not count, and without `clean` stubs are still skipped and counted.
- **A refused name does not stop the rest.** A name the handle refuses (an illegal name of the origin private file system or of the disk behind a picked folder) or a write that fails is recorded with its path, the rest of the tree is written, and when nothing is left the commit rejects with a `CommitError` whose `failures` lists each path with its error and whose `written` is the counts of what was written. A file whose write failed is aborted (`abort()` on its writable) and not counted. A folder the handle refused takes its contents with it, and they are not listed apart.
- **An abort says what was written.** `options.signal` is checked before each file and each folder is started. When it has been aborted the commit starts nothing more, waits for the writes in flight, and rejects with a `CommitError` that has `aborted` set, `cause` the signal's reason, and `written` the counts; whatever was written stays in the target. `onProgress` is called after each file and each folder written, with the counts so far and the path.

`isFileSystemAccessSupported()` is the feature test of the folder picker: true when the global (or the object given) has a `showDirectoryPicker` function, which is Chromium in a window and no other browser or Worker. A handle to the origin private file system needs no picker and is available everywhere, so it does not depend on this test.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.
