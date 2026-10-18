# Import AML batch mode and collected errors

14.35 adds two optional modes to the package import, both off by default and both set on the import context. The **AML batch mode** sends many items in one `<AML>` request instead of one request per item, and falls back to the one-by-one import when a batch fails. The **collected-errors mode** keeps importing after an item fails, gathers the failures, and ends the run by reporting all of them. This document specifies both. The rules are `IMP-500` to `IMP-599`; `IMP-600` to `IMP-699` belong to the language selection.

Neither mode exists in 12.0 or 14.0.7. With both off, 14.35 imports as 14.0.7 does apart from the rules of `spec/import-run.md` and the other import documents. The loop that both modes change is `ImportProc` (`IMP-420` to `IMP-431`); the per-package wrapper they change is `ImportPackage` (`IMP-406`, `IMP-407`, `IMP-409`); the run is `ImportSolutions` (`IMP-400`, `IMP-408`). This document stops at the calls to the reference checks (`IMP-100`), the delayed resolution (`IMP-200`), `doImport` (`IMP-300`) and the registration (`IMP-429`), and picks up where they return or throw.

Sources:

- the 14.35 decompile of `Libs.dll` (`.decomp/14.35/`, never committed): `ImportExportManager` (`ImportProc`, `TryToFlushAmlBatch`, `ImportSingleWorkItem`, `CheckWorkItem`, `PostWorkItem`, `EnqueueWorkItem`, `CollectException`, `IsCollectImportErrorsThresholdExceeded`, `ImportPackage`, `ImportSolutions`, `LogError`), `ImportWorkItem`, `SUImportContext`, `DelayedResolutionManager`, `CImportItems.Import`, `CItemHelper.doImport`, `ResourceManager`;
- `fixtures/import-run/probe-14.35-batch.txt`: the scenarios `b01` to `b15` (batch mode) and `c01` to `c12` (collected errors), recorded from the real 14.35 `Libs.dll` and `IOM.dll` (version 15) on .NET Framework 4.8, with the stub connection of `fixtures/import-run/README.md`. The recording and its scrubbing are described there; the time spans the engine writes are replaced by `<TIME>`. A request IOM sends as `ApplyAML` is marked `[ApplyAML]`. Where a rule says *observed* it quotes a scenario by name. **What the stub answered is the probe's model of the server.** Everything a rule says about what Aras answers (to a batch, to an empty `<AML>`) is *inferred* until the 14.35 import fixtures (wayfinder ticket 75) record it.

Conventions are those of `spec/import-run.md`. **The queue** is the list of work items waiting for a batch (`IMP-511`). **A flush** is one call of `TryToFlushAmlBatch` (`IMP-513`). **The package queue** is the delayed-resolution manager of the package (`IMP-200`); **the batch queue** is the second manager that only batch mode uses (`IMP-520`).

## The settings

### IMP-500: SUImportContext gains four settings, all off by default

[12.0] Not present.

[14.0.7] Not present: `SUImportContext` has the five properties of `IMP-401` only.

[14.35] `SUImportContext` has four more plain properties, with no validation and no effect on anything but the rules below:

| Property | Type | Default | Meaning |
|---|---|---|---|
| `AmlBatchMode` | bool | false | Turns on the AML batch mode (`IMP-510` to `IMP-526`). |
| `AmlBatchMaxSize` | int | 0 | The queue length at which a batch is sent (`IMP-511`). |
| `CollectImportErrors` | bool | false | Turns on the collected-errors mode (`IMP-540` to `IMP-551`). |
| `CollectImportErrorsMaxCount` | int | 0 | The number of collected errors that ends the run (`IMP-541`). |

A host that sets `AmlBatchMode` and not `AmlBatchMaxSize` gets a batch of one item. A host that sets `CollectImportErrors` and not `CollectImportErrorsMaxCount` gets a run that stops at its first error (`IMP-541`). The settings are not written to the log header (`IMP-403`): the header has no line for them. The two modes are independent and can be on together (`IMP-551`). The context is read by the engine only, never changed.

## The AML batch mode

### IMP-510: The work item can be restored and tells whether it can be batched

[14.35] The `ImportWorkItem` of `IMP-422` has two members that only the batch mode uses.

- `OriginalOuterXml` is the `OuterXml` of the item document as the work item's constructor leaves it: after `doGetItem` is set to `0` and `tempKeyName` and `tempFullName` are removed (`IMP-422`), and before anything else touches the document (the existence test of `IMP-424`, the checks, the removal of languages, `doImport`). `RestoreOriginalXml()` loads that text back into the item document, discarding every change made since. The document's root element is then a **new** element; the work item's `ItemNode` still refers to the old one (`IMP-525`).
- `IsSuitableForBatching()` is true when the `ItemNode` has no child element named `Relationships` (a direct child; a deeper one does not count). It reads the element the work item was made with, not the current root.

