import { describe, expect, it } from "vitest";
import { SCRUBBED, SCRUBBED_TOKEN, findSecrets, scrub, secretForms } from "./scrub.js";

// Token-shaped values are assembled at run time so no credential-shaped literal sits in the repo.
const jwt = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJyb290In0", "c2lnbmF0dXJlLWJ5dGVz"].join(".");
const opaque = "Zm9vYmFyYmF6cXV4cXV1eA".repeat(2);

describe("scrub", () => {
  it("leaves text with no credentials byte-identical", () => {
    const text = "\ufeff<AML>\r\n  <Item type=\"User\"><password_hash_algorithm>MD5</password_hash_algorithm></Item>\r\n</AML>";
    expect(scrub(text)).toEqual({ text, counts: {} });
    expect(findSecrets(text)).toEqual([]);
  });

  it("replaces password hashes in item data", () => {
    const { text, counts } = scrub('<Item type="User"><password>' + "a".repeat(32) + "</password><password_salt>x1</password_salt></Item>");
    expect(text).toBe(`<Item type="User"><password>${SCRUBBED}</password><password_salt>${SCRUBBED}</password_salt></Item>`);
    expect(counts).toEqual({ "password element": 2 });
    expect(findSecrets(text)).toEqual([]);
  });

  it("replaces headers, bearer tokens, OAuth fields and JWTs", () => {
    const raw = [
      `Authorization: Bearer ${opaque}`,
      `{"access_token":"${opaque}","token_type":"Bearer"}`,
      `refresh_token=${opaque}&x=1`,
      `id ${jwt} end`,
      `{"password":"hunter22"}`,
      `GET /x?user=root&password=hunter22`,
    ].join("\n");
    expect(findSecrets(raw).map((h) => h.pattern).sort()).toEqual(
      ["Authorization header", "JWT", "OAuth token field", "OAuth token field", "bearer token", "password field", "password parameter"].sort(),
    );
    const { text } = scrub(raw);
    expect(text).not.toContain(opaque);
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("hunter22");
    expect(text).toContain(`Authorization: ${SCRUBBED_TOKEN}`);
    expect(findSecrets(text)).toEqual([]);
  });

  it("never consumes a JSON escape, so a scrubbed transcript line stays valid JSON", () => {
    const line = JSON.stringify({
      request: 'url + "&password=" + pw',
      response: `Authorization: Bearer ${opaque}" x`,
      error: `{"access_token":"${opaque}"}`,
    });
    const { text } = scrub(line);
    const parsed = JSON.parse(text) as Record<string, string>;
    expect(parsed.request).toBe('url + "&password=" + pw');
    expect(parsed.response).toBe(`Authorization: ${SCRUBBED_TOKEN}" x`);
    expect(text).not.toContain(opaque);
    expect(findSecrets(text)).toEqual([]);
  });

  it("replaces a run's own secret and its MD5 and SHA-256 forms", () => {
    const forms = secretForms("pw-for-test");
    expect(forms).toHaveLength(4);
    const raw = `a ${forms[0]} b ${forms[3]} c`;
    const { text, counts } = scrub(raw, forms);
    expect(text).toBe(`a ${SCRUBBED} b ${SCRUBBED} c`);
    expect(counts["run secret"]).toBe(2);
  });
});
