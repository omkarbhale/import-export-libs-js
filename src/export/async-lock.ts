/**
 * A lock for the workers of a parallel export: the engine's `lock (...)` blocks around the failed-item handler and the cancel branch
 * (EXP-555, EXP-557). `run` runs `body` at once when nobody holds the lock, and otherwise after the holder has finished; the waiters
 * go in the order they came, and a body that throws gives the lock up like one that returns.
 *
 * @spec EXP-555 EXP-557
 */
export class AsyncLock {
  private held = false;
  private readonly waiters: Array<() => void> = [];

  async run<T>(body: () => Promise<T>): Promise<T> {
    if (this.held) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.held = true;
    try {
      return await body();
    } finally {
      // the lock passes to the next waiter without ever being free in between
      const next = this.waiters.shift();
      if (next) next();
      else this.held = false;
    }
  }
}
