import { useRef } from "react";
import { collectAllPanes, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { deriveWorkspacePaneState } from "./workspace-pane-state";

export function selectVisibleAgentIds(input: {
  layout: WorkspaceLayout | null;
  tabs: WorkspaceTab[];
  routeFocused: boolean;
  focusedPaneOnly: boolean;
}): string[] {
  if (!input.routeFocused || !input.layout) {
    return [];
  }
  const panes = input.focusedPaneOnly
    ? collectAllPanes(input.layout.root).filter((pane) => pane.id === input.layout?.focusedPaneId)
    : collectAllPanes(input.layout.root);

  return [
    ...new Set(
      panes.flatMap((pane) => {
        const target = deriveWorkspacePaneState({ pane, tabs: input.tabs }).activeTab?.descriptor
          .target;
        if (target?.kind === "agent") {
          return [target.agentId];
        }
        // A just-created Architectural View authoring chat is promoted to a
        // normal agent target on the next render. Claim its stream during that
        // one transition too, otherwise selective delivery drops its first
        // assistant events before the normal chat surface mounts.
        return target?.kind === "architecturalViewDraft" && target.authoringChatId
          ? [target.authoringChatId]
          : [];
      }),
    ),
  ].sort();
}

export function useVisibleAgentIds(input: {
  layout: WorkspaceLayout | null;
  tabs: WorkspaceTab[];
  routeFocused: boolean;
  focusedPaneOnly: boolean;
}): string[] {
  const nextAgentIds = selectVisibleAgentIds(input);
  const stableAgentIds = useRef<string[]>([]);
  if (
    stableAgentIds.current.length !== nextAgentIds.length ||
    stableAgentIds.current.some((agentId, index) => agentId !== nextAgentIds[index])
  ) {
    stableAgentIds.current = nextAgentIds;
  }
  return stableAgentIds.current;
}
