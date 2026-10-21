import { z } from "zod";
import type { PersistStorage, StateStorage } from "zustand/middleware";
// OTTO(storage): keep old Otto fields on disk while validating the Paseo runtime shape.
import { parseOttoPersistedState, serializeOttoPersistedState } from "@/otto/persisted-state";
import { isProtectedOttoStorageKey } from "@/otto/storage-continuity";

// OTTO(storage): preservation reads make writes asynchronous even with a synchronous
// backing store. Share ordering across store instances so immediate rehydration sees
// the last queued write, and overlapping writes cannot overwrite dormant fields.
const pendingWrites = new WeakMap<StateStorage, Map<string, Promise<void>>>();

function writeInOrder(backing: StateStorage, name: string, write: () => Promise<void>) {
  if (!isProtectedOttoStorageKey(name)) return write();
  let writes = pendingWrites.get(backing);
  if (!writes) {
    writes = new Map();
    pendingWrites.set(backing, writes);
  }
  const operation = (writes.get(name) ?? Promise.resolve()).then(write, write);
  writes.set(name, operation);
  const clear = () => {
    if (writes.get(name) === operation) writes.delete(name);
  };
  void operation.then(clear, clear);
  return operation;
}

export function createValidatedPersistStorage<State>(
  backingStorage: StateStorage,
  stateSchema: z.ZodType<State>,
): PersistStorage<State> {
  const envelopeSchema = z.strictObject({
    state: stateSchema,
    version: z.number().int().nonnegative().optional(),
  });

  return {
    getItem: async (name) => {
      // OTTO(storage): another instance may still be preserving the previous value.
      await pendingWrites.get(backingStorage)?.get(name);
      const raw = await backingStorage.getItem(name);
      if (raw === null) return null;

      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        await backingStorage.removeItem(name);
        return null;
      }

      const result = parseOttoPersistedState(name, decoded, envelopeSchema);
      if (!result.success) {
        await backingStorage.removeItem(name);
        return null;
      }
      return result.data;
    },
    setItem: (name, value) =>
      writeInOrder(backingStorage, name, async () => {
        const result = envelopeSchema.safeParse(value);
        if (!result.success) {
          await backingStorage.removeItem(name);
          return;
        }
        await backingStorage.setItem(
          name,
          serializeOttoPersistedState(
            name,
            isProtectedOttoStorageKey(name) ? await backingStorage.getItem(name) : null,
            result.data,
            envelopeSchema,
          ),
        );
      }),
    removeItem: (name) =>
      writeInOrder(backingStorage, name, async () => {
        await backingStorage.removeItem(name);
      }),
  };
}
