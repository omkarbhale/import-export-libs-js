# Browser limits: size, memory and time of the engine in a page

Browser wayfinder ticket 31 (HOST-277, HOST-278). What the engine costs when it runs in a Web Worker on a synthetic package of a stated size. The ticket's targets were Q5 of the map (500 MB of package data, peak memory at most 3 times the package, the page's thread held for at most 100 ms, time per MB recorded); the first two were measured unreachable and retired (section 6).

## Result in one paragraph

**The limit is an import of about 50 MB in Chromium; larger packages go through the Node CLI.** The captain decided this on 2026-11-06 after the measurements below showed the memory target unreachable: an import costs about **40 to 70 times** the package's bytes in browser memory (Chromium: 41 times at 25 MB, 58 times at 50 MB; Firefox: 63 times at 10 MB, 54 times at 50 MB), and an export about 6 times the package plus roughly 370 MB that does not grow (Chromium: 21 times at 25 MB, 14 times at 50 MB; Firefox: 18 times at 50 MB). The cost is the engine's parsed documents, not the file bytes. The targets of the map's Q5, 500 MB and at most 3 times the package, are **retired**; the numbers stay here as recorded fact. A 50 MB import completed at 2.9 GB in Chromium and 2.7 GB in Firefox. The page's thread is not held (longest timer gap 31 to 90 ms, one 121 ms reading on a loaded machine). **Not measured:** WebKit (its system libraries are missing on the measuring machine), Firefox between 10 and 50 MB and above 50 MB, Chromium above 50 MB, and any export above 50 MB. Holding the items as text and parsing them one at a time is possible later (section 6) and would raise the limit.

## 1. What was run, and what was not

`npm run test:browser:size` (`src/browser/size.browser.test.ts`, HOST-278) with `LIBSJS_SIZE_MB` and `LIBSJS_SIZE_OPS`; the packages are made by `npm run synth-package` (HOST-277: real item files of the fixtures, repeated and renamed, from a seed). One size and one operation to an invocation (a second run in the same page starts from the memory the first one left).

| Run | Done |
|---|---|
| Chromium, import and export, 10, 25 and 50 MB | yes |
| Firefox, import and export, 10 and 50 MB | yes (25 MB not run) |
| WebKit | **no**: the measuring machine lacks the system libraries WebKit needs (`libgtk-4`, `libgraphene`, `libevent`, `libopus`, GStreamer; `npx playwright install-deps webkit` would add them), so `browserType.launch` fails and no WebKit number exists |
| Chromium 100, 200, 500 MB | no (below) |

The machine is shared with other workers and was at a load average of about 26 on 14 cores, with 1 to 8 GB of memory free and the swap full. Some runs were stopped by a guard that kills the run when less than 1 GB is free, and were repeated when memory came back; the larger runs were not started, on the instruction not to risk the host's memory. So **times are indicative** and the table is short of what the ticket asked for.

## 2. Measurements

Memory is the browser's own processes summed from `/proc` (`VmRSS` and `VmHWM`, the high-water mark reset before the run), less what the browser held before the page fetched the zip ("peak above idle"). `performance.measureUserAgentSpecificMemory()` was tried in the cross-origin isolated page and Chromium's headless shell refused it with a `SecurityError`, so it gave no number.

| Size (MB) | Browser | Operation | Items | Time | ms per MB | Peak above idle | × package | Longest gap of the page's timer |
|---|---|---|---|---|---|---|---|---|
| 10 | Chromium | import | 630 | 18 s | 1833 | 730 MB | 73 | 36 ms |
| 10 | Chromium | export | 630 | 49 s | 4912 | 379 MB | 38 | 90 ms |
| 25 | Chromium | import | 1456 | 82 s | 3284 | 1030 MB | 41 | 121 ms |
| 25 | Chromium | export | 1456 | 90 s | 3590 | 518 MB | 21 | 50 ms |
| 50 | Chromium | import | 3025 | 67 s | 1339 | 2881 MB | 58 | 28 ms |
| 50 | Chromium | export | 3025 | 90 s | 1788 | 698 MB | 14 | 37 ms |
| 10 | Firefox | import | 630 | 35 s | 3477 | 634 MB | 63 | 32 ms |
| 10 | Firefox | export | 630 | 45 s | 4472 | 385 MB | 38 | 31 ms |
| 50 | Firefox | import | 3025 | 87 s | 1738 | 2696 MB | 54 | 40 ms |
| 50 | Firefox | export | 3025 | 102 s | 2040 | 877 MB | 18 | 26 ms |

Notes on the table.

