// TTL + single-flight read cache shared by hosting service implementations.
// Mirrors the discipline of github-service.ts's internal `cached()`: one
// in-flight request per key, results cached for a short TTL, forced reads
// require a reason (audit trail against accidental hot loops).

export interface HostingReadOptions {
  force?: boolean;
  reason?: string;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  cwd: string;
}

interface InFlightEntry {
  cwd: string;
  promise: Promise<unknown>;
  force: boolean;
}

export interface HostingRequestCache {
  cached<T>(params: {
    cwd: string;
    method: string;
    args: unknown;
    readOptions?: HostingReadOptions;
    load: () => Promise<T>;
  }): Promise<T>;
  invalidate(cwd: string): void;
  clear(): void;
}

export function createHostingRequestCache(options: {
  ttlMs: number;
  now?: () => number;
}): HostingRequestCache {
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightEntry>();

  function buildKey(params: { cwd: string; method: string; args: unknown }): string {
    return JSON.stringify({ cwd: params.cwd, method: params.method, args: params.args });
  }

  return {
    cached<T>(params: {
      cwd: string;
      method: string;
      args: unknown;
      readOptions?: HostingReadOptions;
      load: () => Promise<T>;
    }): Promise<T> {
      if (params.readOptions?.force && !params.readOptions.reason) {
        throw new Error("Forced git hosting read requires a reason");
      }

      const key = buildKey(params);
      const entry = cache.get(key);
      if (!params.readOptions?.force && entry && entry.expiresAt > now()) {
        return Promise.resolve(entry.value as T);
      }

      const existing = inFlight.get(key);
      if (existing && (!params.readOptions?.force || existing.force)) {
        return existing.promise as Promise<T>;
      }

      const request = params
        .load()
        .then((value) => {
          if (inFlight.get(key)?.promise === request) {
            cache.set(key, {
              value,
              cwd: params.cwd,
              expiresAt: now() + options.ttlMs,
            });
          }
          return value;
        })
        .finally(() => {
          if (inFlight.get(key)?.promise === request) {
            inFlight.delete(key);
          }
        });
      inFlight.set(key, {
        cwd: params.cwd,
        promise: request,
        force: params.readOptions?.force === true,
      });
      return request;
    },

    invalidate(cwd: string): void {
      for (const [key, entry] of cache.entries()) {
        if (entry.cwd === cwd) {
          cache.delete(key);
        }
      }
      for (const [key, entry] of inFlight.entries()) {
        if (entry.cwd === cwd) {
          inFlight.delete(key);
        }
      }
    },

    clear(): void {
      cache.clear();
      inFlight.clear();
    },
  };
}
