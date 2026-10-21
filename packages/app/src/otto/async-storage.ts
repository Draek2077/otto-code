// Otto 0.9 kept its app state (paired hosts, settings, drafts, preferences)
// under Otto-named storage keys: `@otto:...`, `@otto/...`, `otto-drafts`. Paseo
// code uses the same keys with Paseo names. Metro resolves
// `@react-native-async-storage/async-storage` to this module (see
// metro.config.cjs), which stores every Paseo-named key under its Otto name, so
// existing Otto data is read where it already is and Paseo call sites stay
// untouched.

import BaseAsyncStorage, {
  useAsyncStorage as baseUseAsyncStorage,
  type AsyncStorageStatic,
} from "@react-native-async-storage/async-storage";

export type { AsyncStorageStatic };

export function toOttoStorageKey(key: string): string {
  return key.replace(/^@paseo(?=[:/])/, "@otto").replace(/^paseo-/, "otto-");
}

export function fromOttoStorageKey(key: string): string {
  return key.replace(/^@otto(?=[:/])/, "@paseo").replace(/^otto-/, "paseo-");
}

type KeyValuePair = [string, string | null];

function toOttoPairs(pairs: readonly (readonly [string, string])[]): [string, string][] {
  return pairs.map(([key, value]) => [toOttoStorageKey(key), value]);
}

function fromOttoPairs(pairs: readonly KeyValuePair[]): KeyValuePair[] {
  return pairs.map(([key, value]) => [fromOttoStorageKey(key), value]);
}

const OttoAsyncStorage: AsyncStorageStatic = {
  getItem: (key, callback) => BaseAsyncStorage.getItem(toOttoStorageKey(key), callback),
  setItem: (key, value, callback) =>
    BaseAsyncStorage.setItem(toOttoStorageKey(key), value, callback),
  removeItem: (key, callback) => BaseAsyncStorage.removeItem(toOttoStorageKey(key), callback),
  mergeItem: (key, value, callback) =>
    BaseAsyncStorage.mergeItem(toOttoStorageKey(key), value, callback),
  clear: (callback) => BaseAsyncStorage.clear(callback),
  getAllKeys: async (callback) => {
    const keys = (await BaseAsyncStorage.getAllKeys()).map(fromOttoStorageKey);
    callback?.(null, keys);
    return keys;
  },
  flushGetRequests: () => BaseAsyncStorage.flushGetRequests(),
  multiGet: async (keys, callback) => {
    const pairs = fromOttoPairs(await BaseAsyncStorage.multiGet(keys.map(toOttoStorageKey)));
    callback?.(null, pairs);
    return pairs;
  },
  multiSet: (pairs, callback) => BaseAsyncStorage.multiSet(toOttoPairs(pairs), callback),
  multiRemove: (keys, callback) =>
    BaseAsyncStorage.multiRemove(keys.map(toOttoStorageKey), callback),
  multiMerge: (pairs, callback) => BaseAsyncStorage.multiMerge(toOttoPairs(pairs), callback),
};

export function useAsyncStorage(key: string): ReturnType<typeof baseUseAsyncStorage> {
  return baseUseAsyncStorage(toOttoStorageKey(key));
}

export default OttoAsyncStorage;
