import { HttpConnectorExtension } from "../client/connection.js";
import { CItemHelper } from "../client/item-helper.js";
import type { Engine } from "../engines.js";
import type { CliIo } from "./io.js";
import type { ConnectionOptions } from "./options.js";
import type { Reporter } from "./reporter.js";

/**
 * What the console host does before an operation (WIRE-002 steps 1 and 2): builds the connection from the URL, database, user
 * and password as given, wraps it in the engine's helper and logs in, with the version probe and gate. A login that fails escapes
 * as it is, and no logoff follows it. The caller logs out when the operation is over.
 *
 * @spec WIRE-002
 */
export async function openSession(engine: Engine, options: ConnectionOptions, io: CliIo, reporter: Reporter): Promise<CItemHelper> {
  const connection = new HttpConnectorExtension({
    engine,
    url: options.url,
    database: options.database,
    userName: options.user,
    password: options.password,
    timeZoneName: options.timeZoneName,
    ...(io.transport === undefined ? {} : { transport: io.transport }),
  });
  const helper = new CItemHelper(connection, { engine, skipVersionCheck: options.skipVersionCheck });
  await helper.login();
  const gate = helper.versionGate;
  if (gate?.skipped) {
    reporter.warn(
      `Aras server ${gate.server.fullString} is outside the window of engine ${engine}; the run goes on because of --skip-version-check.`,
    );
  }
  return helper;
}