[14.0.7] Not present.

### IMP-511: A batch collects the items without Relationships and is sent when the queue is full

[14.35] With `AmlBatchMode` on, `ImportProc` clears the queue (a list of work items) when it starts a package, and then handles each item that is not skipped (`IMP-424`) in this order (the checks and their failure handling are `IMP-518`):

1. `CheckWorkItem` runs against the batch queue instead of the package queue (`IMP-520`);
2. if the item is **not** suitable for batching (`IMP-510`), and the queue is not empty, a forced flush sends the queue (`IMP-513`); then the item is imported alone (`IMP-519`);
3. otherwise the item is appended to the queue and a **non-forced** flush runs: it does nothing when the queue holds fewer items than `AmlBatchMaxSize` (the test is `count < AmlBatchMaxSize`), and otherwise is a flush.

So an item is sent as soon as the queue reaches the maximum. A maximum of `1`, `0` or less than `0` flushes after every item (*observed*, `b02-batch-size-unset`, `b02b-batch-size-one`, `b02c-batch-size-negative`: one `ApplyAML` per item); a maximum of `2` with three items sends two and then one (`b01-batch-size-2`). After the last item of the package a forced flush runs whatever the queue holds (`IMP-515`). The status messages, the console dots and the `Processing` lines of `IMP-421` to `IMP-423` are written when the item is read, as without the batch, so they run ahead of the request that sends the item (`b01-batch-size-3`: the three `Item n of 3` messages, and the three `Processing` lines, precede the `Try to execute AMLs` line).

In the batch mode, `PostWorkItem` (`IMP-429`) is not called from the loop after each item; the flush calls it (`IMP-513`), and the item imported alone calls it itself (`IMP-519`). The skipped item is the exception (`IMP-522`).

[14.0.7] Not present.

### IMP-512: In the batch mode doImport prepares an item and does not send it

[14.35] The flush calls `CItemHelper.doImport(itemDocument, importContext)` for each work item; the overload throws `ArgumentNullException` (`itemInXml`, then `importContext`) for a null argument and calls `CImportItems.Import(item, importContext.bMerge, importContext.AmlBatchMode)`. With the batch mode on, `Import` does everything of `IMP-300` to `IMP-340` except the last step: it validates the item (`IMP-301` to `IMP-304`), in merge mode turns existing adds into edits (sending the lookups and unlocks of `IMP-310` to `IMP-314`), processes a versionable item (`IMP-320`, `IMP-330`) and then returns without the send of `IMP-340`. The document now holds what would have been sent. The single-item import (`IMP-519`, `IMP-516`) always uses the `doImport(item, bMerge)` overload, which sends.

Consequences, *observed*: in merge mode the lookups of the merge preparation are sent at the flush, one group per work item, between the checks and the `ApplyAML` (`b08-merge`); a validation failure (`IMP-301`, `IMP-302`) of the second item of a batch surfaces during the flush, after the first item was prepared, and fails the whole batch (`IMP-516`). The early return of the Property `lpimport` branch (a language-pack rewrite that sends its own SQL and returns before the send) is the language-pack ticket's (`LP-`); in the batch mode the flush still appends that item's document to the `<AML>`.

[14.0.7] Not present: `doImport` has the `mergeMode` overload only and always sends.

### IMP-513: A flush sends the queued items in one ApplyAML and registers them

[14.35] `TryToFlushAmlBatch(…, force)` returns at once when `force` is false and the queue holds fewer items than `AmlBatchMaxSize` (`IMP-511`). Otherwise, in a `try` block:

1. write the log line `Try to execute AMLs in AML batch mode...` and start a stopwatch;
2. for each queued work item, in queue order, call `doImport(item, importContext)` (`IMP-512`) and append the item document's `OuterXml` to a text that started as `<AML>`; close it with `</AML>`;
3. send it with `Innovator.applyAML` (the `ApplyAML` action, `WIRE-004`, so the request is the bare text `<AML>…</AML>`); if the answer is an error, throw `CItemException` built from the response alone (the pretty-printed text of `WIRE-051` for 14.35). A non-error answer is ignored;
4. stop the stopwatch (this is the *batch time*) and restart it; for each work item, set its `Id` from the `id` attribute of its **`ItemNode`** (the empty string when there is none; `IMP-525`) and call `PostWorkItem` (`IMP-429`), which writes its lines to the package log and registers the item;
5. add the entries of the batch queue to the package queue, in order, through `AddDelayedAmls` (each goes through `AddDelayedAmlItem`, so an entry equal to one the package queue already holds is dropped, `IMP-251`);
6. stop the stopwatch (the *resolve-dependencies time*) and write the log lines of `IMP-514`.

