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

/** None now: `fs-odd-files`, listed here for 14.0.7 until ticket 36's 8.3 short-name ordering (IMP-003, IMP-004), is equal on 12.0 and 14.0.7 (`roadmap/live-parity-12.0.md`). */
export const KNOWN_DIFFERENCES: Readonly<Record<string, KnownDifference>> = {};
