import { z } from "zod";
import type { PersistStorage, StateStorage } from "zustand/middleware";
import {
  BrowserIndexStateSchema,
  normalizeBrowserIndexState,
  type BrowserIndexState,
} from "./state";

const envelopeSchema = z.object({
  state: z.unknown(),
  version: z.number().int().nonnegative().optional(),
});

/** Browser URLs must survive a malformed sibling record or older metadata. */
export function createBrowserPersistStorage(
  backing: StateStorage,
): PersistStorage<BrowserIndexState> {
  return {
    getItem: async (name) => {
      const raw = await backing.getItem(name);
      if (raw === null) return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        // Keep the original bytes available for recovery. Reading is never deletion.
        return null;
      }
      const envelope = envelopeSchema.safeParse(decoded);
      if (!envelope.success) return null;
      return { ...envelope.data, state: normalizeBrowserIndexState(envelope.data.state) };
    },
    setItem: async (name, value) => {
      // Reject an invalid write without erasing the previous saved addresses.
      const state = BrowserIndexStateSchema.parse(value.state);
      await backing.setItem(name, JSON.stringify({ ...value, state }));
    },
    removeItem: (name) => backing.removeItem(name),
  };
}
