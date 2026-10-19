/**
 * What the collected-errors mode keeps on the manager (IMP-540): three fields that live as long as the manager does. Only the
 * first is ever reset, by every `ImportProc`; a manager that runs a second `ImportSolutions` starts it with the first run's counts
 * and lists (IMP-549).
 *
 * @spec IMP-540 IMP-549
 */
export class CollectedErrors {
  /** `_collectedPackageExceptions`: the errors of the package being imported; null until the first `ImportProc` (IMP-548). */
  packageExceptions: Error[] | null = null;
  /** `_collectedExceptions`: one `InvalidOperationException` per package that failed, wrapping that package's aggregate (IMP-545). */
  readonly exceptions: Error[] = [];
  /** `_collectedExceptionsCount`: what `CollectException` has counted over the life of the manager, and what a run returns (IMP-546). */
  count = 0;
}
