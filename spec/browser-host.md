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
