import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { browserBundleOptions } from "../../tools/browser-bundle.js";
import { listFiles } from "./manifest.js";
import { findSecrets } from "./scrub.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** AGENTS.md rule 6: no password, Authorization header or token-shaped string in any committed fixture. */
describe("committed fixtures carry no credentials", () => {
  const files = listFiles(join(ROOT, "fixtures"));

  it("scans the fixtures folder", () => {
    expect(files).toContain("README.md");
  });

  it.each(files)("%s", (path) => {
    const hits = findSecrets(readFileSync(join(ROOT, "fixtures", path)).toString("latin1"));
    expect(hits).toEqual([]);
  });
});

/**
 * The browser parity harness (HOST-277) takes the server's password in one request and keeps it nowhere: its sources, and the page and
 * Worker bundles built from them, are held to the same scan as the fixtures, and none names the environment variable that the driver
 * reads the password from except the driver itself.
 */
describe("the browser parity harness carries no credentials", () => {
  const harness = [
    "oracle/src/parity/browser-runner.ts",
    "oracle/src/parity/browser-dry-run.ts",
    "oracle/src/parity/proxy.ts",
    "oracle/src/parity/port-core.ts",
    ...["index.html", "page.ts", "worker.ts", "run.ts", "protocol.ts"].map((file) => `oracle/src/parity/browser-page/${file}`),
  ];

  it.each(harness)("%s", (path) => {
    const text = readFileSync(join(ROOT, path), "utf8");
    expect(findSecrets(text)).toEqual([]);
    expect(text).not.toContain("ARAS_PASSWORD");
  });

  it.each(["page.ts", "worker.ts"])("the built %s", async (entry) => {
    const built = await build({
      ...browserBundleOptions(ROOT.replace(/\/$/, ""), `oracle/src/parity/browser-page/${entry}`),
      write: false,
      outfile: entry.replace(/\.ts$/, ".js"),
    });
    const text = built.outputFiles[0]!.text;
    expect(findSecrets(text)).toEqual([]);
    expect(text).not.toContain("ARAS_PASSWORD");
  });
});
