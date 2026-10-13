# Hold records

These pieces of `Libs.dll` are deliberately out of scope (round 5, line 7). None of them is user-facing on the import, export, language-pack or DB-patch paths. Each record says what the piece is, why it is held, and what would bring it in.

In `spec/source-map.json`, a held method that the reachability walk still reaches is marked `not-ported`, with a reason that points here.

| Record | Piece |
|---|---|
| [certificate-login.md](certificate-login.md) | Client-certificate login from the Windows certificate store |
| [getdb-list.md](getdb-list.md) | The raw `<GetDB/>` database list |
| [applysql.md](applysql.md) | `applySQL` outside 14.35's lpimport path |
| [testability-wrappers.md](testability-wrappers.md) | The C# testability wrappers and interfaces |
| [generate-hashtable-from-manifest.md](generate-hashtable-from-manifest.md) | `GenerateHashtableFromManifest` |
