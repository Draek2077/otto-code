import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * Which Scripts this user runs, and which source groups they keep open.
 *
 * Client-side on purpose. These are **preferences, not project facts**: they
 * describe one person's habits at one workstation, they must not be written
 * into the repo the way an `otto.json` Script is, and on a shared daemon they
 * would otherwise blend several people's histories into one misleading order.
 * Keeping them here also means recency needs no wire field and no daemon
 * capability, so it works against any daemon that can list Scripts at all.
 */

/** Entries kept per workspace, so a long-lived install cannot grow unbounded. */
const MAX_RECENT_ENTRIES_PER_WORKSPACE = 50;

export interface ScriptMenuPreferencesState {
  /** workspace key -> scriptName -> epoch ms of the last run started here. */
  lastRunAtByWorkspace: Record<string, Record<string, number>>;
  /** workspace key -> group key -> explicitly expanded. Absent = the default. */
  groupExpansionByWorkspace: Record<string, Record<string, boolean>>;
  recordScriptRun: (input: { workspaceKey: string; scriptName: string; runAt: number }) => void;
  setGroupExpanded: (input: { workspaceKey: string; groupKey: string; expanded: boolean }) => void;
}

export function buildScriptMenuWorkspaceKey(serverId: string, workspaceId: string): string {
  return `${serverId}::${workspaceId}`;
}

/** Drop the oldest entries once a workspace exceeds the cap. */
function trimRecent(entries: Record<string, number>): Record<string, number> {
  const names = Object.keys(entries);
  if (names.length <= MAX_RECENT_ENTRIES_PER_WORKSPACE) {
    return entries;
  }
  const kept = names
    .sort((left, right) => (entries[right] ?? 0) - (entries[left] ?? 0))
    .slice(0, MAX_RECENT_ENTRIES_PER_WORKSPACE);
  const result: Record<string, number> = {};
  for (const name of kept) {
    const runAt = entries[name];
    if (runAt !== undefined) {
      result[name] = runAt;
    }
  }
  return result;
}

function sanitizeNestedRecord<T>(
  value: unknown,
  key: string,
  isValid: (candidate: unknown) => candidate is T,
): Record<string, Record<string, T>> {
  if (!value || typeof value !== "object") return {};
  const outer = (value as Record<string, unknown>)[key];
  if (!outer || typeof outer !== "object") return {};

  const result: Record<string, Record<string, T>> = {};
  for (const [workspaceKey, inner] of Object.entries(outer)) {
    if (!inner || typeof inner !== "object") continue;
    const entries: Record<string, T> = {};
    for (const [name, candidate] of Object.entries(inner as Record<string, unknown>)) {
      if (isValid(candidate)) entries[name] = candidate;
    }
    if (Object.keys(entries).length > 0) result[workspaceKey] = entries;
  }
  return result;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function createScriptMenuPreferencesStore(storage: StateStorage) {
  return create<ScriptMenuPreferencesState>()(
    persist(
      (set) => ({
        lastRunAtByWorkspace: {},
        groupExpansionByWorkspace: {},
        recordScriptRun: ({ workspaceKey, scriptName, runAt }) =>
          set((state) => ({
            lastRunAtByWorkspace: {
              ...state.lastRunAtByWorkspace,
              [workspaceKey]: trimRecent({
                ...state.lastRunAtByWorkspace[workspaceKey],
                [scriptName]: runAt,
              }),
            },
          })),
        setGroupExpanded: ({ workspaceKey, groupKey, expanded }) =>
          set((state) => ({
            groupExpansionByWorkspace: {
              ...state.groupExpansionByWorkspace,
              [workspaceKey]: {
                ...state.groupExpansionByWorkspace[workspaceKey],
                [groupKey]: expanded,
              },
            },
          })),
      }),
      {
        name: "workspace-script-menu-preferences",
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({
          lastRunAtByWorkspace: state.lastRunAtByWorkspace,
          groupExpansionByWorkspace: state.groupExpansionByWorkspace,
        }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          lastRunAtByWorkspace: sanitizeNestedRecord(
            persistedState,
            "lastRunAtByWorkspace",
            isFiniteNumber,
          ),
          groupExpansionByWorkspace: sanitizeNestedRecord(
            persistedState,
            "groupExpansionByWorkspace",
            isBoolean,
          ),
        }),
      },
    ),
  );
}

export const useScriptMenuPreferencesStore = createScriptMenuPreferencesStore(AsyncStorage);
