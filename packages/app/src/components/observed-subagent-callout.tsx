import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

interface ObservedSubagentCalloutProps {
  serverId: string;
  agentId: string;
}

/**
 * Read-only composer replacement for an observed subagent (Claude Task /
 * ultracode fan-out). The user can watch the conversation but cannot message it
 * or change its settings; the only live action is Stop while it is running.
 * See projects/observed-subagents/observed-subagents.md.
 */
export function ObservedSubagentCallout({ serverId, agentId }: ObservedSubagentCalloutProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const [isStopping, setIsStopping] = useState(false);
  const status = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId))?.status;
  });
  const isRunning = status === "running" || status === "initializing";

  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({ mode: "translate" });

  const containerStyle = useMemo(
    () => [styles.container, { paddingBottom: insets.bottom }, keyboardAnimatedStyle],
    [insets.bottom, keyboardAnimatedStyle],
  );

  const handleStop = useCallback(async () => {
    if (!client || !isConnected || isStopping) return;
    setIsStopping(true);
    try {
      await client.stopObservedSubagent(agentId);
    } catch {
      toast.error(t("observedSubagents.stopError"));
    } finally {
      setIsStopping(false);
    }
  }, [client, isConnected, isStopping, agentId, toast, t]);

  return (
    <Animated.View style={containerStyle}>
      <View style={styles.inputAreaContainer}>
        <ChatWidthBounds style={styles.inputAreaContent}>
          <View style={styles.callout}>
            <View style={styles.textColumn}>
              <Text style={styles.title}>{t("observedSubagents.readOnlyTitle")}</Text>
              <Text style={styles.subtitle}>{t("observedSubagents.readOnlySubtitle")}</Text>
            </View>
            {isRunning ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={handleStop}
                disabled={!isConnected || isStopping}
              >
                {t("observedSubagents.stopAction")}
              </Button>
            ) : null}
          </View>
        </ChatWidthBounds>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    padding: theme.spacing[4],
  },
  inputAreaContent: {
    width: "100%",
  },
  callout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    // Muted surface + no input affordance signals the read-only state.
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius["2xl"],
    opacity: 0.85,
    paddingVertical: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[6],
    },
  },
  textColumn: {
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
})) as unknown as Record<string, object>;
