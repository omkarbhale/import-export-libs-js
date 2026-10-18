import { describe, expect, it } from "vitest";
import { groupAddedIdsByType } from "./add-order.js";

describe("IMP-040: the merge dictionary keeps insertion order", () => {
  it("enumerates the types by their first add with an id, and each type's ids in document order", () => {
    const grouped = groupAddedIdsByType([
      { type: "Method", id: "m1" },
      { type: "List", id: "" },
      { type: "ItemType", id: "t1" },
      { type: "List", id: "l1" },
      { type: "Method", id: "m2" },
      { type: "ItemType", id: "t2" },
      { type: "List", id: "l2" },
    ]);
    expect([...grouped]).toEqual([
      ["Method", ["m1", "m2"]],
      ["ItemType", ["t1", "t2"]],
      ["List", ["l1", "l2"]],
    ]);
  });

  it("makes no entry for a type whose adds all lack an id, and keeps an empty type name", () => {
    const grouped = groupAddedIdsByType([
      { type: "List", id: "" },
      { type: "", id: "x" },
    ]);
    expect([...grouped]).toEqual([["", ["x"]]]);
  });

  it("does not collapse a repeated id", () => {
    expect([...groupAddedIdsByType([{ type: "A", id: "1" }, { type: "A", id: "1" }])]).toEqual([["A", ["1", "1"]]]);
  });
});
