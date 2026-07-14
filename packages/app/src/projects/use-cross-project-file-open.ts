import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { useEditorPrefsStore } from "@/editor/editor-prefs-store";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";
import type { WorkspaceFileLocation, WorkspaceFileOrigin } from "@/workspace/file-open";
import { useProjectLinkSet } from "@/projects/project-links";
import {
  resolveCrossProjectFileOpen,
  type CrossProjectWorkspace,
} from "@/projects/cross-project-open";

export type CrossProjectResolvedOpen =
  | { open: true; location: WorkspaceFileLocation; origin?: WorkspaceFileOrigin }
  | { open: false };

export type CrossProjectFileOpenGate = (
  location: WorkspaceFileLocation,
) => Promise<CrossProjectResolvedOpen>;

/**
 * Resolves how a file reference should open under gated-multi-root, driving the
 * link gate, the suppressible warning dialog, and the blocked-open toast. The
 * caller receives an origin (when the file belongs to a linked project) to pass
 * into `createWorkspaceFileTabTarget`, or `{ open: false }` when the open was
 * blocked or cancelled.
 */
export function useCrossProjectFileOpenGate(
  serverId: string,
  currentProjectId: string | null,
): CrossProjectFileOpenGate {
  const { t } = useTranslation();
  const toast = useToast();
  const workspacesMap = useSessionStore((state) => state.sessions[serverId]?.workspaces ?? null);
  const { linkSet } = useProjectLinkSet(serverId);

  const workspaces = useMemo<CrossProjectWorkspace[]>(() => {
    if (!workspacesMap) {
      return [];
    }
    const result: CrossProjectWorkspace[] = [];
    for (const descriptor of workspacesMap.values()) {
      if (!descriptor.workspaceDirectory) {
        continue;
      }
      result.push({
        workspaceId: descriptor.id,
        projectId: descriptor.projectId,
        cwd: descriptor.workspaceDirectory,
        projectName: descriptor.projectCustomName ?? descriptor.projectDisplayName,
      });
    }
    return result;
  }, [workspacesMap]);

  return useCallback(
    async (location: WorkspaceFileLocation): Promise<CrossProjectResolvedOpen> => {
      if (!currentProjectId) {
        return { open: true, location };
      }
      const decision = resolveCrossProjectFileOpen({
        location,
        currentProjectId,
        workspaces,
        linkSet,
      });
      if (decision.kind === "in-project") {
        return { open: true, location };
      }
      if (decision.kind === "blocked") {
        toast.error(t("editor.outOfProject.blocked", { project: decision.projectName }));
        return { open: false };
      }
      // Linked project: prompt once (suppressible) before opening in place.
      if (!useEditorPrefsStore.getState().suppressOutOfProjectWarning) {
        const { confirmed, checkboxChecked } = await confirmDialogWithCheckbox({
          title: t("editor.outOfProject.warnTitle"),
          message: t("editor.outOfProject.warnMessage", {
            project: decision.origin.projectName ?? decision.origin.projectId,
          }),
          confirmLabel: t("editor.outOfProject.warnConfirm"),
          cancelLabel: t("editor.cancel"),
          checkboxLabel: t("editor.outOfProject.warnSuppress"),
        });
        if (!confirmed) {
          return { open: false };
        }
        if (checkboxChecked) {
          useEditorPrefsStore.getState().setSuppressOutOfProjectWarning(true);
        }
      }
      return { open: true, location: decision.location, origin: decision.origin };
    },
    [currentProjectId, workspaces, linkSet, toast, t],
  );
}
