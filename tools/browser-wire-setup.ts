/**
 * The global setup of the browser project (HOST-234): it starts the HTTP test server of the wire tests (`src/browser/test-server.ts`)
 * once for a run and gives its origin to the pages as the provided value `wireServerOrigin`, which a test reads with `inject`. The
 * server stops when the run ends. It listens on the loopback interface on a free port, so a page served from Vitest's own port is
 * on another origin and its requests are cross-origin, as a page and a real Aras server are. Test-only tooling: nothing under `src/`
 * imports it.
 *
 * @spec HOST-234
 */
import type { TestProject } from "vitest/node";
import { startWireServer } from "../src/browser/test-server.js";

declare module "vitest" {
  interface ProvidedContext {
    /** The origin of the wire tests' HTTP server, `http://127.0.0.1:<port>`. */
    wireServerOrigin: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await startWireServer();
  project.provide("wireServerOrigin", server.origin);
  return () => server.close();
}
