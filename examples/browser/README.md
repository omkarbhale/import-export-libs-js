# Reference page

A standalone static page that runs the browser build of `import-export-libs-js`: export, import, language-pack import and DB patches, in a tab, with no framework (rules HOST-280 and HOST-281 in `spec/browser-host.md`). The library draws no controls; this page is one caller of it, and shows how the adapters and the API fit together:

- **In:** a zip (file input), a folder (`webkitdirectory` input), a drop of either, and, where the browser has `showDirectoryPicker` (Chromium), a picked folder.
- **Out:** an export as a zip download, or written into a picked folder (Chromium).
- **Options:** the CLI's flags (`src/cli/usage.ts`); every control shows the flag it stands for, and `options.test.ts` fails when the two drift.
- **Run:** progress list, message pane, abort button, the run log for download.
- The engine runs on the page's thread (`engine-client.ts` is the one module the page reaches it through; the Worker replaces that module).

```sh
npm run example:browser:build   # builds examples/browser/dist/ (esbuild, no other dependency)
npm run example:browser         # builds it and serves it on http://127.0.0.1:8080/
npm run example:browser -- --port 8080 --host 127.0.0.1 --no-build
```

`dist/` is plain files: serve it from any static server. Over `http:` the page shows a banner (HOST-281). Against a server that is not on the page's origin the Aras administrator must list the page's origin; see `roadmap/browser-cors-poc.md`, section 3.

## Password and storage

The password is read from its field when a run starts, handed to `connect`, and the field is emptied at once. Nothing is written to `localStorage`, `sessionStorage`, IndexedDB or cookies, nothing is read from or put in the URL, and the page is served with a Content-Security-Policy that allows no script but its own. Taking the session from a signed-in Aras client is for the embedding page to decide (`tokenProvider`, HOST-271); this page has no token field.

## Manual test against a recorded server

`--replay <case>` also starts `tools/browser-example/replay-server.ts`, which serves a recorded run over HTTP with CORS (the same fakes the CLI tests use) and prints what to type:

```sh
npm run example:browser -- --replay 14.0.7/export/e27-permission
npm run example:browser -- --replay 14.0.7/import/s0-mini-defaults
```

Open the page, enter the printed URL, any database and password, the user, **and choose the printed engine** (the recorded server answers the login as a 12 SP9 server, so `auto` would pick 12.0). Export: type the package and the level. Import: choose the printed zip (also served at `/__replay/package.zip`) or its folder, and give the printed OS user. When the run ends, `Ctrl+C` prints how much of the recording was used and how many requests did not match. The server starts the recording again after each logoff, so a case can be run twice.

To drive it with `chrome-devtools-axi` (no system Chrome? start Playwright's Chromium with `--remote-debugging-port=9340` and set `CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:9340`): `open http://127.0.0.1:8080/`, `snapshot`, `fillform @uid=value …`, `click` the Run button, `screenshot`. `upload` needs a file dialog; the zip at `/__replay/package.zip` can be put into the zip input from `eval` with `fetch` and a `DataTransfer`. A native folder-picker dialog cannot be driven headless: stub `window.showDirectoryPicker` with a handle of `navigator.storage.getDirectory()` to exercise the folder path, and use a headed Chromium for the dialog itself.

## Tests

`npm test` runs `model.test.ts`, `options.test.ts` and the tests of the servers (`tools/browser-example/`). `npm run test:browser` runs `ui.browser.test.ts` in Chromium, Firefox and WebKit: the page is mounted as `main.ts` mounts it and talks, across origins, to a recorded run served by the replay server. An export downloads a zip equal to the recorded output byte for byte; an import runs from a zip, a folder input, a drop and a directory handle, and the server must have seen every recorded request as recorded.
