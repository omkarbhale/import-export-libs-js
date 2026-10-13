# Hold: the C# testability wrappers and interfaces

**What it is.** The interfaces and wrappers Aras added so its own unit tests could mock the engine. They include `IIOWrapper`/`IOWrapper` (a file-system facade), `Wrappers.FileInfoWrapper` and `DirectoryInfoWrapper`, `IResourceManager`, and the `I*` interfaces over the context types.

**Why it is held.** They change no observable behaviour. Where a wrapper member does something observable on an in-scope path (for example `XmlDocumentSaveWithSettings`, which fixes the bytes of every exported file), that behaviour is specified as a rule and implemented directly. The wrapper itself is not mirrored. Unused wrapper members are marked `not-ported` in the source map.

**What would bring it in.** Nothing planned. The TypeScript gets its own test seams where it needs them, so it does not mirror these.
