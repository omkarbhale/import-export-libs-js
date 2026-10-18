# lang-scan-stray-file

A malformed file in the package folder, Languages unset. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, scan (tickets 05 and 75).

## Exercises

The constructor scans every *.xml under the package folder, including the folder's own files that the import never reads: an AggregateException wrapping the XmlException ends the constructor, although 14.0.7 imports this package.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGSTRAY` | defaults | constructor refused (exception) | exception | 6 |

Step 1 ended the host with an exception:

```
System.AggregateException: One or more errors occurred. ---> System.Xml.XmlException: Data at the root level is invalid. Line 1, position 1.
```

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 0

None.

### Deleted by the cleanup: 0

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

None.

## Spec rules

IMP-610, IMP-611, IMP-612. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-scan-stray-file --force`.
