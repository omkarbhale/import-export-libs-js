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

## EXP-270: a `]]>` in a FileSelectorTemplate reference fails the whole item

- **Behaviour:** the transform writes a FileSelectorTemplate's `reference` raw between `<![CDATA[` and `]]>`. A value that contains `]]>` ends the CDATA early, the output is malformed, the reload throws `XmlException` (`']]>' is not allowed in character data.`), and the item fails with that message followed by ` Can't export item.`
- **Why it is a bug:** a correct engine would split the section (`]]]]><![CDATA[>`), as it does for the other CDATA elements, so the item exports.
- **C# location:** `Aras.Tools.SolutionUpgrade.CItemHelper::ApplyXsl` (the stylesheet it runs), failing at the reload that follows.
- **Versions:** 14.0.7.

## EXP-271: identity and system-property tests are substring tests

- **Behaviour:** the system Identity test and the system property tests look `|name|` up inside one long `|`-delimited string, so a name that contains `|` can match as a run of entries. A `keyed_name` of `World|Creator` exports as a system Identity `get` named `World|Creator`, and a Field whose property is named `state|itemtype` is treated as a system property.
- **Why it is a bug:** a correct engine would compare against the entries one at a time.
- **C# location:** `Aras.Tools.SolutionUpgrade.CItemHelper::ApplyXsl` (the stylesheet it runs).
- **Versions:** 14.0.7.

## EXP-272: a Method-valued property without a keyed name exports as a Method `get` with an empty name

- **Behaviour:** `method`, `pre_action`, `post_action`, `on_complete` and `content_generator` on their Items are rewritten from the element's `keyed_name` attribute. Without one, including a null element such as `<method is_null="1"/>`, the output is a `get` of a Method with an empty `name`.
- **Why it is a bug:** the reference cannot be resolved on import, and a null property should stay null or be left out.
- **C# location:** `Aras.Tools.SolutionUpgrade.CItemHelper::ApplyXsl` (the stylesheet it runs).
- **Versions:** 14.0.7 (14.35's `is_null` drop template changes this).
