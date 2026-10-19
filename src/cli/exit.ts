/** Exit codes shared by every command: 0 ok, 1 failed, 2 completed with engine errors, 64 usage. */
export const EXIT = { ok: 0, failed: 1, engineErrors: 2, usage: 64 } as const;

/**
 * The exit code of a run whose engine returned `returnCode`. A nonzero return is a failure. A zero return is a success, unless
 * the engine sent an `error` message on the way (the run completed with engine errors).
 */
export function exitCodeOf(returnCode: number, errorMessages: number): number {
  if (returnCode !== 0) return EXIT.failed;
  return errorMessages > 0 ? EXIT.engineErrors : EXIT.ok;
}
