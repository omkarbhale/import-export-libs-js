# Oracle

The oracle is the real engine: Aras's own `Libs.dll` builds, run on Windows and driven from WSL. Fixtures are recorded from it, and live parity compares the port against it.

Nothing is here yet. The oracle harness ticket adds:

- **`native/<version>/`**: each engine's toolset, vendored with its full dependency set (round 3, Q4):
  - `native/12.0/`: Libs 12.0.0.13341 with its IOM;
  - `native/14.0.7/`: Libs 14.0.7.35492 with IOM 14.0.7 (the same build as aras-harness `native/Libs.dll`);
  - `native/14.35/`: Libs 14.35.0.43890 with IOM 15, Aras.Net 15, Aras.Cryptography 17 and their NuGet dependencies (about 34 DLLs).
- **A hash check** that runs before every use, against recorded sha256 values.
- **A recording wrapper** around IOM's `IServerConnection.CallAction`, which captures every request and response as an AML transcript.
- **WSL staging.** .NET refuses to load assemblies from `\\wsl.localhost` paths, so the harness copies a toolset to a Windows-local folder (under `%LOCALAPPDATA%`) before loading it.

Rules for this folder:

- Only Aras's shipped binaries live under `native/`. **Decompiled C# never does**; it goes to the gitignored `.decomp/` (see `AGENTS.md`).
- The oracle talks to the dev instance only, under the live-Aras rules in `AGENTS.md`.
