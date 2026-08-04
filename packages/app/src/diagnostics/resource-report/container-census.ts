// A generic "how much is being retained" walker over client state.
//
// Hand-listing every counter would go stale the moment someone adds a store, and
// a leak hunt is precisely the case where the thing you forgot to count is the
// thing that leaked. So the census walks state structurally and emits one metric
// per container it finds, keyed by path.
//
// Two rules keep it cheap enough to run on a timer and stable enough to trend:
//
//  - **Dynamic keys collapse to `*` and sum.** A Map/Set always collapses (it is
//    a keyed container by definition); a plain object collapses only when its
//    path is listed in `collapseKeysAt`, because a struct's field names are the
//    useful part. Collapsing means `sessions.*.agents.size` is one metric across
//    every host, not one metric per host id - so paths stay comparable between
//    runs and the key space cannot grow with the data.
//  - **Arrays are leaves.** Emitting `.length` is the whole signal; descending
//    into elements would make the census O(timeline items) on every tick, which
//    would itself be a performance bug.

export interface ContainerCensusOptions {
  /** Path prefix for every emitted metric. */
  prefix: string;
  /** How deep to descend. Depth counts container hops, not object fields. */
  maxDepth?: number;
  /**
   * Plain-object paths (with `*` for already-collapsed segments) whose keys are
   * data rather than field names.
   */
  collapseKeysAt?: readonly string[];
  /** Stop recursing into a container this large; its size is still reported. */
  maxContainerScan?: number;
  /** Strings at least this long are reported as `${path}.chars`. */
  minReportedStringLength?: number;
}

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_CONTAINER_SCAN = 500;
const DEFAULT_MIN_REPORTED_STRING_LENGTH = 1024;

export function censusContainers(
  root: unknown,
  options: ContainerCensusOptions,
  into: Record<string, number> = {},
): Record<string, number> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxContainerScan = options.maxContainerScan ?? DEFAULT_MAX_CONTAINER_SCAN;
  const minStringLength = options.minReportedStringLength ?? DEFAULT_MIN_REPORTED_STRING_LENGTH;
  const collapseKeysAt = new Set(options.collapseKeysAt ?? []);
  const seen = new WeakSet<object>();

  function add(key: string, value: number): void {
    into[key] = (into[key] ?? 0) + value;
  }

  function walk(value: unknown, path: string, depth: number): void {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === "string") {
      if (value.length >= minStringLength) {
        add(`${path}.chars`, value.length);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    // Cyclic or shared references (a store value reachable by two paths) are
    // counted once; walking them twice would double the totals.
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      add(`${path}.length`, value.length);
      return;
    }

    if (value instanceof Map) {
      add(`${path}.size`, value.size);
      if (depth >= maxDepth || value.size > maxContainerScan) {
        return;
      }
      for (const entry of value.values()) {
        walk(entry, `${path}.*`, depth + 1);
      }
      return;
    }

    if (value instanceof Set) {
      add(`${path}.size`, value.size);
      return;
    }

    if (!isPlainObject(value)) {
      return;
    }

    const keys = Object.keys(value);
    if (collapseKeysAt.has(path)) {
      add(`${path}.keys`, keys.length);
      if (depth >= maxDepth || keys.length > maxContainerScan) {
        return;
      }
      for (const key of keys) {
        walk((value as Record<string, unknown>)[key], `${path}.*`, depth + 1);
      }
      return;
    }

    if (depth >= maxDepth) {
      return;
    }
    for (const key of keys) {
      walk((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
    }
  }

  walk(root, options.prefix, 0);
  return into;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
