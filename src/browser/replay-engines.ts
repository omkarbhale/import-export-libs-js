import type { Engine } from "../engines.js";

/**
 * The engines the browser replays (HOST-265, HOST-266) and the import step of the parity script's browser dry run (HOST-279) run.
 *
 * @spec HOST-263
 */
export const BROWSER_REPLAY_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];
