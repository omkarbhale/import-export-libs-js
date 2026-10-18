# lang-star-en-only

Languages = * over a package that uses en only. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages * (tickets 05 and 75).

## Exercises

`*` is replaced by the languages the packages use (en), the installed check passes, and nothing is deleted.

## Dev state

Dev had these `Language` items while the case ran: `en`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGSTAREN` | languages=["*"] | success (0) | 0 | 26 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0761E1F16FFB472696F712F57CC3DD52 |
| 2 | PackageDefinition | 5A96042D1032447BBFA145F739B02D80 |
| 3 | List | B170C4F565DF9C444CDDCFFD8BCDD517 |
| 4 | PackageGroup | 910E08CD734748439210DDF06C44396B |
| 5 | PackageElement | 74B28C9411BF42208483950AB31D6AE1 |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 74B28C9411BF42208483950AB31D6AE1 |
| 2 | PackageGroup | 910E08CD734748439210DDF06C44396B |
| 3 | List | B170C4F565DF9C444CDDCFFD8BCDD517 |
| 4 | PackageDefinition | 5A96042D1032447BBFA145F739B02D80 |
| 5 | DatabaseUpgrade | 0761E1F16FFB472696F712F57CC3DD52 |

## Spec rules

IMP-620, IMP-621, IMP-635. A spec or build ticket that pins this case adds more here (mapcheck F11).

## Files

Each `step-<n>/` folder:

| File | What |
|---|---|
| `run.json` | the oracle's run record: toolset identity, parameters, host info, and the cleanup report (created, deleted, kept) |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `input/` | the package folder the engine read: `imports.mf` and the item files |

The return code is `run.json` `host.result` (`ImportSolutions returned N`); `hostExit` is the host process's own exit code.

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-star-en-only --force`.
