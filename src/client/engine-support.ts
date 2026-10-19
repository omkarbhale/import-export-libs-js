import type { Engine } from "../engines.js";

/** The engines whose client behaviour is implemented; the rest wait for their variant slices. */
export const CLIENT_ENGINES: readonly Engine[] = ["14.0.7", "14.35"];

export class EngineNotSupportedError extends Error {
  constructor(readonly engine: Engine) {
    super(`engine ${engine} is not yet supported`);
    this.name = "EngineNotSupportedError";
  }
}
