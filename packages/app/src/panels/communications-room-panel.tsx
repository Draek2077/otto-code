import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Chat } from "@/components/icons/material-icons";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { CommunicationsRoom } from "@/screens/workspace/communications-room";
import { compactFont } from "@/styles/theme";

function useCommunicationsRoomDescriptor(target: {
  kind: "communicationsRoom";
  providerId: string;
  conversationId: string;
  title?: string;
}): PanelDescriptor {
  const label = target.title?.trim() || "Chat room";
  return useMemo(
    () => ({
      label,
      tooltip: label,
      subtitle: target.providerId,
      titleState: "ready" as const,
      icon: Chat,
      statusBucket: null,
    }),
    [label, target.providerId],
  );
}

function CommunicationsRoomPanel(): ReactElement {
  const { serverId, target } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supportsCommunicationsRooms = useHostFeature(serverId, "communicationsRooms");
  const conversation = useMemo(
    () =>
      target.kind === "communicationsRoom"
        ? {
            providerId: target.providerId,
            conversationId: target.conversationId,
            kind: "unknown" as const,
            title: target.title?.trim() || "Chat room",
            preview: null,
            updatedAt: null,
            unreadCount: 0,
          }
        : null,
    [target],
  );
  if (target.kind !== "communicationsRoom") {
    throw new Error("CommunicationsRoomPanel requires a communications room target.");
  }
  if (!supportsCommunicationsRooms) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>Update the host to use this.</Text>
      </View>
    );
  }
  return (
    <CommunicationsRoom
      client={client}
      serverId={serverId}
      conversation={conversation!}
      isPaneFocused={isInteractive}
    />
  );
}

export const communicationsRoomPanelRegistration = definePanel("communicationsRoom", {
  component: CommunicationsRoomPanel,
  useDescriptor: useCommunicationsRoomDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    textAlign: "center",
  },
}));
