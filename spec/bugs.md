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

<!-- No bugs registered yet. -->
