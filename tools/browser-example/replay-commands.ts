/**
 * The commands through which a browser test starts and stops the replay server of a recorded case (HOST-280). The server runs on the
 * Vitest side, in Node, on a port of its own, so that a page in a browser reaches it across origins, as it reaches an Aras server.
 *
 * Test-only tooling: nothing under `src/` imports it.
 *
 * @spec HOST-280
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserCommand } from "vitest/node";
import "@vitest/browser-playwright";
import { buildExample } from "./build.js";
import { type ReplayServer, loadReplayCase, startReplayServer } from "./replay-server.js";
import type { BuiltPageRun, StartedReplay, StoppedReplay } from "./replay-types.js";
import { serveFolder } from "./serve.js";

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
  /**
   * Builds the page, serves it with its security headers and runs a recorded export in a top-level tab, as a person opens it: the
   * page's own script starts its default Worker from the file beside it. The headers forbid a frame, so this cannot run in the test's own page.
   */
  runBuiltPage: async (context, id): Promise<BuiltPageRun> => {
    const replay = loadReplayCase(id);
    const { recipe } = replay;
    const folder = mkdtempSync(path.join(os.tmpdir(), "aras-pkg-built-page-"));
    const server = await startReplayServer(replay);
    let site: Awaited<ReturnType<typeof serveFolder>> | undefined;
    const page = await context.context.newPage();
    try {
      await buildExample(folder);
      site = await serveFolder(folder);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(site.url);
      await page.locator('[data-key="url"]').fill(server.url);
      await page.locator('[data-key="database"]').fill("12sp9");
      await page.locator('[data-key="userName"]').fill(recipe.userName);
      await page.locator('[data-key="password"]').fill("pw-of-the-test-xyz");
      await page.locator('[data-key="engine"]').selectOption(recipe.engine);
      await page.locator('[data-panel="export"] [data-key="packages"]').fill((recipe.packages ?? []).join("\n"));
      if (recipe.level !== undefined) await page.locator('[data-panel="export"] [data-key="level"]').fill(recipe.level);
      const downloaded = page.waitForEvent("download", { timeout: 90_000 }).then(
        (download) => download.suggestedFilename(),
        () => undefined,
      );
      await page.locator('[data-key="run"]').click();
      await page.locator('[data-key="run"]:enabled').waitFor({ timeout: 90_000 });
      const failure = (await page.locator('.run-view [role="alert"]').textContent()) ?? "";
      const download = failure === "" ? await downloaded : undefined;
      const summary = (await page.locator(".summary").textContent()) ?? "";
      return { failure, summary, download, errors, report: { ...server.report(), requests: [...server.requests] } };
    } finally {
      await page.close();
      await server.close();
      if (site !== undefined) {
        site.server.closeAllConnections();
        await new Promise((resolve) => site?.server.close(resolve));
      }
      rmSync(folder, { recursive: true, force: true });
    }
  },
};
