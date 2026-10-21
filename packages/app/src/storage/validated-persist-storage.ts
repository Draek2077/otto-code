import { z } from "zod";
import type { PersistStorage, StateStorage } from "zustand/middleware";
// OTTO(storage): keep old Otto fields on disk while validating the Paseo runtime shape.
import { parseOttoPersistedState, serializeOttoPersistedState } from "@/otto/persisted-state";
import { isProtectedOttoStorageKey } from "@/otto/storage-continuity";

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
    setItem: async (name, value) => {
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
    },
    removeItem: (name) => backingStorage.removeItem(name),
  };
}
