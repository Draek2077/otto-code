import { generateDraftId } from "@/stores/draft-keys";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import type { WorkspaceTabPlacement } from "@/stores/workspace-layout-actions";

export interface PrepareWorkspaceTabInput {
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  pin?: boolean;
  placement?: WorkspaceTabPlacement;
}

export type NavigateToPreparedWorkspaceTabInput = PrepareWorkspaceTabInput;

export interface PrepareWorkspaceTabDeps {
  openTab: (input: {
    workspaceKey: string;
    target: WorkspaceTabTarget;
    intent: "reveal";
    placement?: WorkspaceTabPlacement;
  }) => string | null;
  pinAgent: (workspaceKey: string, agentId: string) => void;
}

export interface NavigateToPreparedWorkspaceTabDeps extends PrepareWorkspaceTabDeps {
  navigateToWorkspace: (input: { serverId: string; workspaceId: string }) => unknown;
}

function getPreparedTarget(target: WorkspaceTabTarget): WorkspaceTabTarget {
  if (target.kind !== "draft" || target.draftId.trim() !== "new") {
    return target;
  }
  return { kind: "draft", draftId: generateDraftId() };
}

export function prepareWorkspaceTab(
  input: PrepareWorkspaceTabInput,
  deps: PrepareWorkspaceTabDeps,
): string {
  const target = getPreparedTarget(input.target);
  const key =
    buildWorkspaceTabPersistenceKey({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
    }) ?? "";

  deps.openTab({ workspaceKey: key, target, intent: "reveal", placement: input.placement });

  if (input.pin && target.kind === "agent") {
    deps.pinAgent(key, target.agentId);
  }

  return buildHostWorkspaceRoute(input.serverId, input.workspaceId);
}

export function navigateToPreparedWorkspaceTab(
  input: NavigateToPreparedWorkspaceTabInput,
  deps: NavigateToPreparedWorkspaceTabDeps,
): string {
  const route = prepareWorkspaceTab(input, deps);
  deps.navigateToWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId });
  return route;
}
