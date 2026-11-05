import type { Engine } from "../../src/engines.js";

/**
 * The shapes the replay server and a browser test share (HOST-280). They hold no Node import, so that the page's typecheck, which has
 * no Node types, can name them.
 *
 * @spec HOST-280
 */

export type ReplayOperation = "export" | "import" | "language-pack" | "dbpatch";

/** How much of the recording one run has used. */
export interface ReplayStats {
  /** The recorded requests after the login that were sent. */
  consumed: number;
  total: number;
  /** The requests that were not the recorded ones. */
  mismatches: string[];
}

/** What to type into the page to run the case. */
export interface Recipe {
  engine: Engine;
  operation: ReplayOperation;
  /** The login the recording was made with. */
  userName: string;
  /** Export: the packages to select and the level to give. */
  packages?: string[];
  level?: string;
  /** Import, language pack, DB patches: the folder that holds the package, absolute. */
  inputDir?: string;
  /** The `os_user` the recorded rows carry. */
  osUser?: string;
  /** Import: the options the recording was made with (merge, release, …). */
  options?: Record<string, unknown>;
  lpPackage?: string;
  manifestPath?: string;
}


/** What `startReplay` answers with. */
export interface StartedReplay {
  handle: number;
  /** The server's address, as the page's URL field takes it. */
  url: string;
  /** What to type into the page to run the case (`inputDir` is a path of the Vitest side, which a page cannot read). */
  recipe: Recipe;
}

/** What `stopReplay` answers with: what the recording was used for. */
export interface StoppedReplay extends ReplayStats {
  runs: number;
  requests: string[];
}

/** What `runBuiltPage` answers with: what the built page showed, what it downloaded and what the server saw. */
export interface BuiltPageRun {
  failure: string;
  summary: string;
  download: string | undefined;
  errors: string[];
  report: StoppedReplay;
}
