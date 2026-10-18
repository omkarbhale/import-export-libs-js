# Enumeration while removing (EXP-615)

`CItemHelper.RemoveReferencesToAnotherPackages` walks `SelectNodes(...)` results with `foreach` while it removes nodes from the document being walked. .NET Framework builds that node list lazily, one element ahead of the loop, and the lookups follow live tree links, so what the loop sees after a removal is not what a snapshot would give (spec/export-unknown-refs.md, EXP-615).

Each line of a `*-cases.tsv` file is `<xml>` TAB `<comma-separated k values to remove>`. The matching line of `*-dotnet.tsv` is what the real `System.Xml` of .NET Framework 4.8 (Windows PowerShell 5.1) produced: `<k values seen, in loop order>` TAB `<document OuterXml after the removals>`.

| File | Loop | Removal rule |
|---|---|---|
| `relationships-*` | `SelectNodes('.//Relationships/Item')` | remove the visited item, and its parent `Relationships` element too when that is left without children (RemoveRelationshipItem, EXP-610) |
| `methods-*` | `SelectNodes(".//Item[@type='Method' and @action='get']")` | remove the visited item's parent element from its own parent, when it has one (EXP-606) |

An item is removed when its `k` is in the line's removal list, at the moment the loop visits it.

The cases are random trees (seeded generator, not committed), 80 per file, picked to include removals of items that have nested `Relationships`, of the last child of a `Relationships` element, and of elements that contain later matches. Several show the skipped and the still-visited-after-removal items EXP-615 describes.

## Re-recording

On Windows, with PowerShell 5.1:

```powershell
.\record.ps1 -Mode relationships -In relationships-cases.tsv -Out relationships-dotnet.tsv
.\record.ps1 -Mode methods -In methods-cases.tsv -Out methods-dotnet.tsv
```

From WSL, copy the folder to a Windows path first (`%LOCALAPPDATA%`), then run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <path>\record.ps1 …`. The output must be byte-identical (LF line endings). No Aras server and no credential is involved.
