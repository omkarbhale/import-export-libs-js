# Browser limits: size, memory and time of the engine in a page

Browser wayfinder ticket 31 (HOST-277, HOST-278). What the engine costs when it runs in a Web Worker of Chromium, Firefox and WebKit on a synthetic package of a stated size, against the budget of Q5 of the map (500 MB of package data; peak memory at most 3 times the package; the page's thread held for at most 100 ms; time per MB recorded).

## Result in one paragraph

**The memory budget is not met, and the ticket's remedies cannot meet it.** An import costs about **40 to 70 times** the package's bytes in browser memory (Chromium: 41 times at 25 MB, 57 times at 50 MB; Firefox: 63 times at 10 MB), against a budget of 3 times. An export costs about 6 times the package plus roughly 370 MB that does not grow (Chromium: 21 times at 25 MB, 13 times at 50 MB). The cost is the engine's parsed documents, not the file bytes, so a package of 500 MB cannot be imported in a tab: the run would need about 20 GB. The practical size of an import in Chromium is **tens of MB (50 MB completed, at 2.9 GB of memory)**; of an export, a few hundred MB at best, extrapolated and not run. The page's thread is not held (longest timer gap 31 to 90 ms, one 121 ms reading on a loaded machine; the assertion was not weakened). The 500 MB run of the budget test has **not** been made and is not claimed to pass: it is a captain decision (section 6).

## 1. What was run, and what was not

`npm run test:browser:size` (`src/browser/size.browser.test.ts`, HOST-278) with `LIBSJS_SIZE_MB` and `LIBSJS_SIZE_OPS`; the packages are made by `npm run synth-package` (HOST-277: real item files of the fixtures, repeated and renamed, from a seed). One size and one operation to an invocation (a second run in the same page starts from the memory the first one left).

| Run | Done |
|---|---|
| Chromium, import and export, 10, 25 and 50 MB | yes (the 50 MB rows are from the first run, before the test was refined; see the notes) |
| Firefox, import and export, 10 MB | yes |
| Firefox 25 and 50 MB | no: the host ran out of memory (below) |
| WebKit | **no**: the Playwright WebKit build failed to launch on this machine (`browserType.launch`, empty log), so no WebKit number exists |
| Chromium 100, 200, 500 MB | no (below) |

The machine is shared with other workers and was at a load average of about 26 on 14 cores, with 1 to 8 GB of memory free and the swap full. Two later runs were stopped by a guard that kills the run when less than 1 GB is free (Chromium 50 MB again, Chromium 10 MB export), and the larger runs were not started, on the instruction not to risk the host's memory. So **times are indicative** and the table is short of what the ticket asked for.

## 2. Measurements

Memory is the browser's own processes summed from `/proc` (`VmRSS` and `VmHWM`, the high-water mark reset before the run), less what the browser held before the page fetched the zip ("peak above idle"). `performance.measureUserAgentSpecificMemory()` was tried in the cross-origin isolated page and Chromium's headless shell refused it with a `SecurityError`, so it gave no number.

| Size (MB) | Browser | Operation | Items | Time | ms per MB | Peak above idle | × package | Longest gap of the page's timer |
|---|---|---|---|---|---|---|---|---|
| 10 | Chromium | import | 630 | 18 s | 1833 | 730 MB | 73 | 36 ms |
| 10 | Chromium | export | 630 | 49 s | 4912 | 379 MB | 38 | 90 ms |
| 25 | Chromium | import | 1456 | 82 s | 3284 | 1030 MB | 41 | 121 ms |
| 25 | Chromium | export | 1456 | 90 s | 3590 | 518 MB | 21 | 50 ms |
| 50 | Chromium | import | 3025 | 87 s | 1739 | 2874 MB | 57 | 36 ms |
| 50 | Chromium | export | 3025 | 230 s | 4591 | 668 MB | 13 | 247 ms |
| 10 | Firefox | import | 630 | 35 s | 3477 | 634 MB | 63 | 32 ms |
| 10 | Firefox | export | 630 | 45 s | 4472 | 385 MB | 38 | 31 ms |

Notes on the table.

- The 50 MB rows were read from the run's output; the results file that held them was cleared before the later runs, and the gap of the 50 MB export (247 ms) was taken before the server's one large answer was made outside the timed window (the later 25 MB export, 50 ms, has that change). The 1.7 to 4.9 s per MB is a trend: the load of the machine moves it by a factor of two (10 MB and 25 MB imports differ by 1.8 times per MB).
- Time per MB is about 2 to 3 s for an import and about 4 to 5 s for an export. An export asks the server about 33 times per item (100 497 requests for 3025 items), and each request crosses between the page and the Worker; an import asks about 4 times per item. On the profile of an import under Node, the time is the engine's XPath and XML work (`xpath` compiles each expression anew; the Worker is not the cost).
- The 6-connection slowdown of a 14.35 export (map risk, ticket 26) is not measured here: the server of these runs is the page's own and answers at once, so there is no connection to cap. Ticket 26 has not landed.
- The page's thread: the timer gap is the thread's lateness and on a loaded machine includes the scheduler's. The test asserts, in Chromium, the longest long task that the browser reports (the thread's own busy time) and the timer gap elsewhere; the Chromium rows above were taken before that reading was added, so only the timer gap exists for them.
- The Worker's heap limit (`performance.memory.jsHeapSizeLimit` in a Worker) was not recorded: Firefox has no such value, and the Chromium run that would have printed it was one of those stopped.

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

