import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { useFetchQuery } from "@/data/query";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { GitBranch } from "@/components/icons/material-icons";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { shortenPath } from "@/utils/shorten-path";
import type {
  WorktreeReattachCandidate,
  WorktreeReattachTarget,
} from "@otto-code/protocol/messages";

export interface ReopenWorktreeSheetProps {
  visible: boolean;
  onClose: () => void;
  serverId: string;
  projectId: string;
  projectCwd?: string | null;
  onWorkspacePress?: () => void;
}

export interface ReopenWorktreeControl {
  // Undefined when the host lacks the capability or the project has no worktree
  // target, so callers can omit the menu entry entirely.
  onReopenWorktree: (() => void) | undefined;
  // Render this element somewhere in the row; it is null when inactive.
  reopenWorktreeSheet: ReactElement | null;
}

// Encapsulates the reopen-worktree gate, sheet visibility, and sheet element so a
// host row can wire "Reopen worktree" with two values and no local branching.
export function useReopenWorktreeControl(input: {
  serverId: string | undefined;
  projectId: string;
  projectCwd?: string | null;
  onWorkspacePress?: () => void;
}): ReopenWorktreeControl {
  const enabled = useHostFeature(input.serverId, "worktreeReattach");
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const active = enabled && Boolean(input.serverId);
  const serverId = input.serverId;
  return {
    onReopenWorktree: active ? handleOpen : undefined,
    reopenWorktreeSheet:
      active && serverId ? (
        <ReopenWorktreeSheet
          visible={open}
          onClose={handleClose}
          serverId={serverId}
          projectId={input.projectId}
          projectCwd={input.projectCwd}
          onWorkspacePress={input.onWorkspacePress}
        />
      ) : null,
  };
}

function candidateTarget(candidate: WorktreeReattachCandidate): WorktreeReattachTarget {
  if (candidate.workspaceId) {
    return { kind: "workspace", workspaceId: candidate.workspaceId };
  }
  return { kind: "orphan", worktreePath: candidate.worktreePath };
}

function candidateKey(candidate: WorktreeReattachCandidate): string {
  return candidate.workspaceId ?? `orphan:${candidate.worktreePath}`;
}

export function ReopenWorktreeSheet({
  visible,
  onClose,
  serverId,
  projectId,
  projectCwd,
  onWorkspacePress,
}: ReopenWorktreeSheetProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const query = useFetchQuery({
    queryKey: ["worktree-reattach-list", serverId, projectId],
    enabled: visible,
    dataShape: "list",
    staleTimeMs: 0,
    queryFn: async () => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      const payload = await client.listReattachableWorktrees({
        projectId,
        ...(projectCwd ? { cwd: projectCwd } : {}),
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.candidates;
    },
  });

  const reattachMutation = useMutation({
    mutationFn: async (candidate: WorktreeReattachCandidate) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      const payload = await client.reattachWorktree(candidateTarget(candidate));
      if (payload.error || !payload.workspace) {
        throw new Error(payload.error ?? t("sidebar.workspace.reopenWorktree.failed"));
      }
      return normalizeWorkspaceDescriptor(payload.workspace);
    },
    onSuccess: (workspace) => {
      useSessionStore.getState().mergeWorkspaces(serverId, [workspace]);
      onClose();
      onWorkspacePress?.();
      navigateToWorkspace(serverId, workspace.id);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.reopenWorktree.failed"),
      );
    },
  });

  const handleSelect = useCallback(
    (candidate: WorktreeReattachCandidate) => {
      if (reattachMutation.isPending) {
        return;
      }
      reattachMutation.mutate(candidate);
    },
    [reattachMutation],
  );

  const header = useMemo<SheetHeader>(
    () => ({ title: t("sidebar.workspace.reopenWorktree.title") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="reopen-worktree-sheet"
    >
      <View style={styles.body}>
        <ReopenWorktreeBody
          query={query}
          disabled={reattachMutation.isPending}
          onSelect={handleSelect}
        />
      </View>
    </AdaptiveModalSheet>
  );
}

function ReopenWorktreeBody({
  query,
  disabled,
  onSelect,
}: {
  query: UseQueryResult<WorktreeReattachCandidate[], Error>;
  disabled: boolean;
  onSelect: (candidate: WorktreeReattachCandidate) => void;
}) {
  const { t } = useTranslation();
  if (query.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }
  if (query.isError) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : t("sidebar.workspace.reopenWorktree.failed");
    return <Text style={styles.errorText}>{message}</Text>;
  }
  const candidates = query.data ?? [];
  if (candidates.length === 0) {
    return <Text style={styles.emptyText}>{t("sidebar.workspace.reopenWorktree.empty")}</Text>;
  }
  return (
    <>
      {candidates.map((candidate) => (
        <CandidateRow
          key={candidateKey(candidate)}
          candidate={candidate}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function CandidateRow({
  candidate,
  disabled,
  onSelect,
}: {
  candidate: WorktreeReattachCandidate;
  disabled: boolean;
  onSelect: (candidate: WorktreeReattachCandidate) => void;
}) {
  const { t } = useTranslation();
  const title =
    candidate.branchName ?? candidate.displayName ?? shortenPath(candidate.worktreePath);
  const subtitleParts: string[] = [];
  if (candidate.baseBranch) {
    subtitleParts.push(
      t("sidebar.workspace.reopenWorktree.offBase", { base: candidate.baseBranch }),
    );
  }
  if (!candidate.workspaceId) {
    subtitleParts.push(t("sidebar.workspace.reopenWorktree.orphan"));
  } else if (!candidate.directoryOnDisk) {
    subtitleParts.push(t("sidebar.workspace.reopenWorktree.willRecreate"));
  }
  const subtitle = subtitleParts.join(" · ");

  const handlePress = useCallback(() => onSelect(candidate), [candidate, onSelect]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (pressed || Boolean(hovered)) && styles.rowActive,
      disabled && styles.rowDisabled,
    ],
    [disabled],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      testID={`reopen-worktree-candidate-${candidateKey(candidate)}`}
    >
      <GitBranch size={16} color="#9ca3af" />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    minHeight: 80,
  },
  centered: {
    paddingVertical: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  rowActive: {
    backgroundColor: theme.colors.surface1,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  rowSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 1,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[4],
    textAlign: "center",
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[4],
    textAlign: "center",
  },
}));
