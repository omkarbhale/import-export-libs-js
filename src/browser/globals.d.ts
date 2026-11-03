/**
 * The ambient `Buffer` of the browser typecheck (`tsconfig.browser.json`, which compiles with `types: []` and so has no Node types).
 *
 * The core keeps `Buffer` on purpose (roadmap/browser-host.md, D5): the engine's byte-exact encodings (UTF-8 BOMs, latin1, UTF-16
 * with `swap16`, lone surrogates) are written against it, and the browser bundle gets the `buffer` package (feross) injected in
 * its place (`buffer-shim.ts`). This declaration takes its type from that package, so the typecheck sees the class the browser
 * will really run. `buffer-conformance.ts` lists which of its members the core calls and `buffer-shim.test.ts` proves each equal
 * to Node's; adding a Buffer call to the core means adding it there (the guard test `buffer-usage.test.ts` fails until you do).
 *
 * It is an ambient script, not a module, so it declares the global. The base project (`tsconfig.json`) has `@types/node` and
 * excludes this file, because both would declare `Buffer`. The specifier is `buffer/index.js` because the bare `buffer` is a
 * Node built-in, which Node and the Node typings resolve first.
 * @spec HOST-262
 */
declare var Buffer: typeof import("buffer/index.js").Buffer;
type Buffer = import("buffer/index.js").Buffer;
