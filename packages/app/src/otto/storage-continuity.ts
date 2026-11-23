import type { AsyncStorageStatic } from "@react-native-async-storage/async-storage";

// COMPAT(otto09AppState): added in v0.10.0; review after 2027-04-21, retain
// recovery copies until the corresponding Otto features have been rebuilt.
export const OTTO_APP_RECOVERY_PREFIX = "@otto:pre-0.10/";
const PROTECTED_KEYS = new Set([
  "@otto:settings",
  "@otto:app-settings",
  "otto-drafts",
  "@otto:review-draft-store",
  "workspace-browser-store",
  "workspace-layout-state",
  "panel-state",
  "sidebar-view",
  "sidebar-project-workspace-order",
  "sidebar-collapsed-sections",
]);
export function isProtectedOttoStorageKey(key: string): boolean {
  return PROTECTED_KEYS.has(
    key.replace(/^@paseo(?=[:/])/, "@otto").replace(/^paseo(?=[:-])/, "otto"),
  );
}

export async function readOttoSettingsRecovery(storage: {
  getItem(key: string): Promise<string | null>;
}): Promise<Record<string, unknown> | null> {
  for (const key of ["@otto:app-settings", "@otto:settings"]) {
    const raw = await storage.getItem(`${OTTO_APP_RECOVERY_PREFIX}${encodeURIComponent(key)}`);
    if (raw === null) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      /* An invalid original is retained for recovery, not used as preferences. */
    }
  }
  return null;
}
/** Keep original settings before Paseo validators or migrations can rewrite them.
 * Recovery keys never participate in app hydration. Explicit clear still clears all
 * storage. Credentials and host-registry keys are deliberately outside this set. */
export function createOttoStorageContinuity(backing: AsyncStorageStatic): AsyncStorageStatic {
  const pending = new Map<string, Promise<void>>();
  const remembered = new Set<string>();
  async function remember(key: string, raw: string | null): Promise<void> {
    if (raw === null || !PROTECTED_KEYS.has(key) || remembered.has(key)) return;
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const backupKey = `${OTTO_APP_RECOVERY_PREFIX}${encodeURIComponent(key)}`;
      if ((await backing.getItem(backupKey)) === null) await backing.setItem(backupKey, raw);
      remembered.add(key);
    })();
    pending.set(key, operation);
    try {
      await operation;
    } finally {
      if (pending.get(key) === operation) pending.delete(key);
    }
  }
  async function read(key: string): Promise<string | null> {
    const raw = await backing.getItem(key);
    await remember(key, raw);
    return raw;
  }
  async function write(key: string, value: string): Promise<void> {
    const raw = PROTECTED_KEYS.has(key) ? await backing.getItem(key) : null;
    await remember(key, raw);
    await backing.setItem(key, value);
  }
  async function remove(key: string): Promise<void> {
    if (PROTECTED_KEYS.has(key)) await remember(key, await backing.getItem(key));
    await backing.removeItem(key);
  }
  function failure(error: unknown): Error {
    return error instanceof Error ? error : new Error("Could not preserve Otto app state");
  }
  return {
    ...backing,
    async clear(callback) {
      await backing.clear(callback);
      remembered.clear();
    },
    async getItem(key, callback) {
      try {
        const value = await read(key);
        callback?.(null, value);
        return value;
      } catch (error) {
        callback?.(failure(error), null);
        throw error;
      }
    },
    async setItem(key, value, callback) {
      try {
        await write(key, value);
        callback?.(null);
      } catch (error) {
        callback?.(failure(error));
        throw error;
      }
    },
    async removeItem(key, callback) {
      try {
        await remove(key);
        callback?.(null);
      } catch (error) {
        callback?.(failure(error));
        throw error;
      }
    },
    async multiGet(keys, callback) {
      try {
        const pairs = await Promise.all(
          keys.map(async (key): Promise<[string, string | null]> => [key, await read(key)]),
        );
        callback?.(null, pairs);
        return pairs;
      } catch (error) {
        callback?.([failure(error)], []);
        throw error;
      }
    },
    async multiSet(pairs, callback) {
      try {
        await Promise.all(pairs.map(([key, value]) => write(key, value)));
        callback?.(null);
      } catch (error) {
        callback?.([failure(error)]);
        throw error;
      }
    },
    async multiRemove(keys, callback) {
      try {
        await Promise.all(keys.map(remove));
        callback?.(null);
      } catch (error) {
        callback?.([failure(error)]);
        throw error;
      }
    },
    async mergeItem(key, value, callback) {
      if (PROTECTED_KEYS.has(key)) await remember(key, await backing.getItem(key));
      return backing.mergeItem(key, value, callback);
    },
    async multiMerge(pairs, callback) {
      await Promise.all(
        pairs.map(async ([key]) => {
          if (PROTECTED_KEYS.has(key)) await remember(key, await backing.getItem(key));
        }),
      );
      return backing.multiMerge(pairs, callback);
    },
    async getAllKeys(callback) {
      try {
        const keys = (await backing.getAllKeys()).filter(
          (key) => !key.startsWith(OTTO_APP_RECOVERY_PREFIX),
        );
        callback?.(null, keys);
        return keys;
      } catch (error) {
        callback?.(failure(error), []);
        throw error;
      }
    },
  };
}
