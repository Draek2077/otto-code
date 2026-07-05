import AsyncStorage from "@react-native-async-storage/async-storage";
import { BrowserAutomationBrowserIdSchema } from "@otto-code/protocol/browser-automation/rpc-schemas";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  applyBrowserPatch,
  type BrowserIndexState,
  type BrowserRecord,
  type BrowserRecordPatch,
  createBrowserRecord,
  normalizeBrowserUrl,
  rehydrateBrowserRecord,
  removeBrowserFromIndex,
  sanitizeBrowsersForPersist,
  trimNonEmpty,
} from "./state";

export type { BrowserRecord } from "./state";

interface BrowserStoreState extends BrowserIndexState {
  createBrowser: (input?: {
    initialUrl?: string;
    isPreview?: boolean;
    previewServerId?: string | null;
    previewServerName?: string | null;
    previewCwd?: string | null;
  }) => string;
  updateBrowser: (browserId: string, patch: BrowserRecordPatch) => void;
  removeBrowser: (browserId: string) => void;
}

function createBrowserId(): string {
  let browserId: string;
  if (typeof globalThis.crypto?.randomUUID === "function") {
    browserId = globalThis.crypto.randomUUID();
  } else {
    const randomSuffix = Math.random().toString(16).slice(2) || "0";
    browserId = `${Date.now()}-${randomSuffix}`;
  }
  return BrowserAutomationBrowserIdSchema.parse(browserId);
}

export const useBrowserStore = create<BrowserStoreState>()(
  persist(
    (set) => ({
      browsersById: {},
      createBrowser: (input) => {
        const browserId = createBrowserId();
        const record = createBrowserRecord({
          browserId,
          initialUrl: input?.initialUrl,
          now: Date.now(),
          isPreview: input?.isPreview,
          previewServerId: input?.previewServerId,
          previewServerName: input?.previewServerName,
          previewCwd: input?.previewCwd,
        });

        set((state) => ({
          browsersById: {
            ...state.browsersById,
            [browserId]: record,
          },
        }));

        return browserId;
      },
      updateBrowser: (browserId, patch) => {
        set((state) => applyBrowserPatch(state, browserId, patch));
      },
      removeBrowser: (browserId) => {
        set((state) => removeBrowserFromIndex(state, browserId));
      },
    }),
    {
      name: "workspace-browser-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => sanitizeBrowsersForPersist(state),
      merge: (persistedState, currentState) => {
        const persistedBrowsersById =
          (persistedState as Partial<BrowserIndexState> | undefined)?.browsersById ?? {};
        return {
          ...currentState,
          browsersById: Object.fromEntries(
            Object.entries(persistedBrowsersById).map(([browserId, raw]) => [
              browserId,
              rehydrateBrowserRecord(browserId, raw),
            ]),
          ),
        };
      },
    },
  ),
);

export function getBrowserRecord(browserId: string): BrowserRecord | null {
  const normalizedBrowserId = trimNonEmpty(browserId);
  if (!normalizedBrowserId) {
    return null;
  }
  return useBrowserStore.getState().browsersById[normalizedBrowserId] ?? null;
}

export function createWorkspaceBrowser(input?: {
  initialUrl?: string;
  isPreview?: boolean;
  previewServerId?: string | null;
  previewServerName?: string | null;
  previewCwd?: string | null;
}): {
  browserId: string;
  url: string;
} {
  const browserId = useBrowserStore.getState().createBrowser(input);
  const record = getBrowserRecord(browserId);
  return {
    browserId,
    url: record?.url ?? normalizeBrowserUrl(input?.initialUrl),
  };
}

export function normalizeWorkspaceBrowserUrl(value: string | null | undefined): string {
  return normalizeBrowserUrl(value);
}
