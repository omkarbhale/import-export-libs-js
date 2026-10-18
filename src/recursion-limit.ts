/**
 * The one bound the port puts on the engine's unbounded recursion. Where the engine recurses until .NET overflows its stack and
 * the process dies, the port stops at this depth with a catchable error that has the engine's own text. It is the one deviation
 * that cannot be avoided (roadmap/round-5.md); a chain deeper than this but within what a stack can take would fail in the port
 * and succeed in the engine, and no real data is that deep.
 *
 * @spec MAN-025 EXP-109
 */
export const RECURSION_LIMIT = 100_000;

/**
 * The engine dies of a stack overflow where a recursion never ends. The port raises this instead, with the engine's own text.
 *
 * @spec MAN-025 EXP-109
 */
export class StackOverflowException extends Error {
  override name = "StackOverflowException";

  constructor() {
    super("Process is terminated due to StackOverflowException.");
  }
}
