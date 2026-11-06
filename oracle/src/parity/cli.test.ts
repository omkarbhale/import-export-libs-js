import { describe, expect, it, vi } from "vitest";

const items = vi.hoisted(() => ({ left: [] as unknown[] }));
vi.mock("./port-core.js", async (original) => ({
  ...(await original<typeof import("./port-core.js")>()),
  openSideConnection: async () => ({
    inn: { applyItem: async () => ({ isError: false, items: items.left }) },
    close: async () => {},
  }),
}));

import { assertNoScratchLeft } from "./cli.js";

const server = { url: "http://unused", database: "db", user: "root", password: "x" };

describe("assertNoScratchLeft", () => {
  it("starts when the server has no scratch items", async () => {
    items.left = [];
    await expect(assertNoScratchLeft(server as never)).resolves.toBeUndefined();
  });

  it("refuses leftovers and gives a recovery that needs no run record", async () => {
    items.left = [{}];
    const refusal = await assertNoScratchLeft(server as never).catch((error: Error) => error.message);
    expect(refusal).toContain("On a lease, return it");
    expect(refusal).toContain("On the dev instance, delete");
    expect(refusal).toContain("cleanup --from-runs <run.json>");
  });
});
