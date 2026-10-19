# Engine diffs

The pinned comparison of the three engines on the same dev items (wayfinder ticket 64). The reading of the result is in [`roadmap/engine-diffs.md`](../../roadmap/engine-diffs.md); these two files are the machine-readable part that `oracle/src/engine-diff.test.ts` replays.

| File | What |
|---|---|
| `export.json` | the committed export cases that all three engines recorded (`fixtures/<engine>/export/`, 89 cases), compared for 12.0 against 14.0.7 and 14.0.7 against 14.35: which output folders are byte-identical and, for the others, which files differ and by how many lines; then the host exit codes, the number of calls, and the requests (by shape, with ids and text values left out), messages and log lines (with the times and paths left out) whose number differs between the two engines, summed over the cases |
| `xsl.json` | `export.xsl` run on the same documents by the three engines (`fixtures/<engine>/xsl/{export,export-items,export-fix}/`): per pair and set, the inputs on which the transform or the reloaded document (or the exception) differs |

Neither file says that two engines agree where they are not listed: a case that comes out equal shows only that these items do not reach a difference (round 5 correction).

Regenerate after a re-record with `npm run oracle:engine-diff -- --write`, which reads the committed fixtures and needs no server. `npm run oracle:engine-diff -- --live <folder>` records the catalogue again with all three engines on dev (read-only), one case after the other, and compares those recordings with each other and with the committed fixtures. `--help` lists the options.
