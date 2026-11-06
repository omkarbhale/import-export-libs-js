# The zip, directory-handle and file-input adapters against the real browser APIs

Browser ticket 27. The adapters were specified and tested under Node in tickets 18 to 20 (`HOST-250` to `HOST-255`); this record is what they do in Chromium, Firefox and WebKit, run on 2026-11-05 with Playwright 1.64.1 (Chromium 156, Firefox 157, WebKit 27.2 by its user agent), and what could not be tested and why. The rules, with a paragraph "In the browsers" each, are in `spec/browser-host.md`; the tests are `src/browser/zip-adapter.browser.test.ts`, `opfs-adapter.browser.test.ts`, `file-input-adapter.browser.test.ts` and `file-drop.browser.test.ts`.

## Result

| Adapter | What runs | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| Zip (`HOST-250`, `HOST-251`) | 10 zips made by Info-ZIP, 7-Zip and Python mount to the expected trees; 12 recorded import cases (4 cases × 3 engines) run on a package carried by a zip, and one on a zip with the Finder's junk; the zip of 64 recorded trees is Node's, byte for byte; a 38 MB package (722 files) is written and mounted | 27 pass | 27 pass | 27 pass |
| OPFS (`HOST-252`, `HOST-253`) | recorded import packages written to the origin private file system, mounted from it, run as recorded, the tree committed to a second folder and mounted again; the output of 5 recorded exports through it; stubs, `maxBytes`, `clean`, refused names, 250 files, abort of a mount and of a commit | 29 pass | 29 pass | 29 pass, in the project `browser-webkit-opfs` (see below); the ordinary WebKit instance records that it has no OPFS |
| Folder input (`HOST-254`) | `setInputFiles` of a recorded folder in `<input webkitdirectory>` equals the recorded tree; a folder of 250 files; a multiple-file input; a chosen `.zip`; 12 recorded import cases run on the tree of a chosen folder; the files of a synthesized `DataTransfer`; abort | 30 pass | 30 pass | 30 pass |
| Drop (`HOST-255`) | a real drop of a recorded folder, of a folder of 250 files with an empty one (a reader lists 100 at a time), of a zip, and an abort in the middle | 4 pass | not automatable | not automatable |
| `showDirectoryPicker` (`HOST-253`) | needs a user gesture and a native dialog | not automated | has no picker | has no picker |

`npm run test:browser` runs all of them; the times of the 38 MB zip are in the console of each run (`ZIP-LARGE`, about 0.3 to 1 s to mount and 1 to 2 s to write on an idle machine, several times that on a busy one; the alarm is 60 s and is not the budget, which ticket 31 measures at the Q5 size).

## What was found

- **WebKit has no origin private file system in an ordinary Playwright context.** `navigator.storage.getDirectory()` rejects with `UnknownError: The operation failed for an unknown transient reason`, as in a private window of Safari. In a persistent context the same call works and the file handle has `createWritable`, so the adapter needs no `createSyncAccessHandle` fallback in a Worker, and none was written. The OPFS test therefore runs in a second project of one WebKit instance with a persistent profile (`browser-webkit-opfs`, `HOST-268`); in the ordinary WebKit instance the same file records the rejection (`OPFS-UNAVAILABLE`). A caller whose page runs in a private window has no origin private file system to hand the adapter, and picks a zip or a folder input instead. Every browser tested has `createWritable` on the handle; the test fails if one does not.
- **A page cannot make a `DataTransfer` that holds a folder, and the entries of one it makes are not those of a drop**: in Chromium `webkitGetAsEntry()` of an item made from a `File` is null (so `mountDataTransfer` mounts nothing), in WebKit it throws `Path does not exist`, in Firefox it gives an entry. So `mountDataTransfer` is tested with a real drop where one can be made, Chromium's `Input.dispatchDragEvent` with paths of the disk, which gives real entries with a real directory reader: a folder of 250 entries is listed whole, empty folder included. Firefox and WebKit have no protocol for it; there the walk is covered by the Node tests with entries written by hand, and the folder is covered through the input. A caller's drop handler must call `mountDataTransfer` before any `await`, as its documentation says.
- **`webkitEntries` of a folder input is empty in all three browsers**, so the entries of a chosen folder cannot stand in for those of a drop.
- **The order of a folder input's files differs between the browsers** (Chromium lists `imports.mf` first, Firefox and WebKit last), and the tree is the same whatever the order; the test mounts the list in both directions.
- **WebKit's `setInputFiles` of a folder now and then does not return** (once or twice in 30 files of a busy machine). The test makes another attempt on a new input, three at most.
- **The zip is the same in the three browsers and under Node**: the deflate of `fflate` writes the same bytes for 64 recorded trees and for the 38 MB folder, which is the proof that a zip made in a browser is the zip of Node.
- **OPFS refusals differ by browser**: a name with a backslash is refused by Chromium and written by Firefox and WebKit. A name with a NUL, or of 300 characters, is refused by WebKit alone. The commit reports exactly the refused names in a `CommitError` and writes the rest, as `HOST-253` says; the test holds either outcome to that.

## Not done here

The `showDirectoryPicker` path, which the ticket names for a manual test on Chromium with `chrome-devtools-axi` on the reference page of ticket 30. The picker needs a native dialog that a headless session cannot answer, so the manual check belongs to that page (`examples/browser/README.md`).

## How to run

`npm run test:browser` (the projects `browser*`). WebKit needs Playwright's system libraries (`npx playwright install --with-deps webkit` on a fresh Linux machine). The persistent profile of the OPFS test is `node_modules/.cache/vitest-playwright-webkit-profile`.
