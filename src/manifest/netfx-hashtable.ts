/**
 * .NET Framework 4.x `System.Collections.Hashtable` with the default comparer and string keys, as the 64-bit hosts run
 * it with randomized string hashing off. Only what decides the enumeration order is modelled: the engine's tables are
 * enumerated in the order of their buckets, and that order is a function of the keys and of the exact sequence of
 * `Add`, indexer-set and `Remove` operations (MAN-017). Callers therefore replay the engine's operation sequence.
 */

/**
 * The 64-bit legacy `String.GetHashCode`. A NUL ends the hash, because the runtime walks a NUL-terminated buffer.
 * @spec MAN-017
 */
export function netfxStringHash64(text: string): number {
  let hash1 = 5381;
  let hash2 = 5381;
  for (let i = 0; i < text.length; i += 2) {
    const first = text.charCodeAt(i);
    if (first === 0) break;
    hash1 = (((hash1 << 5) + hash1) | 0) ^ first;
    const second = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (second === 0) break;
    hash2 = (((hash2 << 5) + hash2) | 0) ^ second;
  }
  return (hash1 + Math.imul(hash2, 1566083941)) | 0;
}

const HASH_PRIME = 101;
const INITIAL_SIZE = 3;
const LOAD_FACTOR = Math.fround(0.72);
/** An insertion that walks more than this many occupied buckets makes .NET switch to randomized hashing. */
const COLLISION_LIMIT = 100;

const PRIMES = [
  3, 7, 11, 17, 23, 29, 37, 47, 59, 71, 89, 107, 131, 163, 197, 239, 293, 353, 431, 521, 631, 761, 919, 1103, 1327,
  1597, 1931, 2333, 2801, 3371, 4049, 4861, 5839, 7013, 8419, 10103, 12143, 14591, 17519, 21023, 25229, 30293, 36353,
  43627, 52361, 62851, 75431, 90523, 108631, 130363, 156437, 187751, 225307, 270371, 324449, 389357, 467237, 560689,
  672827, 807403, 968897, 1162687, 1395263, 1674319, 2009191, 2411033, 2893249, 3471899, 4166287, 4999559, 5999471,
  7199369,
];

function isPrime(candidate: number): boolean {
  if ((candidate & 1) === 0) return candidate === 2;
  const limit = Math.floor(Math.sqrt(candidate));
  for (let divisor = 3; divisor <= limit; divisor += 2) if (candidate % divisor === 0) return false;
  return true;
}

/** `HashHelpers.GetPrime`: the smallest listed prime that is at least `minimum`, else the next suitable odd prime. */
function getPrime(minimum: number): number {
  for (const prime of PRIMES) if (prime >= minimum) return prime;
  for (let candidate = minimum | 1; candidate < 0x7fffffff; candidate += 2) {
    if (isPrime(candidate) && (candidate - 1) % HASH_PRIME !== 0) return candidate;
  }
  return minimum;
}

/** `(int)(0.72f * size)`, computed in 32-bit floating point. */
function loadSizeOf(size: number): number {
  return Math.trunc(Math.fround(LOAD_FACTOR * size));
}

/** The probe step: `1 + (uint)(seed * 101) % (size - 1)`, with the product wrapping at 32 bits. */
function stepOf(seed: number, size: number): number {
  return 1 + ((Math.imul(seed, HASH_PRIME) >>> 0) % (size - 1));
}

/** The key of a bucket that held a key and was removed while its collision flag was set. */
const DELETED = Symbol("deleted");

interface Bucket<V> {
  key: string | typeof DELETED | undefined;
  value: V | undefined;
  /** The low 31 bits of the key's hash. */
  hash: number;
  collision: boolean;
}

function emptyBuckets<V>(count: number): Bucket<V>[] {
  return Array.from({ length: count }, () => ({ key: undefined, value: undefined, hash: 0, collision: false }));
}

/** A table of string keys whose enumeration order is .NET's. */
export class NetfxHashtable<V> {
  private buckets: Bucket<V>[] = emptyBuckets<V>(INITIAL_SIZE);
  private loadSize = loadSizeOf(INITIAL_SIZE);
  private occupancy = 0;
  private liveCount = 0;

  /** `name` says which table it is, for the error of MAN-018. */
  constructor(readonly name = "Hashtable") {}

  /** The number of entries. */
  get count(): number {
    return this.liveCount;
  }

  /** `table[key] = value`: replaces the value of an equal key and keeps its bucket. */
  set(key: string, value: V): void {
    this.insert(key, value, false);
  }

  /** `table.Add(key, value)`: throws `ArgumentException` when the key is present. */
  add(key: string, value: V): void {
    this.insert(key, value, true);
  }

  /** `table[key]`, or undefined when the key is absent. */
  get(key: string): V | undefined {
    const index = this.find(key);
    return index < 0 ? undefined : (this.buckets[index] as Bucket<V>).value;
  }

  /** `table.ContainsKey(key)`. */
  has(key: string): boolean {
    return this.find(key) >= 0;
  }

