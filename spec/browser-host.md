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
- `src/browser.ts`, the browser entry (`dist/browser.js`), is `core.ts` and `createBrowserHost` with its option types (HOST-243), `createFetchTransport` with its option types (HOST-230 to HOST-233) and `LIBRARY_VERSION`, the version of `package.json`. It has no Node API: `nodeTransport` is not in it, and nothing it reaches imports `node:*`, reads `process` or `__dirname`, or calls `setImmediate`.

What makes that true is one replaced module. `src/host/default-host.ts` is the only module of the core that names the Node implementations (HOST-200), and the browser build resolves it to `src/host/default-host.browser.ts`, which builds the browser host on first use. The bundle does it with an esbuild plugin (`tools/browser-bundle.ts`, `replaceDefaultHost`: esbuild's `alias` maps packages, not files), and the browser typecheck (`tsconfig.browser.json`) does it with `moduleSuffixes` of `.browser` first. The same two settings inject `src/browser/buffer-shim.ts`, which defines the global `Buffer` the core is written against (HOST-262).

The browser bundle is built from `src/browser.ts` as an ES module for browsers (`target es2022`, `platform browser`) in one file, `dist/browser.js`, with its map and `dist/browser.d.ts`. It imports nothing: the two dependencies, `@xmldom/xmldom` and `xpath`, are inlined, with the `buffer` package that the shim re-exports and its two (`base64-js`, `ieee754`), and the licence text of all five is in the comment at the head of the file. It is not minified, so that a consumer's bundler decides that; its size is the budget of the guard below.

The rules above are held by tests, and each fails where it is broken:

- `tools/browser-bundle.test.ts` builds the entry with the options the shipped bundle is built with and fails if an input of the build is a `node:*` module, if the replaced module or a Node module of the host is in the graph, if any of `process`, `__dirname`, `__filename`, `setImmediate` or `global` is a free identifier of the output (esbuild's `define` replaces a reference to a name that nothing in the bundle declares, and only that, so a string or a property of that name does not count), if the output imports anything, or if it exceeds its size budget. It builds without the plugin and requires the build to fail on `node:fs`, so that the plugin is known to do the work. It loads the bundle in Node and runs `createBrowserHost` against fakes. It builds the Node entry as the Node build does and requires `node:http`, `node:https`, `node:fs` and `node:crypto` in it, so that the replacement did not leak into the Node build.
- `tsc -p tsconfig.browser.json`, whose only root is `src/browser.ts`, compiles the whole closure with no Node types (`types: []`), so that `process`, `NodeJS.*`, `setImmediate` and every `node:*` import are compile errors. `tools/browser-closure.test.ts` names the file when it fails.
- `src/entry-points.test.ts` requires the Node entry's names to be the core's and `nodeTransport`, and the browser entry's to be the core's and the three above, and the Node entry to have the 198 names it had before.

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

[14.0.7] The tests that must hold in a browser are the `*.browser.test.ts` files of `src/`, and they run in the `browser` project of `vitest.config.ts`: headless Chromium, Firefox and WebKit through the Playwright provider, one instance of each, so a failure names the browser it happened in. `npm run test:browser` runs that project alone and `npm test` runs the `node` project alone, whose files are the ones it ran before the browser project existed (a `*.browser.test.ts` file is excluded from it), so the browsers are not a prerequisite of the gate. The Playwright browsers are installed by `npx playwright install chromium firefox webkit`, and an installation that is already on the machine is reused (`PLAYWRIGHT_BROWSERS_PATH` names where they are, the default being the Playwright cache of the user).

The code a browser test loads has the graph of the shipped bundle (HOST-260), not the Node one:

- `src/host/default-host.ts` is replaced by `src/host/default-host.browser.ts` (`tools/browser-vitest.ts`, `replaceDefaultHostForVite`, the resolve hook that `tools/browser-bundle.ts` has for esbuild), so no module of the browser graph names `node:*`.
- The global `Buffer` is the `buffer` package (HOST-262), defined by `src/browser/buffer-setup.browser.ts` before any test file is loaded. A per-file transform cannot inject a global the way the bundler's `inject` does, so the setup file does what that injection does.

A test in a page cannot read the disk, so the recorded fixtures reach it through three commands that the Vitest server runs and the page calls (`tools/browser-vitest.ts`): `readFixtureTree(dir)`, the files under a folder as `{path, bytesBase64}` (paths relative to the folder, in code-unit order), `readFixtureBytes(path)`, one file as base64, and `readFixtureText(path)`, one file as UTF-8 text. A path is the repository-relative path, in POSIX form, and it must start with `fixtures/`, have no `.`, `..` or empty segment and no backslash or NUL, and resolve (links followed) to a place under `fixtures/`; any other path is refused with an error that names the rule. A folder is read without following links. `src/browser/test-support.browser.ts` wraps the commands for a test (`loadFixtureTree`, `readFixtureBytes`, `readFixtureText`). The cases that the browser replays use are listed in `src/browser/fixture-set.ts`, with the recorded blobs their transcripts name, and a test of the Node project holds the list to the disk (every case exists and carries what the replays read) and to a size budget.

The rule is held by `src/browser/smoke.browser.test.ts` (the bundle's imports, the host, the digests and the XML core and an item-file save, in each browser), by `tools/browser-vitest.test.ts` (the path restriction and the replaced module) and by `src/browser/fixture-set.test.ts`.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

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

What it offers beyond `HostFs`:

- `new MemoryVfs(files?, { cwd?, maxBytes? })` makes a tree and `mount(files)` puts files into it: `files` maps a path to bytes or to a string, written as UTF-8 without a byte-order mark. Each file is written as `writeFile` writes it after the folders above it that are missing are made, so a file that is there is replaced and a folder that is there is kept; a path that ends with `/` makes an empty folder and takes an empty content. A failure (a file in the way of a folder is `ENOTDIR`, a folder in the way of a file is `EISDIR`, or `ENOSPC`) throws as the call that failed does, and what was put before it stays.
- `snapshot(root = "/")` is a `Map` from the path of every file under the folder `root` (relative to it, with `/`) to a copy of its bytes, in the order of the paths by code unit. A missing folder is `ENOENT`, a file `ENOTDIR`.
- `toTree(root = "/")` is the sorted list of the same files and, with a trailing `/`, of every folder that has a file anywhere below it: the list the replay tests compare an output folder with (`tree()` in `src/export/run-replay.test.ts`), so a folder with no file in it is not listed.
- `size`, `clear()` (the tree is empty again) and `cwd`.

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