Whatever happened, a `finally` block empties the queue and replaces the batch queue with a new empty manager. An exception of steps 1 to 6 is handled by `IMP-516`.

*Observed* (`b01-batch-size-3`, `b08-merge`): the request order of a package of List, List and Method with a maximum of three is the three existence tests and type lookups of the checks, one `ApplyAML` holding the three items in the order the loop read them, then the registration requests of the three (`PackageGroup`, `PackageElement`), then the empty `ApplyAML` of `IMP-515`. The items come in the order `build.xsl` gave them (`IMP-020`), which is not the order of the files.

[14.0.7] Not present.

### IMP-514: The batch writes four texts of its own

[14.35] The catalogue (`IMP-470`) has these keys, used only by the batch mode. `{0}` and `{1}` are `TimeSpan.ToString()` values (`[d.]hh:mm:ss[.fffffff]`, the fraction omitted when it is exactly zero), a port may write the elapsed time in that form.

| Key | Template | Written |
|---|---|---|
| `TryToBatchAML` | `Try to execute AMLs in AML batch mode...` | step 1 of `IMP-513` |
| `TryToBatchAMLSuccess` | `AML successfully applied in AML batch mode:\r\n   AML batch time: {0}\r\n   Resolve dependencies time: {1}` | step 6 of `IMP-513` |
| `TryToBatchAMLFailed` | `Error of import in AML batch mode:\r\n {0}` | `IMP-516`, `{0}` the `Message` of the exception |
| `TryToExecuteAMLOneByOne` | `Try to execute AML one by one...` | `IMP-516` |
| `AMLBatchCheckDependenciesWarning` | `Error of check dependencies in AML batch mode:\r\n {0}` | `IMP-518` |
| `TryToResolveAMLBatchCheckDependencies` | `Trying to resolve AML dependencies in AML batch mode...` | `IMP-518` (the engine passes the message as an argument, the template has no place for it) |

All are written to the package log with `WriteLine`. The `WarningTryToResolve` text of `IMP-427` is also used (`IMP-516`, `IMP-518`). The batch mode sends no message of its own to the host.

[14.0.7] Not present.

### IMP-515: An empty queue is flushed as an empty ApplyAML (bug)

[14.35] Two forced flushes run whatever the queue holds: the one after the last item of the package (`IMP-511`) and the one that the failed check of `IMP-518` forces. (The third forced flush, before an item with Relationships, is guarded by a non-empty queue.) A forced flush of an empty queue runs all six steps of `IMP-513`: it writes `Try to execute AMLs…`, sends the request `<AML></AML>` and, if that is accepted, writes the success lines with two time spans.

*Observed* (`b01-batch-size-3`, `b02-batch-size-unset`, `b03-batch-no-items`, `b15-check-fails-empty-queue`): when the last item was sent by its own non-forced flush, or the package has no items, or the first item's check failed, the package ends with an `ApplyAML` whose body is `<AML></AML>`. What Aras answers to an empty `<AML>` is not known (inferred: the stub accepted it). If it answers with a fault, the engine takes the failure path of `IMP-516` with an empty queue, which logs the failure and sends the `WarningTryToResolve` warning but imports nothing. Registered in `bugs.md`; ticket 75 records the real answer.

[14.0.7] Not present.

### IMP-516: A failed flush restores each item and imports it alone

[14.35] Any exception of steps 1 to 6 of `IMP-513` runs the `catch` block of `TryToFlushAmlBatch`:

1. write `Error of import in AML batch mode:` followed by the exception's `Message` to the package log (`IMP-514`);
2. send the `warning` message with the `WarningTryToResolve` text and the same `Message` (`IMP-427`);
3. write `Try to execute AML one by one...` to the package log;
4. for each work item still in the queue, in order: `RestoreOriginalXml()` (`IMP-510`), `CheckWorkItem` against the **package** queue (`IMP-100`), `ImportSingleWorkItem` (`IMP-427`, `IMP-428`: the send, with the delete retry of `IMP-427`) and `PostWorkItem` (`IMP-429`).

Then the `finally` block of `IMP-513` runs. A failure inside step 4 leaves the `catch` block with that exception and ends the loop (`IMP-517`).

Everything the failed attempt did stays done. The registrations of step 4 of `IMP-513` that ran before the failure were written (`IMP-523`); the `ApplyAML` itself may have been applied by the server before the failure of a later step (`IMP-523`). The entries that the failed batch had in the batch queue are discarded by the `finally` block (`IMP-521`).

