import { describe, expect, it } from "vitest";
import { trimWhiteSpace } from "./dotnet.js";

describe("string.Trim()", () => {
  it("removes .NET's white space from both ends and nothing else", () => {
    expect(trimWhiteSpace(" \t\r\n\u000b\u000c x y   　")).toBe("x y");
    expect(trimWhiteSpace("")).toBe("");
    expect(trimWhiteSpace("  \n ")).toBe("");
  });

  it("differs from JavaScript's trim at U+0085 and U+FEFF", () => {
    expect(trimWhiteSpace("\u0085x\u0085")).toBe("x");
    expect(trimWhiteSpace("﻿x﻿")).toBe("﻿x﻿");
    expect("\u0085x\u0085".trim()).toBe("\u0085x\u0085");
  });
});
