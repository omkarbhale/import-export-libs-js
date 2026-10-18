# Reproduced engine bugs

Every engine bug the library reproduces on purpose is registered here. The bug also has its own rule in the area document that defines its behaviour. Nothing is fixed silently.

Each entry follows this shape:

```markdown
## EXP-000: short name

- **Behaviour:** what the engine observably does.
- **Why it is a bug:** what a correct engine would do instead.
- **C# location:** `Namespace.Type::Member` (look it up in `spec/source-map.json` for the lock).
- **Versions:** 12.0, 14.0.7, 14.35 (whichever are affected).
```

The coverage test checks that every heading here names a rule defined in an area document.

## WIRE-024: the version refusal has faultcode 0 and names no versions

- **Behaviour:** when the server's major version is outside the engine's window, `CItemHelper.Login()` throws with faultcode `0`, and its text reads `You are trying to use incompatible utility of version Aras.Tools.SolutionUpgrade.ArasVersion with innovator version Aras.Tools.SolutionUpgrade.ArasVersion.`
- **Why it is a bug:** faultcode `0` means "no items found" everywhere else in the engine, so the refusal can be taken for an empty result. The version type has no text form, so neither version reaches the message.
- **C# location:** `Aras.Tools.SolutionUpgrade.CItemHelper::Login`.
- **Versions:** 14.0.7.

## WIRE-054: the version probe crashes when only one of VersionMajor and VersionMinor exists

- **Behaviour:** when the first probe request returns exactly one Variable, the probe throws `System.IndexOutOfRangeException`, even for the Variable that exists, and the error escapes login.
- **Why it is a bug:** the engine looks the Variables up from the envelope down, but IOM has narrowed a single-item result to that item. A correct engine would read the Variable that exists and report the missing one.
- **C# location:** `Aras.Tools.SolutionUpgrade.CItemHelper::GetInnovatorServerVersion`.
- **Versions:** 14.0.7.

## WIRE-055: non-ASCII password characters hash as `?`

- **Behaviour:** IOM hashes the ASCII bytes of the password, so each non-ASCII character becomes `?` before the MD5 or SHA-256 digest is taken.
- **Why it is a bug:** the server receives the digest of a different password, and passwords that differ only in non-ASCII characters are interchangeable. A correct client would hash the UTF-8 bytes.
- **C# location:** IOM's password hashing, reached from `Aras.Tools.SolutionUpgrade.CItemHelper::Login`.
- **Versions:** 14.0.7.

## EXP-540: packages exported in the referenced pass are missing from the manifest

- **Behaviour:** the referenced-items pass exports each referenced package into its own directory and log section, but `imports.mf` has no `package` entry for it, only the `dependson` entries under the main package.
- **Why it is a bug:** an import from the manifest skips packages the export produced, because the manifest lists a dependency but not the package that holds its items.
- **C# location:** `Aras.Tools.SolutionUpgrade.ImportExportManager::ExportReferencedElements`.
- **Versions:** 14.0.7.

## EXP-541: a package-definition query that fails inside an export crashes on the log file

- **Behaviour:** `GetSolutions2Xml` opens a second writer on the log file to record its error while `ExportSolutions` still holds the file, so the open fails with an `IOException` that escapes `ExportSolutions` before its `try` block. No manifest is saved.
- **Why it is a bug:** the real error (the failed query) is replaced by a file-sharing error, and the run leaves no manifest.
- **C# location:** `Aras.Tools.SolutionUpgrade.ImportExportManager::GetSolutions2Xml`.
- **Versions:** 14.0.7.

## EXP-542: a missing package definition aborts the whole export

- **Behaviour:** a `CItemException` from the package-definition lookup, the dependency query or a referenced element without id or type is not a `SystemException`, so it escapes `ExportSolutions` after the manifest is saved. Later packages and the referenced pass never run, and no warning is sent.
- **Why it is a bug:** the top-level handler reports other failures as a warning and ends cleanly, but these escape it, and one bad package stops every package after it.
- **C# location:** `Aras.Tools.SolutionUpgrade.PackageDefinitionManager::InitSolution`, `Aras.Tools.SolutionUpgrade.PackageDefinitionManager::FindReferencedElements`, `Aras.Tools.SolutionUpgrade.ImportExportManager::ExportSolutions`.
- **Versions:** 14.0.7.

## EXP-543: a cancel during the main loop still runs the referenced pass

- **Behaviour:** after a cancel, the referenced pass still wipes and recreates the first referenced package's directory, sends its `currentPackage` message and writes its log header, and the cancel is noticed only at that package's first item.
- **Why it is a bug:** a cancelled export should stop. The wipe can delete a finished main package's output when the dependency shares its directory.
- **C# location:** `Aras.Tools.SolutionUpgrade.ImportExportManager::ExportSolutions`, `Aras.Tools.SolutionUpgrade.ImportExportManager::ExportReferencedElements`.
- **Versions:** 14.0.7.

## EXP-544: package and dependency names are interpolated unescaped into XPath and AML

- **Behaviour:** a package or dependency name with an apostrophe makes the manifest or dependency XPath malformed, and the run ends with the XPath error as a warning (`'imports/package[@name='X'Y']' has an invalid token.`). A name that closes the literal and adds a predicate selects other nodes.
- **Why it is a bug:** a legal package name cannot be exported, and a crafted one changes which nodes the engine reads.
- **C# location:** `Aras.Tools.SolutionUpgrade.ImportExportManager::ExportSolutions`, `Aras.Tools.SolutionUpgrade.ManifestFile::AddPackage`, `Aras.Tools.SolutionUpgrade.ManifestFile::AddDependsOn`, `Aras.Tools.SolutionUpgrade.ManifestFile::AddReferencedElement`.
- **Versions:** 14.0.7.