*Observed* (`b04-batch-fails-fallback`): the `ApplyAML` is answered with a fault; the log has the failure text (the pretty-printed fault), the `Try to execute AML one by one...` line, then for each item a reference-check block (type definitions from cache), `Item successfully applied(add)…` and the registration lines. The checks are repeated, but the lookups they make are answered by the helper's caches (`IMP-181`), so no check request is sent again. The warning message holds the same fault text. The package ends normally.

[14.0.7] Not present.

### IMP-517: The one-by-one fallback drops the items after the first one that fails (bug)

[14.35] The loop of step 4 of `IMP-516` is inside the `catch` block, with no handler of its own. When the check, the send or the registration of one item throws, the exception leaves the block, the `finally` block empties the queue, and the items after it are neither checked, sent nor registered. Without collected errors the exception ends the package (`IMP-545`), so nothing is lost silently. With collected errors on, the caller of the flush collects the exception (`IMP-542`) and the run continues: the dropped items are never imported and never reported.

*Observed* (`b05-fallback-item-fails`: the package fails at the second item and the Method behind it is never sent; `c12-collect-fallback-item-fails`: the error is collected, the package ends, and the request list contains no `Method` add although `Item 3 of 3: Method - DoIt` was announced). Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-518: A failed check in the batch mode flushes the queue and checks the item again

[14.35] `CheckWorkItem` (`IMP-425`, `IMP-100`) is called for the item inside a `try`. In the batch mode an exception of any kind is handled like this, in a nested `try` (outside the batch mode it is simply rethrown, which `IMP-542` describes):

1. write `Error of check dependencies in AML batch mode:` and the `Message` to the package log; send the `warning` message with `WarningTryToResolve` and the `Message`; write `Trying to resolve AML dependencies in AML batch mode...`;
2. a forced flush (`IMP-513`, so `IMP-515` applies to an empty queue) sends everything that was waiting, so that what the failed check may depend on exists;
3. `RestoreOriginalXml()` on the item, and `CheckWorkItem` again against the batch queue. A second failure leaves the handler: without collected errors it ends the package; with them it is collected (`IMP-542`) and the item **goes on** (`IMP-543`).

