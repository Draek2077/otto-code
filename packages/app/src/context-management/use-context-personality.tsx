import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ContextPersonalitySelector } from "./personality-selector";
import {
  usePersonalityMemory,
  usePersonalityMemoryCounts,
  usePersonalityMemoryEnabled,
  usePersonalityRoster,
  type PersonalityMemoryResult,
} from "./use-personality-memory";

export interface ContextPersonalityMemory {
  /** null = "Everyone": the personality-agnostic report this tab used to be. */
  selectedProfileId: string | null;
  /** The "viewing context for" selector, or null on a host with no memory. */
  slot: ReactNode;
  /** Lessons the selection holds. null hides the Memory segment entirely. */
  lessonCount: number | null;
  memory: PersonalityMemoryResult;
}

/**
 * Everything the Context Management panel needs to be personality-aware, in one
 * hook. Bundled rather than inlined because that panel already carries a
 * three-pane layout, a splitter, a finding-reveal flow and a file pane; a fifth
 * concern in its body is exactly how a component stops being readable.
 *
 * `onTabChange` is a parameter rather than a returned intent because choosing a
 * personality IS a request to see what it carries: the sidebar moves to Memory,
 * and choosing "Everyone" moves back to the graph rather than leaving you parked
 * on a tab that now has nothing in it.
 */
export function useContextPersonalityMemory(params: {
  serverId: string;
  workspaceId: string | null;
  onTabChange: (tab: "context" | "memory") => void;
}): ContextPersonalityMemory {
  const { serverId, workspaceId, onTabChange } = params;
  const [selectedProfileId, setSelectedPersonalityId] = useState<string | null>(null);
  const enabled = usePersonalityMemoryEnabled(serverId);
  const roster = usePersonalityRoster(serverId);
  const counts = usePersonalityMemoryCounts(serverId, enabled);
  const memory = usePersonalityMemory(serverId, selectedProfileId, workspaceId);

  const handleSelect = useCallback(
    (personalityId: string | null) => {
      setSelectedPersonalityId(personalityId);
      onTabChange(personalityId ? "memory" : "context");
    },
    [onTabChange],
  );

  const slot = useMemo(
    () =>
      enabled ? (
        <ContextPersonalitySelector
          personalities={roster}
          selectedId={selectedProfileId}
          memoryCounts={counts}
          onSelect={handleSelect}
        />
      ) : null,
    [counts, enabled, handleSelect, roster, selectedProfileId],
  );

  // A host that can store lessons but has no personality picked keeps the
  // segment present and empty - that is how you find out the feature exists.
  const lessonCount = enabled ? (memory.view?.entries.length ?? 0) : null;

  return useMemo(
    () => ({ selectedProfileId, slot, lessonCount, memory }),
    [selectedProfileId, slot, lessonCount, memory],
  );
}
