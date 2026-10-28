import { describe, expect, it } from "vitest";
import { resolveLiveTarget, serverMajor } from "../../oracle/src/live-targets.js";
import { HttpConnectorExtension } from "./connection.js";
import { md5Digest } from "./digest.js";
import { CItemHelper } from "./item-helper.js";
import { localWindowsTimeZoneId } from "./timezone.js";

/**
 * Against the dev instance or an arashouse lease, read-only: log in, probe the
 * version, pass the gate and log off. It runs only with credentials (AGENTS.md "Live Aras"):
 *
 *   ARAS_PASSWORD=… npx vitest run src/client/live.test.ts
 *
 * The password arrives through the environment, never a flag or a file. IOM 15 (engine 14.35) sends a password as given, so
 * for that engine the test hands the connection the MD5 hex, as the oracle's host does (`oracle/README.md`, Rules).
 * `ARAS_URL` (default http://172.19.0.1/12sp9 from WSL), `ARAS_DATABASE`
 * (12sp9) and `ARAS_USER` (admin) can change the connection, but only to the
 * dev instance or to a lease that `arashouse status --json` shows as leased
 * (`oracle/src/live-targets.ts`), as `arashouse run --lease <id> -- npx vitest run …` sets them.
 */
const password = process.env["ARAS_PASSWORD"];
const url = process.env["ARAS_URL"] ?? "http://172.19.0.1/12sp9";
const database = process.env["ARAS_DATABASE"] ?? "12sp9";

describe.skipIf(password === undefined || password === "")("the dev instance or a lease", () => {
  it.each(["14.0.7", "14.35"] as const)("accepts a login of engine %s, reads its version and passes the gate, then logs off", async (engine) => {
    const target = await resolveLiveTarget(url, database);
    expect(target, `${url} (database ${database}) is neither the dev instance nor an arashouse lease`).not.toBeNull();
    const connection = new HttpConnectorExtension({
      engine,
      url,
      database,
      userName: process.env["ARAS_USER"] ?? "admin",
      password: engine === "14.35" ? md5Digest(password ?? "") : (password ?? ""),
      timeZoneName: localWindowsTimeZoneId(),
    });
    const helper = new CItemHelper(connection, { engine });
    await helper.login();
    try {
      expect(helper.isConnected).toBe(true);
      expect(helper.innovatorVersion?.major).toBe(serverMajor(target!));
      expect(helper.versionGate).toMatchObject({ engine, accepted: true, skipped: false });
    } finally {
      await helper.logout();
    }
    if (engine === "14.35") expect(helper.isConnected).toBe(false);
  });
});