The item whose check failed is not part of the flushed queue (it is appended later, `IMP-511`). *Observed* (`b06-check-fails-once`: the check of the Method fails once, the two waiting List items are sent, the Method is checked again, queued and sent by the final flush; `b06b-check-fails-always`: the two List items are sent and registered, then the package fails with the check's fault, the Method is never sent).

[14.0.7] Not present.

### IMP-519: An item with Relationships is checked, then imported alone after a flush

[14.35] An item whose `ItemNode` has a `Relationships` child (`IMP-510`) is checked against the batch queue (`IMP-511`, step 1), and then: if the queue is not empty, a forced flush sends it first; then `ImportSingleWorkItem` sends the item itself (the `doImport(item, bMerge)` overload, so with the delete retry of `IMP-427`) and `PostWorkItem` registers it. Its position is therefore after the items that preceded it in the queue and before the ones that follow.

*Observed* (`b09-relationships-item`): List and Method are sent in one `ApplyAML` just before the Part with Relationships, which is sent alone and registered at once; the Part without Relationships behind it is queued and sent by the final flush. The existence test and the related-item check of the Part come **before** the flush of its predecessors. When the flush fails (`b09b-relationships-item-batch-fails`), the predecessors are imported alone first and the Part follows.

[14.0.7] Not present.

### IMP-520: The batch has its own delayed-resolution queue, handed over when a flush succeeds

[14.35] `ImportProc` creates two `DelayedResolutionManager`s for the package: the package queue and, in the field `_AmlBachDelayedResolutionManager`, the batch queue. With the batch mode on, the checks of every item run against the batch queue (`IMP-511`); the package queue receives entries from the checks of the fallback (`IMP-516`, step 4) and from the retry of `IMP-427`, and at the end of the package it is the one that `ExecuteDelayedResolution` runs (`IMP-240`). `GetDelayedAmls()` returns the batch queue's list, and `AddDelayedAmls(list)` adds each entry of a list to the package queue through `AddDelayedAmlItem` (`IMP-251`: duplicates are dropped).

A flush hands the batch queue over to the package queue after the registration (step 5 of `IMP-513`), and then replaces the batch queue with an empty one in its `finally` block. A delayed entry is born only for a reference inside a `Relationships` element (the routines of `IMP-210`, `IMP-212` and `IMP-220` need the relationship's parent and grandparent; a plain item such as a `Property` edit fails with the `Wrong format of the AML that contains tag` exception instead, *observed* in `b10-delayed-plain-item`, where the failure takes the path of `IMP-518` and the package fails). So the entries in the batch queue come from the items imported alone (`IMP-519`), whose entries wait there until the next flush.

*Observed* (`b10b-delayed-unbatched-item-ok`): a Part with a related item that does not exist comes first; List and Method are queued behind it; the final flush succeeds and the Part's delayed AML runs at the end of the package, after the flush that handed it over. The order of the package queue is the order of the hand-overs and of the fallback's own entries.

[14.0.7] Not present.

### IMP-521: The delayed entries of an item imported alone are lost when the next flush fails (bug)

[14.35] An item with Relationships is checked against the batch queue, so its delayed entries sit there (`IMP-520`) and its document has already lost the relationships that were delayed. If the flush that follows fails, the `finally` block replaces the batch queue and the entries are gone: the item is imported alone without those relationships (`IMP-519`), and nothing will ever apply them. The package ends as a success.

*Observed* (`b10c-delayed-unbatched-item`): the Part's `Part BOM` relationship with a missing `related_id` is removed from the item and never queued for the end of the package; the log has no `DELAYED RESOLUTION` line, the request of the Part holds an empty `<Relationships></Relationships>`, and the run returns `0`. Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-522: In the batch mode a skipped existing item is not registered (bug)

[14.35] The skip of `IMP-424` still writes `Item successfully skipped…`. In the item loop the call to `PostWorkItem` that registers every item in the package definition is `if (!AmlBatchMode)`; with the batch mode on, only the flush and the item imported alone register (`IMP-513`, `IMP-519`), and a skipped item reaches neither. So an item that already exists is left out of the package definition that this run builds. Without the batch mode `PostWorkItem` registers it (`IMP-424`, `s03-skip-existing`).

*Observed* (`b07-skip-existing`: the List that exists is skipped; the request list holds the `PackageElement` add for the Method only). Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-523: A failure after a successful ApplyAML sends the batch again (bug)

[14.35] Steps 4 and 5 of `IMP-513` run after the server applied the batch. The registration of an item (`PostWorkItem`) can fail (a request for the package group or the element is refused). The exception is caught by `IMP-516`, which does not know the batch was applied: it restores every item and imports it alone, so the items go to the server a second time. Items that are registered before the failing one are registered a second time too (the element lookup of `IMP-445` then finds them).

*Observed* (`b14-post-fails-after-apply`: the first `PackageElement` add is refused once; the log says `Error of import in AML batch mode`, and the requests then hold the `add` of the List and of the Method again, one by one, and the registrations). With real Aras the second `add` of an item that exists is answered with an error (the existence of the item is not tested again), inferred; ticket 75 can record it. Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-524: A cancel drops the waiting items

[14.35] The cancel test is the first thing the loop does for each item (`IMP-409`). It returns from `ImportProc` without flushing: the items in the queue were checked, counted and announced, but are never sent, never registered and never reported. The delayed resolution of the package does not run either (`IMP-409`), so the package ends as `IMP-409` describes (a failure, status 2) with the queued items missing from the database.

*Observed* (`b11-cancel-with-queue`: a `Cancel()` during the third item's check, two items in the queue, a fourth item to come: no `ApplyAML` is sent, the log has `Import was canceled by user`, the package row is written with status 2 and `1` is returned).

[14.0.7] Not present.

### IMP-525: After a restore the work item's id comes from the detached element (bug)

[14.35] `RestoreOriginalXml` loads text into the item document, which replaces its root element (`IMP-510`). `ImportWorkItem.ItemNode`, which `ImportSingleWorkItem` and step 4 of `IMP-513` read the `id` from (`IMP-428`), and `IsSuitableForBatching` reads the relationships of, is not refreshed: it is the old element, with the attributes it had when the restore happened. Everything else works on the document's new root.

The registered `id` therefore comes from the first attempt's element, while the request carries the second attempt's. They differ when the first attempt rewrote the id: the merge preparation of a versionable item moves it to its current generation (`IMP-320`), and the existence test of `IMP-424` does the same without merge.

*Observed* (`b13-stale-item-node`: merge on, a versionable Part whose current id changes between lookups from `PCUR1` to `PCUR2`; the batch is refused once; the single import sends `id="PCUR2"` and the item is registered with the config id of `PCUR1`). Registered in `bugs.md`. With a server that answers the same current id every time, the two ids are equal and nothing shows.

[14.0.7] Not present.

### IMP-526: A delete is retried only when it is sent alone

[14.35] A `delete` item is suitable for batching (it has no relationships) and goes into the `<AML>` as `<Item … action="delete" doGetItem="0" />`; its check is the light one (`IMP-427`, `ThoroughCheck` false). If the batch fails, the fallback sends it with `ImportSingleWorkItem`, which has the retry of `IMP-427`: the first refusal sends the `WarningTryToResolve` warning, the full check runs, and the delete is sent again. An edit goes into the batch as it stands.

*Observed* (`b12-edit-delete`: List add, View delete and Method edit in one `ApplyAML`, in the order `build.xsl` gave; `b12b-delete-retry-in-fallback`: after the refused batch the delete is refused once more alone, two warnings are sent, and the second attempt is accepted).

[14.0.7] Not present.

## Collected errors

### IMP-540: The manager keeps the collected errors in three fields, for the life of the manager

[14.35] `ImportExportManager` has three fields for the mode: `_collectedPackageExceptions` (a list, replaced by a new empty list at the start of every `ImportProc` and null before the first), `_collectedExceptions` (a list, created with the manager) and `_collectedExceptionsCount` (an int, `0`). Only the first is ever reset. `ImportSolutions` resets none of them. A manager used for a second `ImportSolutions` call, or a host that keeps the manager after a failed run, starts the next run with the previous counts and lists (`IMP-549`). `Cancel()` and the progress state are those of `IMP-409`.

[14.0.7] Not present.

### IMP-541: CollectException counts, reports and logs an error, and trips at the maximum

[14.35] `CollectException(exception, importContext, packageLog)` does, in this order:

1. adds the exception to `_collectedPackageExceptions` and increments `_collectedExceptionsCount`;
2. sends an `error` message with `ErrorMessageMessage` (`IMP-470`) and the exception's `Message`;
3. calls `LogError` (`IMP-407`): the `AutoFlush` of the package log writer is turned on and the log gets the `ErrorMessageMessageEnd` block with the `Message`;
4. throws `AggregateException(_collectedPackageExceptions)` if `_collectedExceptionsCount >= CollectImportErrorsMaxCount`, and returns otherwise.

`IsCollectImportErrorsThresholdExceeded` is that comparison. Because the count is compared with `>=` after the increment, a maximum of `0` or below trips on the first error, and a maximum of `n` lets `n - 1` errors by (*observed*, `c02-collect-max-unset`, `c02b-collect-max-one`, `c03-collect-two-errors-max3`, `c03b-collect-two-errors-max2`). The count covers the whole run, all packages (`IMP-546`), not one package.

The `AggregateException` leaves `ImportProc` (it is thrown from a handler), so the rest of the package is not run: no further item, no `PostWorkItem` of the item being handled, no delayed resolution (`IMP-545`).

[14.0.7] Not present.

### IMP-542: The loop collects the failure of each step and carries on

[14.35] With `CollectImportErrors` on, the `catch` blocks of `ImportProc` that carry the filter `when (CollectImportErrors)` call `CollectException` and let the loop go on. Per item (not skipped):

- **the check**. In the batch mode `IMP-518` runs and only a failure of its recovery (the flush or the second check) is collected. Outside it, the exception of `CheckWorkItem` is rethrown by the `throw;` of the non-batch path and caught by the same filter. In both cases the item is then imported anyway (`IMP-543`);
- **the send**, whichever way (`ImportSingleWorkItem`, the non-forced flush, the forced flush before an item with Relationships). A failure of a flush is the failure of the whole fallback (`IMP-517`);
- **the registration**, outside the batch mode: `PostWorkItem` after each item is guarded separately, and runs also for an item whose check or send failed (`IMP-544`).

After the last item: the forced flush of the batch (collected), and the delayed resolution (`ExecuteDelayedResolution`, collected; its `completed` log line and `completed` status are then skipped, because they follow the call inside the `try`: *observed*, `c08-collect-delayed-fails`).

Failures outside these calls (the package folder, the package definition, `DoesItemAlreadyExist`, the logging step) are not guarded. They leave `ImportProc` and are `IMP-545`'s.

Without `CollectImportErrors`, none of the filters is true: every exception leaves `ImportProc` as in 14.0.7.

[14.0.7] Not present.

### IMP-543: A collected check failure does not stop the item from being imported (bug)

[14.35] After a failed check is collected (`IMP-542`) the loop goes on to the send, so the item is sent although its reference check did not complete. Outside the batch mode the item is sent at once; in the batch mode it is appended to the queue and sent with the next flush. The item may carry references that the check would have rewritten or delayed.

*Observed* (`c06-collect-check-fails`: the type lookup of the Method fails, the error is collected, the Method `add` is sent and the item registered; `c12b-collect-batch-check-always-fails`: the Method whose check failed twice is sent by the final flush). Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-544: A failed add is registered in the package definition (bug)

[14.35] Outside the batch mode `PostWorkItem` is called after every item that is not skipped, in a `try` of its own, whether or not its check or its send was collected (`IMP-542`). For an `add` of an importable type it registers the item with the id read before the send, so an item that does not exist in the database is added to the package definition. The one case where it is not registered is when the error trips the maximum: `CollectException` throws before the registration (`IMP-541`).

*Observed* (`c01-collect-basic`, `c03-collect-two-errors-max3`: the refused Method add is followed by the `PackageGroup` and `PackageElement` requests for it; `c02-collect-max-unset`: with the maximum 0 the same failure is not registered). Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-545: With collection on, ImportPackage fails a package that collected errors

[14.35] `ImportPackage` (`IMP-406`) changes in the following way when `CollectImportErrors` is on. After `ImportProc` returns without an exception, in the guarded steps:

1. if the progress state is *cancelled* (`IMP-409`), an `OperationCanceledException` with the message `Import was canceled by user` is added to `_collectedPackageExceptions` instead of being thrown;
2. if `_collectedPackageExceptions` holds anything, an `AggregateException` of its elements is thrown. The package never reaches the `success` write.

An inner handler catches a `CItemException` of steps 2 to 4 (the audit-row writes, and any `CItemException` that left `ImportProc`), adds it to `_collectedPackageExceptions` and throws the aggregate (`IMP-548`). The outer handlers are then:

- `catch (AggregateException) when (CollectImportErrors)`: writes `Updating '{name}' package to failed release status` and calls `WriteReleaseData(name, 2, …)`; a `CItemException` of that write is added to the list and otherwise ignored (an `AggregateException` built from it is dropped, so it is in no message or log: *observed*, `c10b-collect-failed-row-write-fails`). It then adds an `InvalidOperationException` to `_collectedExceptions`: the message is CRLF, the `ImportPackagePackageNameFailedWithMessageUpdatingPackageNameToFailedReleaseStatus` text (`IMP-407`) with the package name, the aggregate's `Message` and the package name, and CRLF; its inner exception is the aggregate. The aggregate's `Message` is the .NET text, **`One or more errors occurred.`**, without the inner messages (*observed* on .NET Framework 4.8). Then, if the progress state is *cancelled*, or `IsCollectImportErrorsThresholdExceeded` (`IMP-541`), it throws an `AggregateException` of `_collectedExceptions`. Otherwise it returns normally, so **the next package starts** (*observed*, `c04-collect-two-packages`: A fails with one collected error; B and C are imported);
- `catch (Exception)` (any other exception, including a `NullReferenceException`, `IMP-548`): the handler of `IMP-407` as before: failed status, `WriteReleaseData(…, 2, …)`, an `InvalidOperationException` thrown.

The `finally` block (the end-of-execution line, the flush) is as in `IMP-406`. The log of a failed package is therefore: its own block (with each collected error's block inside, from `IMP-541`), then, from `ImportSolutions`, the aggregate's block and a block per collected error (`IMP-546`).

A cancel with collection on takes the aggregate path and ends the run there, whatever the maximum is (`IMP-547`).

[14.0.7] Not present.

### IMP-546: ImportSolutions turns the collected errors into one report and returns their count

[14.35] After the last package, `ImportSolutions` throws `AggregateException(_collectedExceptions)` when `CollectImportErrors` is on and `_collectedExceptions` is not empty (a package failed and the maximum was not reached). An `AggregateException` thrown by `ImportPackage` (the maximum or a cancel) arrives at the same handler, `catch (AggregateException) when (CollectImportErrors)`, which does:

1. `LogError` of the aggregate to the run's log writer: a block with the text `One or more errors occurred.`;
2. a text built from: CRLF; then, for each element `p` of the aggregate (an `InvalidOperationException` of `IMP-545`), the `Message` of `p` and CRLF, and for each element `e` of the aggregate that is `p`'s inner exception: CRLF, CRLF, `LogError(e)` to the log (so the leaf's block follows the aggregate's block), the `Message` of `e` and CRLF;
3. an `error` message with `ErrorMessageMessage` (`IMP-470`) and that text;
4. returns `_collectedExceptionsCount`. The `completed` status of `IMP-408` is **not** sent and the progress state is not reset.

*Observed* (`c01-collect-basic`): the text of step 3 is `\t\t****ErrorMessage****\r\n` + `\r\n` + `\r\nImport package 'LIBSJS-SCRATCH-A' failed with message:\n\nOne or more errors occurred.\nUpdating LIBSJS-SCRATCH-A to failed release status\r\n` + `\r\n` + `\r\n\r\n` + the failed request's `Message` + `\r\n`, that is, four CRLFs between the failure text and the first leaf message.

Step 2 assumes that every element of the aggregate has an `AggregateException` as inner exception. The elements `ImportPackage` puts there all do. An aggregate thrown from elsewhere would raise a `NullReferenceException` inside the handler, which no one catches, so it would reach the host; the engine has no such throw.

Any other exception leaves `ImportSolutions` through its general `catch`: the log block, the `error` message and the return value `1`, as in `IMP-407`.

[14.0.7] Not present.

### IMP-547: The return value counts only what CollectException saw (bug)

[14.35] The count the run returns (`IMP-546`) is increased by `CollectException` only (`IMP-541`). A package that fails through the other routes counts nothing: a cancel (`IMP-545`, step 1), a failure of the audit-row writes (`IMP-548`), a `CItemException` that left `ImportProc`. When one of those is the only failure, the run reports its error and the package row ends at status 2, and the method returns `0`, the code of success (`IMP-408`).

*Observed* (`c09-collect-cancel-no-error`: `Cancel()` during the first item with collection on and the maximum 5: the `error` message holds `Import was canceled by user`, the package row is written with status 2, B is not started, and the result is `0`; `c10d-collect-success-write-fails`: the status-1 write of the row is refused, the package is recorded as failed and the result is `0`). A cancel after an earlier collected error returns the count of those (`c09b-collect-cancel-after-error`: `1`). Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-548: A failed first audit-row write is a NullReferenceException, and later ones reuse the previous package's errors (bug)

[14.35] The inner handler of `IMP-545` adds the `CItemException` to `_collectedPackageExceptions`. That list is created by `ImportProc` (`IMP-540`), which has not run yet when the in-progress write of the first package of the manager's life fails: the list is null, the `Add` throws a `NullReferenceException`, and the failure is handled by the general handler of `IMP-545`: failed status, an `InvalidOperationException` with the message `Object reference not set to an instance of an object.`, return `1`, as in a run without collection (*observed*, `c10-collect-row-write-fails`; the error of the write itself is not in any message or log).

For any later package the list is the one of the previous `ImportProc`, still holding that package's errors. The new `CItemException` joins them and the aggregate thrown has all of them, so the report names the earlier package's errors again (*observed*, `c10e-collect-row-write-fails-second-package`: A has one collected error, B's in-progress write is refused once; the final report holds A's error and B's, the count returned is `1`). Registered in `bugs.md`.

[14.0.7] Not present.

### IMP-549: The state of the mode survives the run

[14.35] After a run with collection on, `_collectedExceptions`, `_collectedExceptionsCount` and the progress state stay as the run left them, and a second `ImportSolutions` on the same manager starts from there: the count adds up and the report of the second run lists the errors of the first (*observed*, `c11-collect-twice`: the same failing package imported twice returns `1` and then `2`). A failed run also leaves the progress state at *in progress* or *cancelled* (`IMP-408`, `IMP-409`); the next call sets it to *in progress* again (`IMP-400`). A port that builds a new manager for each run, as the host of `IMP-480` does, never sees this; one that reuses a manager keeps the three fields on it.

[14.0.7] Not present.

### IMP-550: What the collected errors add to the host's channels

[14.35] With collection on, a run that collects `n` errors sends the following in addition to the messages of `IMP-471`:

- an `error` message per collected error, at the moment it is collected (`IMP-541`), with the `ErrorMessageMessage` text of the exception's `Message`;
- after the run, one `error` message with the report of `IMP-546`;
- no `completed` status from `ImportSolutions` (the packages that reach the end of `ImportProc` still send theirs).

The console: `LogWorkItem` (`IMP-421`) sets the console foreground colour to yellow for the lines of an item when at least one error has been collected so far, and restores it afterwards. Nothing else about the console changes. The colour is the only effect of `_collectedExceptionsCount > 0` there; a port exposes it as a flag of the console output and leaves the colouring to the CLI.

The texts of the report (`IMP-545`, `IMP-546`) use the catalogue of `IMP-470`; the mode adds no key.

[14.0.7] Not present.

### IMP-551: With both modes on, the flush failures are collected too

[14.35] The two modes combine through the `when (CollectImportErrors)` filters (`IMP-542`) around the calls that flush: the non-forced flush after queuing (`IMP-511`), the forced flush before an item with Relationships (`IMP-519`), the one in the recovery of `IMP-518` and the one after the last item. An exception that leaves a flush (the fallback's failure, `IMP-517`, or a failure of the registration inside it, `IMP-523`) is collected there: the count goes up, the `error` message is sent, the loop continues with the next item, and the queue has been emptied. The first failing item of a batch therefore costs the rest of the batch (`IMP-517`) and the run continues.

*Observed* (`c12-collect-fallback-item-fails`, `c12b-collect-batch-check-always-fails`, `c12c-collect-batch-always-refused`: every `ApplyAML`, including the empty one, is refused and the items are imported alone, a success with no error collected, result `0`).

[14.0.7] Not present.
