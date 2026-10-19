/** An exception that left a worker of the loop, as `Parallel.ForEach` reports it: one `AggregateException` holding them all (EXP-556). */
export class AggregateException extends Error {
  override name = "AggregateException";

  constructor(readonly innerExceptions: readonly unknown[]) {
    super("One or more errors occurred.");
  }
}

/** `ParallelLoopState`: `Stop()` keeps the loop from starting any item it has not started yet. */
export interface ParallelLoopState {
  stop(): void;
}

/**
 * `Parallel.ForEach(source, body)` of 14.35's `ExportProc` (EXP-551): `maxParallelism` workers take the items in order, each the next
 * one when its item has ended, so the first `maxParallelism` items start together and no more than that many run at any time. After
 * `loop.stop()` or an exception no item is started, and the items that run are waited for. Exceptions that escaped are collected in
 * the order they were recorded and thrown as one {@link AggregateException} when every running item has ended.
 *
 * @spec EXP-551 EXP-556
 */
export async function parallelForEach<T>(
  source: Iterable<T>,
  maxParallelism: number,
  body: (item: T, loop: ParallelLoopState) => Promise<void>,
): Promise<void> {
  const iterator = source[Symbol.iterator]();
  const errors: unknown[] = [];
  let stopped = false;
  const loop: ParallelLoopState = {
    stop: () => {
      stopped = true;
    },
  };
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped || errors.length > 0) return;
      const next = iterator.next();
      if (next.done) return;
      try {
        await body(next.value, loop);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, maxParallelism) }, worker));
  if (errors.length > 0) throw new AggregateException(errors);
}
