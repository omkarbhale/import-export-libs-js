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
