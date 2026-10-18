# export-write-probe

Probes the 14.0.7 `Libs.dll` for the post-XSL steps, the output layout and the item-file bytes that `spec/export-write.md` (EXP-400 to EXP-499) specifies. It calls the engine's own methods by reflection on offline documents, so it needs no server and no credential. It writes only under its work folder.

- `probe.ps1`: one section per step (`REL`, `RNN`, `CDF`, `RPL`, `RPM`, `AX` for `ApplyXsl`, `STD`, `TW`, `NLP`, `COD`, the file-system rules). Each case prints the input and the exact output, or the exception type and message.
- `upcase.ps1`: creates a file for every BMP code unit that is a legal file name and records which names collide, which is the NTFS upcase table of the volume.
- `run.ps1`: runs `probe.ps1` and replaces the work folder with `<WD>` in its output.

Recorded output: `fixtures/export-write/probe-14.0.7.txt` and `fixtures/export-write/ntfs-upcase-bmp.txt`.

## Re-running

.NET Framework refuses DLLs from `\\wsl.localhost`, so stage first (Windows PowerShell 5.1):

1. Copy `oracle/native/14.0.7/` to `%LOCALAPPDATA%\libsjs-15-probe\bin`, and the scripts of this folder to `%LOCALAPPDATA%\libsjs-15-probe`.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 -P "$env:LOCALAPPDATA\libsjs-15-probe"` (create the `work` folder inside it first).
3. For the table, `upcase.ps1 -Work <that work folder>` on an NTFS volume. It takes about a minute and creates some 62,000 small files, which it deletes.
4. Delete `%LOCALAPPDATA%\libsjs-15-probe` afterwards.

The probes read the engine's `export.xsl` from the vendored DLL. They do not touch the repository.
