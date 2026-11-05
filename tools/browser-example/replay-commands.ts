/**
 * The commands through which a browser test starts and stops the replay server of a recorded case (HOST-280). The server runs on the
 * Vitest side, in Node, on a port of its own, so that a page in a browser reaches it across origins, as it reaches an Aras server.
 *
 * Test-only tooling: nothing under `src/` imports it.
 *
 * @spec HOST-280
 */
import type { BrowserCommand } from "vitest/node";
import { type ReplayServer, loadReplayCase, startReplayServer } from "./replay-server.js";
import type { StartedReplay, StoppedReplay } from "./replay-types.js";

const running = new Map<number, ReplayServer>();
let next = 1;

export const replayCommands: Record<string, BrowserCommand<[string]>> = {
  startReplay: async (_context, id): Promise<StartedReplay> => {
    const replay = loadReplayCase(id);
    const server = await startReplayServer(replay);
    const handle = next++;
    running.set(handle, server);
    return { handle, url: server.url, recipe: replay.recipe };
  },
  stopReplay: async (_context, handle): Promise<StoppedReplay> => {
    const server = running.get(Number(handle));
    if (server === undefined) throw new Error(`there is no replay server ${handle}`);
    running.delete(Number(handle));
    const report = { ...server.report(), requests: [...server.requests] };
    await server.close();
    return report;
  },
};
