/**
 * Differences between the port and the engine that are known, understood and not this script's to fix. A case listed here that
 * differs is reported as `known`, and does not fail the run; a listed case that turns out equal is reported too, so that the entry
 * is removed when its follow-up lands. A case that differs in a way no entry explains is a new difference.
 */
export interface KnownDifference {
  /** What differs, and why. */
  reason: string;
  /** Where it is recorded and what closes it. */
  followUp: string;
}

export const KNOWN_DIFFERENCES: Readonly<Record<string, KnownDifference>> = {
  "fs-odd-files": {
    reason:
      "The engine lists a package folder with Directory.GetFiles(*.xml), and NTFS also matches a file whose extension only starts with xml (Foo.xmlbak) through its 8.3 short name, at the short name's place in the directory index. The port's loader (IMP-003, IMP-004) orders by long name, so LIBSJS-SCRATCH-Fs_Backup.xmlbak reaches the run in another position and the items are imported in another order.",
    followUp:
      "roadmap/live-parity-14.0.7.md, 'Known difference'; the same gap is skipped in src/import/import-run.replay.test.ts (KNOWN_LOADER_GAPS) and listed in the map's follow-ups (ticket 40, PR #66). Closing it needs 8.3 short-name generation and the NTFS index order.",
  },
};
