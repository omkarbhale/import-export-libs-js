import { describe, expect, it } from "vitest";
import { LazyCache, LazyValue } from "./lazy-cache.js";

describe("LazyValue: .NET's Lazy<T> in its default mode (IMP-102)", () => {
  it("runs the factory at the first read, once, and keeps the value", async () => {
    let runs = 0;
    const lazy = new LazyValue(async () => {
      runs += 1;
      return "answer";
    });
    expect(runs).toBe(0);
    expect(await lazy.value).toBe("answer");
    expect(await lazy.value).toBe("answer");
    expect(runs).toBe(1);
  });

  it("keeps an exception and throws the same object to every later reader (IMP-183)", async () => {
    let runs = 0;
    const failure = new Error("boom");
    const lazy = new LazyValue<string>(() => {
      runs += 1;
      throw failure;
    });
    await expect(lazy.value).rejects.toBe(failure);
    await expect(lazy.value).rejects.toBe(failure);
    expect(runs).toBe(1);
  });

  it("keeps a rejection of an asynchronous factory too", async () => {
    const failure = new Error("late");
    const lazy = new LazyValue<string>(async () => {
      throw failure;
    });
    await expect(lazy.value).rejects.toBe(failure);
    await expect(lazy.value).rejects.toBe(failure);
  });
});

describe("LazyCache: the ConcurrentDictionary of 14.35's _requestedItems (IMP-102)", () => {
  it("GetOrAdd makes an entry once and returns it afterwards, without reading it", async () => {
    const cache = new LazyCache();
    let runs = 0;
    const first = cache.getOrAdd("k", () => (runs += 1));
    expect(cache.getOrAdd("k", () => 99)).toBe(first);
    expect(runs).toBe(0);
    expect(await first.value).toBe(1);
    expect(runs).toBe(1);
  });

  it("TryAdd refuses a key that has an entry, and TryRemove removes it", async () => {
    const cache = new LazyCache();
    const old = new LazyValue(() => "old");
    expect(cache.tryAdd("k", old)).toBe(true);
    expect(cache.tryAdd("k", new LazyValue(() => "new"))).toBe(false);
    expect(await cache.tryGetValue<string>("k")?.value).toBe("old");
    cache.tryRemove("k");
    expect(cache.has("k")).toBe(false);
    expect(cache.tryGetValue("k")).toBeUndefined();
    expect(cache.tryAdd("k", new LazyValue(() => "new"))).toBe(true);
  });

  it("compares keys ordinally and case-sensitively", () => {
    const cache = new LazyCache();
    cache.getOrAdd("<Item type='A'/>", () => 1);
    expect(cache.has("<item type='a'/>")).toBe(false);
  });
});
