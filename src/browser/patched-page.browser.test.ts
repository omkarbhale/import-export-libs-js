import { afterAll, describe, expect, it } from "vitest";
import { connect, exportPackages, vfsToZip } from "../browser.js";
import type { Engine } from "../engines.js";
import { packageCaches } from "../client/package-lookups.js";
import { loadExportCase, replayExportCase } from "./export-replay-support.browser.js";
import { BROWSER_REPLAY_ENGINES } from "./replay-engines.js";
import { withMicrosoftAjaxStrings } from "./page-patches.js";
import { type Scenario, actionsOf, wireScenario } from "./wire-support.browser.js";

/**
 * The library in a page that replaced `String.prototype.startsWith` and `endsWith` as the Aras 12 client does (HOST-283): the page's
 * thread runs `connect` and an export over the browser's `fetch` against a server in another origin, and a recorded export case of
 * each engine, with the page's methods in place, and gets what it gets without them. Before HOST-283 the login's answer failed to
 * load ("Name cannot begin with the '/' character"), because the XML readers asked `startsWith("</", index)`.
 *
 * @spec HOST-283
 */

const scenarios: Scenario[] = [];
afterAll(async () => {
  await Promise.all(scenarios.map((scenario) => scenario.release()));
});

describe("HOST-283: the library runs in a page that patched startsWith as the Aras 12 client does", () => {
  it("connects and exports over fetch", async () => {
    packageCaches.dependsOn.clear();
    const made = await wireScenario({ engine: "14.0.7", synth: { operation: "export", seed: 7, count: 6, packageName: "My Package" } });
    scenarios.push(made);
    const { summary, zip } = await withMicrosoftAjaxStrings(async () => {
      const session = await connect({ url: made.url, database: "12sp9", userName: "admin", password: "secret-pw" });
      const { vfs, summary } = await exportPackages(session, { packages: ["My Package"] });
      await session.close();
      return { summary, zip: vfsToZip(vfs, "/export") };
    });
    expect(summary).toMatchObject({ operation: "export", result: "success" });
    expect(zip.byteLength).toBeGreaterThan(0);
    const actions = actionsOf((await made.log()).seen);
    expect(actions[0]).toBe("ValidateUser");
    expect(actions.at(-1)).toBe("Logoff");
  });

  it.each(BROWSER_REPLAY_ENGINES)("replays the recorded %s export of a package with item files, byte for byte", async (engine: Engine) => {
    const loaded = await loadExportCase({ engine, operation: "export", name: "e27-permission", covers: "a package with item files" });
    await withMicrosoftAjaxStrings(() => replayExportCase(loaded));
  });
});
