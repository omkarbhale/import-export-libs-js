# Round 3: engine versions, selection, gate and oracle

Answered 2026-10-13.

Three engine builds were found on the captain's machine: 12.0.0.13341 (Aras 12, accepts servers 10–12), 14.0.7.35492 (Release 23, the aras-harness copy, accepts 12–14) and 14.35.0.43890 (Release 35, accepts 12–14).

## Decisions

1. **Which versions are supported is decided by a locked rule.** Supported versions are the distinct XML-output behaviours:
   - if every build writes the same files, port the latest only;
   - if 12.0 differs but the 14.x builds agree, support two;
   - otherwise support every build, by design: 14.0.7 first, then 12.0, then 14.35.

   Static evidence shows the three builds write different files, so all three are supported (round 4, confirmed in round 5).
2. **Engine selection.** `--engine` with a pinned default of 14.0.7, recorded in the log and the JSON summary.
3. **Version gate.** Each engine keeps its own server-version gate exactly. `--skip-version-check` is a recorded addition. A refusal names the engines whose window fits the server.
4. **Oracle DLLs are vendored** in this private repo under `oracle/native/<version>/`. Decompiled C# still stays out.

## Captain's answers (verbatim)

> 1. If all versions produce same XML files and only differ in how they do it, then we pick the latest and version supporting is not needed. New IOM is now here "C:\Users\omkarb\Desktop\Delete me\IOM.dll"
> If this is too much for the grill, wayfinder may pick them as tickets, but the decisions stay locked, whichever is better and more convinient.
> 2. If supported, a.
> 3. a.
> 4. b.

Addition to answer 1:

> Or IF those two are separate (12.0 is different, but 14.* are both same), we can support two versions only (Unless a new Libs.dll comes up)
