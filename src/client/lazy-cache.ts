/**
 * .NET's `Lazy<T>` in its default mode (`ExecutionAndPublication`): the factory runs at the first read of the value, once, and
 * what it returned is kept. An exception it threw is kept too and thrown again, the same object, to every later reader (IMP-102,
 * IMP-183).
 */
export class LazyValue<T> {
  private started: Promise<T> | undefined;

  constructor(private readonly factory: () => Promise<T> | T) {}

  /** `Lazy<T>.Value`. */
  get value(): Promise<T> {
    this.started ??= (async () => this.factory())();
    return this.started;
  }
}

/**
 * 14.35's `_requestedItems`: a `ConcurrentDictionary<string, Lazy<XmlDocument>>` keyed by the exact engine text of a request,
 * ordinal and case-sensitive (IMP-102, EXP-030). It is never emptied except by the removals each lookup makes. The port runs one
 * request at a time, so `GetOrAdd` and `TryAdd` need no more than a map.
 *
 * @spec IMP-102 EXP-030
 */
export class LazyCache {
  private readonly entries = new Map<string, LazyValue<unknown>>();

  /** `TryGetValue`: the entry, without reading its value. */
  tryGetValue<T>(key: string): LazyValue<T> | undefined {
    return this.entries.get(key) as LazyValue<T> | undefined;
  }

  /** `GetOrAdd(key, factory)`: the entry of the key, made from `factory` when there is none. Its value is not read. */
  getOrAdd<T>(key: string, factory: () => Promise<T> | T): LazyValue<T> {
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing as LazyValue<T>;
    const created = new LazyValue(factory);
    this.entries.set(key, created);
    return created;
  }

  /** `TryAdd(key, value)`: adds the entry only when the key has none; true when it did. */
  tryAdd(key: string, value: LazyValue<unknown>): boolean {
    if (this.entries.has(key)) return false;
    this.entries.set(key, value);
    return true;
  }

  /** `TryRemove(key)`. */
  tryRemove(key: string): void {
    this.entries.delete(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }
}