- The 10 and 25 MB Chromium rows and the 10 MB Firefox rows are from earlier runs of the same test, taken with the machine at a load average of about 26 (the 25 MB import's 121 ms gap is from then); the 50 MB rows, and the Chromium 10 MB rows that were repeated for the last version of the test, were taken on a quiet machine. The times move by a factor of two with the load (the 50 MB import took 87 s under load and 67 s without), so the ms per MB column is a trend.
- Time per MB is about 1.3 to 3.5 s for an import and 1.8 to 5 s for an export. An export asks the server about 33 times per item (100 497 requests for 3025 items), and each request crosses between the page and the Worker; an import asks about 4 times per item. On the profile of an import under Node, the time is the engine's XPath and XML work (`xpath` compiles each expression anew; the Worker is not the cost).
- The 6-connection slowdown of a 14.35 export (map risk, ticket 26) is not measured here: the server of these runs is the page's own and answers at once, so there is no connection to cap. Ticket 26 has not landed.
- The page's thread: the timer gap is the thread's lateness and on a loaded machine includes the scheduler's. The test asserts, in Chromium, the longest long task that the browser reports (the thread's own busy time, 0 ms in the 10 and 50 MB runs repeated for it) and the timer gap elsewhere, and does not count the first second of a run, in which a task of 242 ms was seen once at the start of a 10 MB export (the Worker's first messages and Vitest's reporting share the thread).
- The Worker's heap limit (`performance.memory.jsHeapSizeLimit` in a Worker) is not available: neither Chromium's headless shell nor Firefox gives it to a Worker (the test records null).

## 3. Where the memory goes

A Node run of the import over the 10 MB package, with the heap counted after a full collection at each step (the live heap of the engine, which the browser's numbers contain with the garbage of the collector on top):

| Step | Live memory |
|---|---|
| Package mounted in the tree (10 MB of files) | 32 MB |
| After each file is read, parsed and serialised (`loadPackage`) | +91 MB |
| After the joined string is parsed as one document | +100 MB |
| After `build.xsl` is rendered and parsed again (the document the run uses) | +200 MB |
| Total at the end of the load | about 430 MB (43 times) |

`getItemsFromPackageDom` (`src/import/items.ts`) then parses a document for every item at once, and the run keeps that list and the package document for the whole package, so the import's live set is the file bytes, two whole-package documents and a document per item. A heap of 400 MB is too small for the 10 MB package and 600 MB is enough, which agrees. The `xmldom` tree costs 10 to 20 times the XML text it holds.

An export's cost is the output tree, the copies the result hands back (`files`, and `zip` with `zip: true`) and the browser's own fixed cost of a Worker with the engine in it (about 370 MB, which is why 10 MB shows 38 times). Its slope, about 6 times, was measured between 25 and 50 MB and its cause was not profiled.

## 4. The retired targets against the numbers

| Target (retired) | Result |
|---|---|
| Completes at 500 MB | **Import: no, not attempted** (about 40 to 57 times the package is 20 to 28 GB, and a tab's Worker is capped near 4 GB). Export: not run; extrapolated about 3.4 GB above idle, which would fit a machine that has it, and **fails the 3 times** (6.8 times). |
| Peak memory at most 3 times the package | **Fails at every size measured**: import 41 to 73 times, export 14 to 38 times.  |
| Page's thread held at most 100 ms | **Holds** wherever measured on a quiet machine (timer gap 25 to 50 ms, no long task); the exception is one 121 ms timer reading under a load average of 26 (25 MB import). The test asserts the thread's own long tasks in Chromium. |
| Time per MB | Recorded, not asserted: 2 to 3 s (import), 4 to 5 s (export). A 500 MB package would take the engine, at that rate, from 17 minutes (import, if it fitted) to 40 minutes (export). |

## 5. The ticket's remedies, in its order

1. **Parse-and-drop** (release each file's bytes after the load). The bytes are in the tree the caller owns, 10 MB of the 430 MB; the documents are not released after the load. It saves about 2 % and cannot reach 3 times.
2. **A zip mounted a folder at a time.** The same bytes (the zip is 7 MB of 50), the same documents. No.
3. **`include: "stub"` for files that are not XML.** The synthetic package has none, and a real package's non-XML files are not what the engine parses. It helps a package that has many, and does nothing for this budget.
4. **An OPFS-backed mount.** It moves the file bytes out of memory, which are 1/40 of the cost. It does not help either, and is not raised.

What would help is to hold the items as text and parse each one when the run reaches it (import), and to hand back one copy of the output (export). Both are possible later (section 6); neither was in the scope of a measuring ticket.

## 6. The limit, as decided (2026-11-06)

The captain lowered the limit instead of building the lazy parsing now:

- An import of about **50 MB** completes in Chromium. A larger package goes through the Node CLI (`aras-pkg import`), which has no such cost.
- The 500 MB and 3 times targets are retired. Their numbers (sections 2 to 4) are kept as measured fact, not as a goal.
- `size.browser.test.ts` asserts that a run completes, a regression ceiling on peak memory in Chromium that follows the measured peak (import: 400 MB plus 60 times the package; export: 700 MB plus 10 times; about 20 to 30 % above what was measured, 2.88 GB against 3.4 GB at 50 MB for an import), and the 100 ms bound on the page's thread. A change that makes the engine hold more fails the ceiling.
- A caller is told: the README says it, and `importPackages` sends a warning of the host (`source: "host"`, level `warning`) when the tree it imports is above 50 MB, naming the size, the 40 to 70 times and the CLI. It does not refuse. The reference page (ticket 30) should show that message.
- **Later, if the limit must rise:** hold the items as text and parse each one when the run reaches it, instead of two whole-package documents and a document per item (section 3). That changes the engine's structure and needs the parity fixtures to hold, so it is a ticket of its own, with a target of about 3 to 5 times that is plausible and unmeasured; an export that hands back one copy of its output is the smaller follow-up.
