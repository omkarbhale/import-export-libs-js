# Round 4: the 14.35 additions, parallel export and build order

Answered 2026-10-13.

On stock dev data the three engines write different XML. 12.0 and 14.0.7 differ in User `pwd_is_set_on` and in `implementation_query`/`event_data` written as CDATA or as escaped text. 14.35 drops every `is_null="1"` element. So three versions are supported.

## Decisions

1. **All four 14.35 additions are in:** language-resource export (resources only, or with metadata), AML batch mode, collected-errors mode, and DB patch application (`ApplyDBUpdateManifest`). The map is free to shape and order these.
2. **14.35's export is emulated as shipped, parallelism included.** Items within a package export concurrently, bounded by `--parallelism` (default: the CPU count). Log order is nondeterministic, so fixture tests compare 14.35 log lines as a set. One failed item stops the whole export, as 14.35 does, so `--on-item-error` is rejected with `--engine 14.35`. The start of this answer arrived cut off; it was read as "(c), parallelism included", and round 5 confirmed that reading.
3. **Build order.** 14.0.7 is built complete first. Then 12.0 and 14.35 arrive as variant slices.

## Captain's answers (verbatim)

> 1. b, map can be flexible
> 2. allelism included. If we're matching, why keep parity, I say.
> 3. a.

Before the round was reissued:

> Everything it can need should be under C:\Users\omkarb\Desktop\Delete me\PackageImportExportUtilities35
