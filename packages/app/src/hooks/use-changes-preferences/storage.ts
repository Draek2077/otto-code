import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CHANGES_TOOLBAR_ITEM_IDS,
  DEFAULT_PINNED_CHANGES_TOOLBAR_ITEMS,
  type ChangesToolbarItemId,
} from "@/git/changes-toolbar/items";
import {
  CONVENTIONAL_COMMIT_TYPES,
  NO_COMMIT_TYPE,
  type CommitTypeChoice,
} from "@/git/conventional-commit";
import { readValidatedJson, readValidatedString } from "@/storage/validated-storage";

export const CHANGES_PREFERENCES_STORAGE_KEY = "@otto:changes-preferences";
export const LEGACY_WRAP_LINES_STORAGE_KEY = "diff-wrap-lines";
export const CHANGES_PREFERENCES_QUERY_KEY = ["changes-preferences"];

const COMMIT_TYPE_VALUES = [NO_COMMIT_TYPE, ...CONVENTIONAL_COMMIT_TYPES] as [
  CommitTypeChoice,
  ...CommitTypeChoice[],
];

const changesPreferencesSchema = z.strictObject({
  presentation: z.enum(["line", "structural"]).optional(),
  layout: z.enum(["unified", "split"]).optional(),
  desktopTreeVisible: z.boolean().optional(),
  // Read the former overloaded preference once so existing installations keep their desktop tree.
  viewMode: z.enum(["flat", "tree"]).optional(),
  wrapLines: z.boolean().optional(),
  hideWhitespace: z.boolean().optional(),
  pinnedToolbarItems: z.array(z.enum(CHANGES_TOOLBAR_ITEM_IDS)).optional(),
  inlineDiff: z.boolean().optional(),
  commitsCollapsed: z.boolean().optional(),
  commitType: z.enum(COMMIT_TYPE_VALUES).optional(),
});

export interface ChangesPreferences {
  /** Persisted default. Per-review selection remains local to its surface. */
  presentation: "line" | "structural";
  layout: "unified" | "split";
  desktopTreeVisible: boolean;
  wrapLines: boolean;
  hideWhitespace: boolean;
  pinnedToolbarItems: ChangesToolbarItemId[];
  inlineDiff: boolean;
  commitsCollapsed: boolean;
  /**
   * Conventional Commits type the commit form prefixes the message with
   * (`fix: …`). "none" commits the message as-is.
   */
  commitType: CommitTypeChoice;
}

export const DEFAULT_CHANGES_PREFERENCES: ChangesPreferences = {
  presentation: "line",
  layout: "unified",
  desktopTreeVisible: false,
  wrapLines: false,
  hideWhitespace: false,
  pinnedToolbarItems: DEFAULT_PINNED_CHANGES_TOOLBAR_ITEMS,
  inlineDiff: false,
  commitsCollapsed: true,
  commitType: NO_COMMIT_TYPE,
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

async function loadLegacyWrapLinesPreference(storage: KeyValueStorage): Promise<boolean | null> {
  const legacyValue = await readValidatedString(
    storage,
    LEGACY_WRAP_LINES_STORAGE_KEY,
    z.enum(["true", "false"]),
  );
  return legacyValue === null ? null : legacyValue === "true";
}

export async function loadChangesPreferencesFromStorage(
  storage: KeyValueStorage,
): Promise<ChangesPreferences> {
  const stored = await readValidatedJson(
    storage,
    CHANGES_PREFERENCES_STORAGE_KEY,
    changesPreferencesSchema,
  );
  if (stored) {
    const { viewMode, ...currentPreferences } = stored;
    return {
      ...DEFAULT_CHANGES_PREFERENCES,
      ...currentPreferences,
      desktopTreeVisible: stored.desktopTreeVisible ?? viewMode === "tree",
    };
  }

  const legacyWrapLines = await loadLegacyWrapLinesPreference(storage);
  const next = {
    ...DEFAULT_CHANGES_PREFERENCES,
    ...(legacyWrapLines !== null ? { wrapLines: legacyWrapLines } : {}),
  } satisfies ChangesPreferences;
  await storage.setItem(CHANGES_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function saveChangesPreferences(input: {
  queryClient: QueryClient;
  updates: Partial<ChangesPreferences>;
  storage: KeyValueStorage;
}): Promise<void> {
  const prev =
    input.queryClient.getQueryData<ChangesPreferences>(CHANGES_PREFERENCES_QUERY_KEY) ??
    DEFAULT_CHANGES_PREFERENCES;
  const next = { ...prev, ...input.updates };
  input.queryClient.setQueryData<ChangesPreferences>(CHANGES_PREFERENCES_QUERY_KEY, next);
  await input.storage.setItem(CHANGES_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
}
