import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
