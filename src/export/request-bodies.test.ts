import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cmfBody, itemTypeBody } from "./request-bodies.js";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const elementCount = (body: string) => body.match(/<Item /g)?.length ?? 0;

describe("the request bodies, by the lengths and digests the spec records (EXP-024, EXP-025)", () => {
  it.each([
    ["the current ItemType body", itemTypeBody(14), 30, 1699, "cce60f07f2f932fbf20b394e33a390b707f21c5aa1e4bb084cee768f9ba7db2b"],
    ["the current body from server 11 on", itemTypeBody(11), 30, 1699, "cce60f07f2f932fbf20b394e33a390b707f21c5aa1e4bb084cee768f9ba7db2b"],
    ["the older ItemType body, below server 11", itemTypeBody(10), 23, 1219, "218c420c5c173eb0c39034e51b402b5ca2c62df8d45ca51216c2d071d13bc06c"],
    ["the content-type body", cmfBody("cmf_ContentType"), 10, 643, "b05314bca582d6a24033ae0ca3a765f7c6e8ba0284f99bbdd309ed572fd19b3d"],
    ["the tabular-view body", cmfBody("cmf_TabularView"), 6, 449, "34e083dd28c64310a298effc615297faeff845f0be4415b225ac204bad6ab999"],
  ])("%s", (_, body, items, length, digest) => {
    expect(elementCount(body)).toBe(items);
    expect(body).toHaveLength(length);
    expect(sha256(body)).toBe(digest);
  });

  it("is a single Relationships element with no whitespace between elements", () => {
    for (const body of [itemTypeBody(14), cmfBody("cmf_ContentType")]) {
      expect(body.startsWith("<Relationships><Item ")).toBe(true);
      expect(body.endsWith("</Relationships>")).toBe(true);
      expect(body).not.toMatch(/>\s+</);
    }
  });
});
