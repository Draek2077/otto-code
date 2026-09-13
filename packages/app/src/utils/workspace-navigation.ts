import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  prepareWorkspaceTab as prepareWorkspaceTabPure,
  navigateToPreparedWorkspaceTab as navigateToPreparedWorkspaceTabPure,
  type PrepareWorkspaceTabInput,
  type NavigateToPreparedWorkspaceTabInput,
} from "./prepare-workspace-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type {
  PrepareWorkspaceTabInput,
  NavigateToPreparedWorkspaceTabInput,
} from "./prepare-workspace-tab";

function layoutStoreDeps() {
  const store = useWorkspaceLayoutStore.getState();
  return {
    openTab: (input: {
      workspaceKey: string;
      target: WorkspaceTabTarget;
      intent: "reveal";
      pin?: boolean;
      placement?: import("@/stores/workspace-layout-actions").WorkspaceTabPlacement;
    }) => store.openTab(input),
  };
}

export function prepareWorkspaceTab(input: PrepareWorkspaceTabInput): string {
  return prepareWorkspaceTabPure(input, layoutStoreDeps());
}

export function navigateToPreparedWorkspaceTab(input: NavigateToPreparedWorkspaceTabInput): string {
  return navigateToPreparedWorkspaceTabPure(input, {
    ...layoutStoreDeps(),
    navigateToWorkspace,
  });
}
