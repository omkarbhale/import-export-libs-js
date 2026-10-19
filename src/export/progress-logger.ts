/** What `ProgressStreamLogger` writes to: the engine's log writer. */
export interface LineWriter {
  writeLine(text: string): void;
}

/**
 * 14.35's `ProgressStreamLogger` (EXP-554), which writes the success line of each item to the log. `ExportProc` creates one per
 * package, after the package header and before the items, and starts it:
 *
 * - `writeLine(text)` puts the text on a queue and returns. It never blocks and never fails;
 * - `start()` does nothing if the task already exists; otherwise the task takes the lines off the queue one at a time and writes
 *   them to the log, until `complete()` cancels it. The engine's task spins on a processor while it waits (EXP-575, a deviation:
 *   the port's task wakes for a line instead);
 * - `complete()` does nothing without a task. Otherwise it cancels the task, forgets it, and then writes every line still queued
 *   on the calling thread. It never starts the task again;
 * - `dispose()` only disposes the cancellation token source. A text queued afterwards is accepted and never written, which loses
 *   the success lines of the items that finish after a failed item or a cancel (EXP-570).
 *
 * @spec EXP-554 EXP-570 EXP-575
 */
export class ProgressStreamLogger {
  private readonly queue: string[] = [];
  private running = false;
  private scheduled = false;

  constructor(private readonly writer: LineWriter) {}

  writeLine(text: string): void {
    this.queue.push(text);
    if (this.running) this.schedule();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.queue.length > 0) this.schedule();
  }

  complete(): void {
    if (!this.running) return;
    this.running = false;
    for (const line of this.queue.splice(0)) this.writer.writeLine(line);
  }

  dispose(): void {
    // the cancellation token source is all the engine disposes: a queued line stays queued
  }

  /** The task's next turn: it writes what is queued, in order, unless it was cancelled meanwhile. */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.running) return;
      for (const line of this.queue.splice(0)) this.writer.writeLine(line);
    });
  }
}
