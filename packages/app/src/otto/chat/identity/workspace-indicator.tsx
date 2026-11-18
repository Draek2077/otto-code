import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { ChatActivityRing } from "./activity-ring";
import { useIsCompactFormFactor } from "@/constants/layout";
import { workspaceActivityBlue } from "./palette";

/** The workspace's semantic dot stays visible while a different chat keeps working. */
export function WorkspaceActivityIndicator({
  bucket,
  hasActiveChat,
  loading,
  reserveIdleSpace,
}: {
  bucket: SidebarStateBucket;
  hasActiveChat: boolean;
  loading: boolean;
  reserveIdleSpace: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const geometry = useMemo(
    () => ({ width: compact ? 12 : 6, height: compact ? 12 : 6 }),
    [compact],
  );
  const dot = styles[bucket];
  if (hasActiveChat)
    return (
      <View
        style={styles.slot}
        testID={`workspace-status-indicator-${loading ? "loading" : "running"}`}
      >
        <ChatActivityRing centerStyle={dot} />
      </View>
    );
  if (bucket === "done" && !reserveIdleSpace && !loading) return null;
  return (
    <View style={styles.slot} testID={`workspace-status-indicator-${bucket}`}>
      <View style={[styles.dot, geometry, dot]} />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  slot: { width: theme.iconSize.md, height: 20, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: theme.borderRadius.full },
  needs_input: {
    backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
  },
  failed: { backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined },
  attention: { backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined },
  running: { backgroundColor: workspaceActivityBlue(theme.colorScheme === "dark") },
  done: { backgroundColor: theme.colors.foregroundExtraMuted, opacity: 0.5 },
}));
