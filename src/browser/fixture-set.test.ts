import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINES } from "../engines.js";
import { FIXTURE_CASES, fixtureBlobPath, fixtureCasePath, transcriptBlobs } from "./fixture-set.js";

/**
 * The most the curated fixtures may weigh, which is every case folder of `fixture-set.ts` and the recorded blobs the transcripts
 * of those folders name, each once. It was 12 718 696 bytes when the set was made (6.8 MB of case folders and 6 blobs, 5.9 MB), and
 * 46 422 910 bytes when the import, language-pack and DB-patch replays of the browsers (HOST-266) took their cases (10.7 MB of case
 * folders and 17 blobs, 35.7 MB: a case whose server had other packages has a list of its own, 2.7 MB), plus 5 %. Raise it in a
 * pull request that adds cases on purpose, and amend map decision D10 (`roadmap/browser-host.md`) there.
 *
 * @spec HOST-263
 */
const BUDGET_BYTES = 48_750_000;

const root = process.cwd();

function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );
}

/** Every file the set needs: the case folders, and the blobs their transcripts name. */
function setFiles(): string[] {
  const all = new Set<string>();
  for (const fixture of FIXTURE_CASES) {
    const folder = fixtureCasePath(fixture);
    for (const file of files(folder)) {
      all.add(file);
      if (file.endsWith("/transcript.jsonl")) {
        for (const sha of transcriptBlobs(readFileSync(join(root, file), "utf8"))) all.add(fixtureBlobPath(fixture, sha));
      }
    }
  }
  return [...all].sort();
}

describe("HOST-263: the curated fixture set of the browser tests", () => {
  it("has no case twice, and only engines the library has", () => {
    const keys = FIXTURE_CASES.map((fixture) => fixtureCasePath(fixture));
    expect(new Set(keys).size).toBe(keys.length);
    for (const fixture of FIXTURE_CASES) expect(ENGINES).toContain(fixture.engine);
  });

  it.each(FIXTURE_CASES.map((fixture) => [fixtureCasePath(fixture), fixture] as const))("%s is on the disk with what its replay reads", (folder, fixture) => {
    expect(existsSync(join(root, folder)), folder).toBe(true);
    const inside = files(folder);
    // an export case has one transcript and an `output/` folder; the other operations run in `step-N/` folders with an `input/` folder
    expect(inside.some((file) => file.endsWith("/transcript.jsonl")), `${folder}: a transcript`).toBe(true);
    expect(inside.some((file) => file.endsWith("/messages.jsonl")), `${folder}: the recorded messages`).toBe(true);
    expect(inside.some((file) => /\/(output|input|lp)\//.test(file)), `${folder}: the folder tree (output, input or lp)`).toBe(true);
    for (const file of inside.filter((name) => name.endsWith("/transcript.jsonl"))) {
      for (const sha of transcriptBlobs(readFileSync(join(root, file), "utf8"))) {
        expect(existsSync(join(root, fixtureBlobPath(fixture, sha))), `${file}: blob ${sha}`).toBe(true);
      }
    }
  });

  it("reads every blob with the bytes the case itself recorded, from one file per hash", () => {
    const paths = new Map<string, string>();
    for (const fixture of FIXTURE_CASES) {
      for (const file of files(fixtureCasePath(fixture)).filter((name) => name.endsWith("/transcript.jsonl"))) {
        for (const sha of transcriptBlobs(readFileSync(join(root, file), "utf8"))) {
          const path = fixtureBlobPath(fixture, sha);
          expect(paths.get(sha) ?? path, `${sha} is read from two files`).toBe(path);
          if (paths.has(sha)) continue;
          paths.set(sha, path);
          expect(createHash("sha256").update(readFileSync(join(root, path))).digest("hex"), path).toBe(sha);
        }
      }
    }
    expect(paths.size).toBeGreaterThan(0);
  });

  it("weighs no more than its budget", () => {
    const bytes = setFiles().reduce((sum, file) => sum + statSync(join(root, file)).size, 0);
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(bytes).toBeGreaterThan(0);
  });

  it("reads the blobs a transcript names, once each", () => {
    const line = (blob: string): string => JSON.stringify({ action: "x", responseBlob: blob });
    expect(transcriptBlobs([line("a"), JSON.stringify({ action: "y" }), line("b"), line("a"), ""].join("\n"))).toEqual(["a", "b"]);
  });
});
