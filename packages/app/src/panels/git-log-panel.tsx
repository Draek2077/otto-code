import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import type { GitOperationLogEntry } from "@otto-code/protocol/messages";
import { SquareTerminal } from "@/components/icons/material-icons";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useAppSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { buildGitLogKey, useGitLogStore } from "@/git/log-store";

const EMPTY_ENTRIES: readonly GitOperationLogEntry[] = [];
const BOTTOM_PIN_THRESHOLD_PX = 40;

export function gitLogTabTitle(
  operation: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (operation === "commit") {
    return t("workspace.git.log.titleCommit");
  }
  if (operation === "pull") {
    return t("workspace.git.log.titlePull");
  }
  if (operation === "push") {
    return t("workspace.git.log.titlePush");
  }
  return t("workspace.git.log.titleGeneric", { operation });
}

function useGitLogPanelDescriptor(
  target: { kind: "gitLog"; operation: string },
  _context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: gitLogTabTitle(target.operation, t),
    subtitle: t("workspace.git.log.subtitle"),
    titleState: "ready",
    icon: SquareTerminal,
    statusBucket: null,
  };
}

function GitLogPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "gitLog", "GitLogPanel requires gitLog target");
  const operation = target.operation;
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const cwd = useWorkspaceDirectory(serverId, workspaceId);

  const entries = useGitLogStore((state) =>
    cwd
      ? (state.entriesByKey[buildGitLogKey({ serverId, cwd, operation })] ?? EMPTY_ENTRIES)
      : EMPTY_ENTRIES,
  );

  // Backfill the daemon's buffer once the pane knows its cwd; live appends
  // arrive through the session listener feeding the same store.
  useEffect(() => {
    if (!client || !cwd) {
      return;
    }
    let cancelled = false;
    const backfill = async () => {
      try {
        const payload = await client.checkoutGitGetOperationLog(cwd, operation);
        if (!cancelled) {
          useGitLogStore
            .getState()
            .mergeEntries({ serverId, cwd, operation, entries: payload.entries });
        }
      } catch {
        // Old daemons have no backfill RPC; the pane just starts empty.
      }
    };
    void backfill();
    return () => {
      cancelled = true;
    };
  }, [client, cwd, operation, serverId]);

  const scrollRef = useRef<ScrollView>(null);
  const pinnedToBottomRef = useRef(true);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    pinnedToBottomRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - BOTTOM_PIN_THRESHOLD_PX;
  }, []);
  const handleContentSizeChange = useCallback(() => {
    if (pinnedToBottomRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

  const monoFontFamily = settings.monoFontFamily.trim();
  const levelStyles = useMemo(() => {
    const lineTextStyle = {
      fontSize: settings.codeFontSize,
      lineHeight: Math.round(settings.codeFontSize * 1.5),
      ...(monoFontFamily ? { fontFamily: monoFontFamily } : null),
    };
    return {
      info: [styles.line, lineTextStyle, styles.lineInfo],
      output: [styles.line, lineTextStyle],
      error: [styles.line, lineTextStyle, styles.lineError],
    };
  }, [monoFontFamily, settings.codeFontSize]);

  if (entries.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t("workspace.git.log.empty")}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      onScroll={handleScroll}
      onContentSizeChange={handleContentSizeChange}
      scrollEventThrottle={64}
      dataSet={CODE_SURFACE_DATASET}
      testID="git-log-pane"
    >
      {entries.map((entry) => (
        <Text key={entry.seq} selectable style={levelStyles[entry.level]}>
          {entry.text}
        </Text>
      ))}
    </ScrollView>
  );
}

export const gitLogPanelRegistration: PanelRegistration<"gitLog"> = {
  kind: "gitLog",
  component: GitLogPanel,
  useDescriptor: useGitLogPanelDescriptor,
  confirmClose() {
    return Promise.resolve(true);
  },
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  line: {
    color: theme.colors.foreground,
  },
  lineInfo: {
    color: theme.colors.foregroundMuted,
  },
  lineError: {
    color: theme.colors.palette.red[300],
  },
}));
