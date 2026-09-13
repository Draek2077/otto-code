import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { History } from "@/components/icons/material-icons";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useCheckoutCommitsQuery } from "./use-commits-query";
import { useGitActionRunner } from "./use-actions";
import type { GitAction, GitActions } from "./policy";

const BACKUPS_HEADER = { title: "Backups" };
const HISTORY_STATE_LABELS = {
  unsupported: "Update the host to view version history.",
  error: "Could not load version history.",
  connecting: "Connect to the host to view version history.",
  idle: "Loading version history…",
  loading: "Loading version history…",
};

function BackupActionButton({ action }: { action: GitAction }) {
  const run = useGitActionRunner();
  const handlePress = useCallback(() => run(action), [action, run]);
  const labels = { idle: action.label, pending: action.pendingLabel, success: action.successLabel };
  return (
    <View style={styles.action}>
      <Button
        testID={`backup-${action.id}`}
        size="sm"
        variant="outline"
        disabled={action.disabled}
        loading={action.status === "pending"}
        onPress={handlePress}
      >
        {labels[action.status]}
      </Button>
      <Text style={styles.detail}>{action.unavailableMessage ?? action.description}</Text>
    </View>
  );
}

function BackupHistory({ serverId, cwd }: { serverId: string; cwd: string }) {
  const query = useCheckoutCommitsQuery({ serverId, cwd });
  if (query.status !== "loaded") {
    const message = HISTORY_STATE_LABELS[query.status];
    return <Text style={styles.detail}>{message}</Text>;
  }
  return (
    <View style={styles.history}>
      <Text style={styles.detail}>Up to 10 recent saved versions</Text>
      {query.data.commits.length === 0 ? (
        <Text style={styles.detail}>No saved versions yet.</Text>
      ) : null}
      {query.data.commits.slice(0, 10).map((version) => (
        <View key={version.sha} style={styles.version}>
          <Text selectable style={styles.title}>
            {version.subject}
          </Text>
          <Text style={styles.detail}>
            {new Date(version.authorDate).toLocaleString()} · {version.authorName} ·{" "}
            {version.isOnRemote ? "Uploaded" : "Local only"}
          </Text>
          {version.files.map((file) => (
            <Text selectable key={file.path} style={styles.detail}>
              {file.path}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function WorkspaceBackups({
  serverId,
  cwd,
  gitActions,
  workspaceMessage,
  hideLabels,
  fill,
  onAvailabilityChange,
}: {
  serverId: string;
  cwd: string;
  gitActions: GitActions;
  workspaceMessage: string | null;
  hideLabels?: boolean;
  fill?: boolean;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => onAvailabilityChange?.(true), [onAvailabilityChange]);
  return (
    <>
      <Button
        testID="workspace-backups"
        size="sm"
        variant="outline"
        leftIcon={History}
        accessibilityLabel="Backups"
        onPress={show}
        style={fill ? styles.fill : undefined}
      >
        {hideLabels ? null : "Backups"}
      </Button>
      <AdaptiveModalSheet
        visible={open}
        onClose={close}
        header={BACKUPS_HEADER}
        testID="workspace-backups-sheet"
      >
        {open ? (
          <View style={styles.content}>
            {workspaceMessage ? <Text style={styles.detail}>{workspaceMessage}</Text> : null}
            {gitActions.primary ? <BackupActionButton action={gitActions.primary} /> : null}
            {gitActions.secondary.map((action) => (
              <BackupActionButton key={action.id} action={action} />
            ))}
            {gitActions.primary ? (
              <>
                <Text style={styles.title}>Version history</Text>
                <BackupHistory serverId={serverId} cwd={cwd} />
              </>
            ) : null}
          </View>
        ) : null}
      </AdaptiveModalSheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  content: { gap: theme.spacing[4] },
  action: { gap: theme.spacing[1], alignItems: "flex-start" },
  history: { gap: theme.spacing[2] },
  version: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  title: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  detail: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
