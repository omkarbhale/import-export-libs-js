import { describe, expect, it } from "vitest";
import { EXIT, exitCodeOf } from "./exit.js";

describe("exitCodeOf", () => {
  it("is 0 for a return of 0 without engine errors", () => {
    expect(exitCodeOf(0, 0)).toBe(EXIT.ok);
  });

  it("is 2 for a return of 0 when the engine sent an error message", () => {
    expect(exitCodeOf(0, 3)).toBe(EXIT.engineErrors);
  });

  it("is 1 for any other return, whatever was sent", () => {
    expect(exitCodeOf(1, 0)).toBe(EXIT.failed);
    expect(exitCodeOf(1, 2)).toBe(EXIT.failed);
  });

  it("uses the codes of the design", () => {
    expect(EXIT).toEqual({ ok: 0, failed: 1, engineErrors: 2, usage: 64 });
  });
});