  /** `table.Remove(key)`. */
  remove(key: string): void {
    const size = this.buckets.length;
    const hash = netfxStringHash64(key) & 0x7fffffff;
    const step = stepOf(hash, size);
    let index = hash % size;
    let tries = 0;
    let bucket: Bucket<V>;
    do {
      bucket = this.buckets[index] as Bucket<V>;
      if (bucket.hash === hash && bucket.key === key) {
        if (bucket.collision) bucket.key = DELETED;
        else {
          bucket.key = undefined;
          bucket.hash = 0;
        }
        bucket.value = undefined;
        this.liveCount -= 1;
        return;
      }
      index = (index + step) % size;
      tries += 1;
    } while (bucket.collision && tries < size);
  }

  /** The entries in enumeration order: the buckets from the last index down to the first. */
  *entries(): IterableIterator<[string, V]> {
    for (let index = this.buckets.length - 1; index >= 0; index -= 1) {
      const bucket = this.buckets[index] as Bucket<V>;
      if (typeof bucket.key === "string") yield [bucket.key, bucket.value as V];
    }
  }

  /** `table.Keys`, in enumeration order. */
  *keys(): IterableIterator<string> {
    for (const [key] of this.entries()) yield key;
  }

  /** `table.Values`, in enumeration order. */
  *values(): IterableIterator<V> {
    for (const [, value] of this.entries()) yield value;
  }

  private find(key: string): number {
    const size = this.buckets.length;
    const hash = netfxStringHash64(key) & 0x7fffffff;
    const step = stepOf(hash, size);
    let index = hash % size;
    let tries = 0;
    let bucket: Bucket<V>;
    do {
      bucket = this.buckets[index] as Bucket<V>;
      if (bucket.key === undefined) return -1;
      if (bucket.hash === hash && bucket.key === key) return index;
      index = (index + step) % size;
      tries += 1;
    } while (bucket.collision && tries < size);
    return -1;
  }

  private insert(key: string, value: V, add: boolean): void {
    if (this.liveCount >= this.loadSize) this.rebuild(getPrime(2 * this.buckets.length));
    else if (this.occupancy > this.loadSize && this.liveCount > 100) this.rebuild(this.buckets.length);

    const size = this.buckets.length;
    const hash = netfxStringHash64(key) & 0x7fffffff;
    const step = stepOf(hash, size);
    let index = hash % size;
    let firstDeleted = -1;
    let tries = 0;
    do {
      const bucket = this.buckets[index] as Bucket<V>;
      if (firstDeleted === -1 && bucket.key === DELETED && bucket.collision) firstDeleted = index;
      if (bucket.key === undefined || (bucket.key === DELETED && !bucket.collision)) {
        this.store(firstDeleted !== -1 ? firstDeleted : index, key, value, hash, tries);
        return;
      }
      if (bucket.hash === hash && bucket.key === key) {
        if (add) {
          throw new DuplicateKeyError(key);
        }
        bucket.value = value;
        return;
      }
      if (firstDeleted === -1 && !bucket.collision) {
        bucket.collision = true;
        this.occupancy += 1;
      }
      index = (index + step) % size;
      tries += 1;
    } while (tries < size);
    if (firstDeleted !== -1) {
      this.store(firstDeleted, key, value, hash, tries);
      return;
    }
    throw new Error("Hashtable insert failed. Load factor too high.");
  }

  private store(index: number, key: string, value: V, hash: number, tries: number): void {
    const bucket = this.buckets[index] as Bucket<V>;
    bucket.key = key;
    bucket.value = value;
    bucket.hash = hash;
    this.liveCount += 1;
    if (tries > COLLISION_LIMIT) throw new RandomizedHashingError(this.name, key);
  }

  /** Grows or rebuilds into `size` fresh buckets, taking the live entries in ascending order of their old bucket. */
  private rebuild(size: number): void {
    const fresh = emptyBuckets<V>(size);
    this.occupancy = 0;
    for (const old of this.buckets) {
      if (typeof old.key !== "string") continue;
      const step = stepOf(old.hash, size);
      let index = old.hash % size;
      for (;;) {
        const bucket = fresh[index] as Bucket<V>;
        if (bucket.key === undefined) {
          bucket.key = old.key;
          bucket.value = old.value;
          bucket.hash = old.hash;
          break;
        }
        if (!bucket.collision) {
          bucket.collision = true;
          this.occupancy += 1;
        }
        index = (index + step) % size;
      }
    }
    this.buckets = fresh;
    this.loadSize = loadSizeOf(size);
  }
}

/**
 * `Hashtable.Add` of a key that is present: `System.ArgumentException`. The text has two spaces before `Key being added`.
 * @spec MAN-016 MAN-017
 */
export class DuplicateKeyError extends Error {
  override name = "ArgumentException";

  constructor(readonly key: string) {
    super(`Item has already been added. Key in dictionary: '${key}'  Key being added: '${key}'`);
  }
}

/**
 * One insertion walked more than 100 occupied buckets, where .NET switches the table to a per-process randomized hash and
 * its order differs from run to run. The port cannot follow a random order and stops (bug MAN-018).
 * @spec MAN-018
 */
export class RandomizedHashingError extends Error {
  override name = "RandomizedHashingError";

  constructor(
    readonly table: string,
    readonly key: string,
  ) {
    super(
      `Inserting the key ${JSON.stringify(key)} into the ${table} walked more than ${COLLISION_LIMIT} occupied buckets. ` +
        "The .NET Framework switches such a table to randomized string hashing, so its enumeration order is not reproducible.",
    );
  }
}
