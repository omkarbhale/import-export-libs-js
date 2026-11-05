# Zips made by other tools (browser ticket 18, HOST-250)

Small zips that `src/browser/zip.test.ts` mounts with `vfsFromZip` and compares with the tree each should give. They are not engine runs. Each holds a package folder `Pkg/` of five files (`imports.mf`, `ItemType/a.xml`, `sub/dir/b.xml` of 3 kB, `readme.txt`, an empty `sub/zero.bin`) and an `empty/` folder, except where the table says otherwise. `make-fixtures.sh` makes them (it needs Info-ZIP `zip` 3.0, 7-Zip and Python 3); the committed bytes are the fixtures, and a rebuild may differ in the stamps the tools write.

| File | Made by | What it exercises |
|---|---|---|
| `info-zip.zip` | Info-ZIP `zip` 3.0 (`-r -X`) | deflate and store, folder entries |
| `info-zip-zip64.zip` | Info-ZIP `zip` 3.0 (`-fz`) | ZIP64 field in every entry |
| `info-zip-streamed.zip` | Info-ZIP `zip` 3.0 writing to a pipe | data descriptors (flag bit 3) |
| `7zip-deflate.zip`, `7zip-store.zip` | 7-Zip 26 (`-tzip -mm=Deflate`, `-mm=Copy`) | the other tool's headers and extra fields |
| `macos-style.zip` | Info-ZIP `zip` 3.0 over a tree laid out as Finder's "Compress" leaves it | `__MACOSX/` with AppleDouble `._*` files, `.DS_Store`, `Thumbs.db`, one `._b.xml` inside the package |
| `windows-backslash.zip` | Python 3 `zipfile`, names written with `\` | backslash separators, folder entries ending with `\` (no `readme.txt`, no `sub/zero.bin`) |
| `names-7zip-utf8.zip` | 7-Zip 26 (`-mcu=on`) | `Pkg/café.xml`, `Pkg/日本語/名前.xml` with the UTF-8 flag |
| `names-python-utf8.zip` | Python 3 `zipfile` | the same two names with the UTF-8 flag |
| `names-info-zip.zip` | Info-ZIP `zip` 3.0 | the same two names as UTF-8 bytes **without** the flag |
| `names-cp437.zip` | Python 3 `zipfile`, name bytes patched in | `Pkg/café.xml`, `Pkg/über.xml`, `Pkg/straß.xml` in code page 437 with no flag, as Windows Explorer writes them |

The test also builds zips byte by byte in the test file for what no tool writes (zip-slip names, damaged entries, lying sizes, the Unicode Path field, several disks).
