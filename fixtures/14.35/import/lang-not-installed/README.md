# lang-not-installed

Languages = xx, a code the server lacks. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages not installed (tickets 05 and 75).

## Exercises

ThrowIfNoSelectedLanguagesInDatabase: the Language get is sent twice (once for the check, once to write the message), and the constructor throws a CItemException naming xx. The host ends with that exception; no item is read.

## Dev state

Dev had these `Language` items while the case ran: `en`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGXX` | languages=["xx"] | constructor refused (exception) | exception | 8 |

Step 1 ended the host with an exception:

```
Aras.Tools.SolutionUpgrade.CItemException: Some of the selected languages are not installed for current Aras Innovator: xx.
```

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 0

None.

### Deleted by the cleanup: 0

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

None.

## Spec rules

IMP-621, IMP-622. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-not-installed --force`.
