import type { Session } from "./api-session.js";

/**
 * The tests' seam into the browser API's runs: the clock of the log and the ids of the rows a DB patch run creates. It is keyed by
 * session, and neither `api.ts` nor `browser.ts` exports it, so a page has no way to choose them.
 *
 * @spec HOST-272
 */

export interface RunHooks {
  now?: () => Date;
  newId?: () => string;
}

const hooks = new WeakMap<Session, RunHooks>();

export function setRunHooks(session: Session, runHooks: RunHooks): void {
  hooks.set(session, runHooks);
}

/** The manager option of the clock, when a test set one. */
export function clockOf(session: Session): { now?: () => Date } {
  const now = hooks.get(session)?.now;
  return now === undefined ? {} : { now };
}

/** The `applyDBUpdateManifest` option of the ids, when a test set one. */
export function idsOf(session: Session): { newId?: () => string } {
  const newId = hooks.get(session)?.newId;
  return newId === undefined ? {} : { newId };
}