## 4. The budget against the numbers

| Budget | Result |
|---|---|
| Completes at 500 MB | **Import: no, not attempted** (about 40 to 57 times the package is 20 to 28 GB, and a tab's Worker is capped near 4 GB). Export: not run; extrapolated about 3.4 GB above idle, which would fit a machine that has it, and **fails the 3 times** (6.8 times). |
| Peak memory at most 3 times the package | **Fails at every size measured**: import 41 to 73 times, export 13 to 38 times. The test asserts it from 50 MB in Chromium and fails there; it was not weakened. |
| Page's thread held at most 100 ms | **Holds** where measured except one 121 ms timer reading on a heavily loaded machine (25 MB import) and the 247 ms of the first 50 MB export (since changed, above). The assertion is on the thread's own long tasks in Chromium. |
| Time per MB | Recorded, not asserted: 2 to 3 s (import), 4 to 5 s (export). A 500 MB package would take the engine, at that rate, from 17 minutes (import, if it fitted) to 40 minutes (export). |

## 5. The ticket's remedies, in its order

1. **Parse-and-drop** (release each file's bytes after the load). The bytes are in the tree the caller owns, 10 MB of the 430 MB; the documents are not released after the load. It saves about 2 % and cannot reach 3 times.
2. **A zip mounted a folder at a time.** The same bytes (the zip is 7 MB of 50), the same documents. No.
3. **`include: "stub"` for files that are not XML.** The synthetic package has none, and a real package's non-XML files are not what the engine parses. It helps a package that has many, and does nothing for this budget.
4. **An OPFS-backed mount.** It moves the file bytes out of memory, which are 1/40 of the cost. It does not help either, and is not raised.

What would help is to hold the items as text and parse each one when the run reaches it (import), and to hand back one copy of the output (export). Both are follow-ups, written up in the report of this ticket: they change the engine's structure (and so need the parity fixtures to hold) or the API's result, and neither was in the scope of a measuring ticket.

## 6. Decision for the captain

Q5 asked for 500 MB. As built, a browser tab imports tens of MB. Either (a) the budget stays at 500 MB and the lazy-parse follow-up is built (a target of about 3 to 5 times for an import is plausible and not yet measured), or (b) the budget is restated as the size the engine fits today (about 50 MB import, a few hundred MB export), or (c) large packages are imported by the Node CLI and the browser is for packages up to the limit. The assertions of `size.browser.test.ts` stay as the ticket wrote them until the captain decides.
