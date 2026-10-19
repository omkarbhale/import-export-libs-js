import { describe, expect, it } from "vitest";
import { PasswordDigest } from "./digest.js";
import { DotNetException, parseInt32, tryParseInt32 } from "./dotnet.js";

const MD5_TEST = "098f6bcd4621d373cade4e832627b4f6";
const SHA256_TEST = "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08";

describe("PasswordDigest (WIRE-014, WIRE-055)", () => {
  it("starts in MD5 mode with the lowercase hex digest", () => {
    const digest = new PasswordDigest("test");
    expect([digest.mode, digest.value]).toEqual(["MD5", MD5_TEST]);
  });

  it("switches to SHA-256 with the uppercase hex digest", () => {
    const digest = new PasswordDigest("test");
    digest.switchTo("SHA256");
    expect([digest.mode, digest.value]).toEqual(["SHA256", SHA256_TEST]);
    digest.switchTo("MD5");
    expect(digest.value).toBe(MD5_TEST);
  });

  it("uses a 32-character hex password as an MD5 hash, in any case, and cannot switch to SHA-256", () => {
    const digest = new PasswordDigest(MD5_TEST.toUpperCase());
    expect([digest.mode, digest.value]).toEqual(["MD5", MD5_TEST.toUpperCase()]);
    expect(() => digest.switchTo("SHA256")).toThrow("Parole already contains Md5 hash.");
    expect(digest.mode).toBe("MD5");
  });

  it("uses a 64-character hex password as a SHA-256 hash, in SHA-256 mode from the start", () => {
    const digest = new PasswordDigest(SHA256_TEST.toLowerCase());
    expect([digest.mode, digest.value]).toEqual(["SHA256", SHA256_TEST.toLowerCase()]);
    expect(() => digest.switchTo("MD5")).toThrow("Parole already contains Sha256 hash.");
  });

  it("takes 32 hex characters and a final line feed for an MD5 hash, as .NET's $ does (WIRE-014)", () => {
    const digest = new PasswordDigest(`${MD5_TEST}\n`);
    expect(digest.value).toBe(`${MD5_TEST}\n`);
    expect(() => digest.switchTo("SHA256")).toThrow("Parole already contains Md5 hash.");
    expect(new PasswordDigest(`${SHA256_TEST}\n`).mode).toBe("SHA256");
    // Two line feeds, or a carriage return, are not a final line feed: the text is hashed.
    expect(new PasswordDigest(`${MD5_TEST}\n\n`).value).not.toBe(`${MD5_TEST}\n\n`);
    expect(new PasswordDigest(`${MD5_TEST}\r\n`).value).not.toBe(`${MD5_TEST}\r\n`);
  });

  it("refuses an unknown mode", () => {
    expect(() => new PasswordDigest("test").switchTo("md5")).toThrow(DotNetException);
    expect(() => new PasswordDigest("test").switchTo("md5")).toThrow("Unknown hashing mode.");
  });

  it("hashes every non-ASCII character as one question mark (WIRE-055)", () => {
    const question = new PasswordDigest("a?b").value;
    expect(new PasswordDigest("aéb").value).toBe(question);
    expect(new PasswordDigest("a\u{1F600}b").value).toBe(question);
    expect(new PasswordDigest("a b").value).toBe(question);
    expect(new PasswordDigest("aéb").value).not.toBe(new PasswordDigest("ab").value);
  });
});

describe(".NET integer parsing", () => {
  it.each([
    ["12", 12],
    [" 12 ", 12],
    ["+7", 7],
    ["-7", -7],
    ["\t0\r\n", 0],
    ["2147483647", 2147483647],
    ["-2147483648", -2147483648],
  ])("parses %j as %d", (text, value) => {
    expect(tryParseInt32(text)).toBe(value);
    expect(parseInt32(text)).toBe(value);
  });

  it.each(["", " ", "1.0", "SP9", "1 2", "0x10", "٣", "1,000"])("rejects %j as a format error", (text) => {
    expect(tryParseInt32(text)).toBeUndefined();
    expect(() => parseInt32(text)).toThrow("Input string was not in a correct format.");
  });

  it("rejects values outside Int32 as an overflow", () => {
    expect(tryParseInt32("2147483648")).toBeUndefined();
    expect(() => parseInt32("-2147483649")).toThrow("Value was either too large or too small for an Int32.");
  });

  it("rejects null", () => {
    expect(tryParseInt32(null)).toBeUndefined();
    expect(() => parseInt32(null)).toThrow(/Value cannot be null/);
  });
});
