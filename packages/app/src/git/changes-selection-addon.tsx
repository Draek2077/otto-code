import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, type GestureResponderEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, Undo2 } from "@/components/icons/material-icons";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CheckoutGitRollbackFailedError, useCheckoutGitActionsStore } from "@/git/actions-store";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useToast } from "@/contexts/toast-context";
import { resolveRunningAgentLabels } from "@/git/running-agent-labels";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import type { Theme } from "@/styles/theme";

const EMPTY_DESELECTED_PATHS: ReadonlySet<string> = new Set<string>();
const ThemedCheck = withUnistyles(Check);
const ThemedUndo = withUnistyles(Undo2);
const destructiveIconColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const accentForegroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});

export interface ChangesSelectionAddon {
  enabled: boolean;
  selectedPaths: string[];
  renderSelectionControl: (path: string) => ReactNode;
  bulkRollbackMenuItem: ReactNode;
}

/**
 * Otto-owned selection and bulk rollback layer for Paseo's Changes headers.
 * Paseo retains row layout, opening, and per-file actions; this layer merely
 * supplies an additive leading control and a second destructive menu action.
 */
export function useChangesSelectionAddon({
  serverId,
  cwd,
  files,
  enabled,
}: {
  serverId: string;
  cwd: string;
  files: ParsedDiffFile[];
  enabled: boolean;
}): ChangesSelectionAddon {
  const { t } = useTranslation();
  const toast = useToast();
  const rollbackPaths = useCheckoutGitActionsStore((state) => state.rollbackPaths);
  const agentsById = useSessionStore((state) => state.sessions[serverId]?.agents);
  const [deselectedPaths, setDeselectedPaths] =
    useState<ReadonlySet<string>>(EMPTY_DESELECTED_PATHS);
  const selectedPaths = useMemo(
    () =>
      enabled
        ? files.filter((file) => !deselectedPaths.has(file.path)).map((file) => file.path)
        : [],
    [deselectedPaths, enabled, files],
  );
  const togglePath = useCallback((path: string) => {
    setDeselectedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const runBulkRollback = useCallback(async () => {
    const count = selectedPaths.length;
    if (count < 2) return;
    const confirmed = await confirmDialog({
      title: t("workspace.git.rollback.confirmTitleMultiple", { count }),
      message: t("workspace.git.rollback.confirmMessageMultiple", { count }),
      confirmLabel: t("workspace.git.rollback.confirmButton"),
      destructive: true,
    });
    if (!confirmed) return;
    const attempt = async (allowWithRunningAgents: boolean): Promise<void> => {
      try {
        await rollbackPaths({
          serverId,
          cwd,
          paths: selectedPaths,
          ...(allowWithRunningAgents ? { allowWithRunningAgents: true } : {}),
        });
      } catch (error) {
        if (
          error instanceof CheckoutGitRollbackFailedError &&
          error.rollbackError.kind === "agents_running"
        ) {
          const agents = resolveRunningAgentLabels(
            error.rollbackError.agents,
            agentsById,
            t("workspace.git.rollback.unnamedAgent"),
          );
          const overrideConfirmed = await confirmDialog({
            title: t("workspace.git.rollback.agentsRunningTitle"),
            message: t("workspace.git.rollback.agentsRunningMessage", { agents }),
            confirmLabel: t("workspace.git.rollback.agentsRunningConfirm"),
            destructive: true,
          });
          if (overrideConfirmed) await attempt(true);
          return;
        }
        let message = t("workspace.git.rollback.failed");
        if (
          error instanceof CheckoutGitRollbackFailedError &&
          error.rollbackError.kind === "git_failed"
        ) {
          message = error.rollbackError.detail;
        } else if (error instanceof Error) {
          message = error.message;
        }
        toast.error(message);
      }
    };
    await attempt(false);
  }, [agentsById, cwd, rollbackPaths, selectedPaths, serverId, t, toast]);
  const renderSelectionControl = useCallback(
    (path: string) => (
      <ChangesSelectionControl
        selected={selectedPaths.includes(path)}
        path={path}
        togglePath={togglePath}
        label={t("workspace.git.commit.includeFile", { fileName: path.split("/").pop() ?? path })}
      />
    ),
    [selectedPaths, t, togglePath],
  );
  const bulkRollbackMenuItem =
    enabled && selectedPaths.length > 1 ? (
      <BulkRollbackMenuItem count={selectedPaths.length} onRollback={runBulkRollback} />
    ) : null;
  return { enabled, selectedPaths, renderSelectionControl, bulkRollbackMenuItem };
}

function ChangesSelectionControl({
  selected,
  path,
  togglePath,
  label,
}: {
  selected: boolean;
  path: string;
  togglePath: (path: string) => void;
  label: string;
}) {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      togglePath(path);
    },
    [path, togglePath],
  );
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      style={selected ? styles.checkboxSelected : styles.checkbox}
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
      testID={`changes-selection-${path}`}
      hitSlop={6}
    >
      {selected ? <ThemedCheck size="xs" uniProps={accentForegroundIconColorMapping} /> : null}
    </Pressable>
  );
}

function BulkRollbackMenuItem({
  count,
  onRollback,
}: {
  count: number;
  onRollback: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => void onRollback(), [onRollback]);
  const leading = useMemo(
    () => <ThemedUndo size="sm" uniProps={destructiveIconColorMapping} />,
    [],
  );
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        leading={leading}
        onSelect={handleSelect}
        destructive
        testID="changes-context-menu-rollback-selected"
      >
        {t("workspace.git.rollback.filesAction", { count })}
      </ContextMenuItem>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkboxSelected: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
}));
