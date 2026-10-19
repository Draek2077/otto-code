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
import { useProviderSubagentControl } from "@/subagents/use-provider-subagent-control";
import { providerSubagentKey, useProviderSubagentStore } from "@/subagents/provider-store";

interface ObservedSubagentCalloutProps {
  serverId: string;
  agentId: string;
}

/**
 * Read-only composer replacement for an observed subagent (Claude Task /
 * ultracode fan-out). The user can watch the conversation but cannot message it
 * or change its settings; the only live action is Stop while it is running.
 * See .otto/knowledge/projects/observed-subagents.md.
 */
export function ObservedSubagentCallout({ serverId, agentId }: ObservedSubagentCalloutProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const [isStopping, setIsStopping] = useState(false);
  const status = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId))?.status;
  });
  const isRunning = status === "running" || status === "initializing";
  const parentLabel = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    const parent = agent?.parentAgentId
      ? (session?.agents.get(agent.parentAgentId) ?? session?.agentDetails.get(agent.parentAgentId))
      : null;
    return parent?.title ?? agent?.parentAgentId;
  });

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
    <ObservedSubagentCalloutView
      parentLabel={parentLabel}
      canStop={isRunning}
      disabled={!isConnected || isStopping}
      onStop={handleStop}
    />
  );
}

/** Provider descriptor ids must use provider control, never stopObservedSubagent. */
export function ProviderSubagentCallout({
  serverId,
  parentAgentId,
  subagentId,
}: {
  serverId: string;
  parentAgentId: string;
  subagentId: string;
}) {
  const control = useProviderSubagentControl(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const [isStopping, setIsStopping] = useState(false);
  const descriptor = useProviderSubagentStore((state) =>
    state.descriptors.get(providerSubagentKey(serverId, parentAgentId, subagentId)),
  );
  const parentLabel = useSessionStore(
    (state) =>
      (
        state.sessions[serverId]?.agents.get(parentAgentId) ??
        state.sessions[serverId]?.agentDetails.get(parentAgentId)
      )?.title ?? parentAgentId,
  );
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagentControl === true,
  );
  const handleStop = useCallback(async () => {
    if (isStopping || !isConnected || !supported) return;
    setIsStopping(true);
    try {
      await control(parentAgentId, subagentId, "stop");
    } finally {
      setIsStopping(false);
    }
  }, [control, parentAgentId, subagentId, isStopping, isConnected, supported]);
  return (
    <ObservedSubagentCalloutView
      parentLabel={parentLabel}
      canStop={supported && descriptor?.status === "running"}
      disabled={!isConnected || isStopping}
      onStop={handleStop}
    />
  );
}

export function ObservedSubagentCalloutView({
  parentLabel,
  canStop,
  disabled,
  onStop,
}: {
  parentLabel?: string | null;
  canStop: boolean;
  disabled: boolean;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({ mode: "translate" });
  const containerStyle = useMemo(
    () => [styles.container, { paddingBottom: insets.bottom }, keyboardAnimatedStyle],
    [insets.bottom, keyboardAnimatedStyle],
  );

  return (
    <Animated.View style={containerStyle} testID="observed-subagent-callout">
      <View style={styles.inputAreaContainer}>
        <ChatWidthBounds style={styles.inputAreaContent}>
          <View style={styles.callout}>
            <View style={styles.textColumn}>
              <Text style={styles.title}>{t("observedSubagents.readOnlyTitle")}</Text>
              <Text style={styles.subtitle}>{t("observedSubagents.readOnlySubtitle")}</Text>
              {parentLabel ? (
                <Text style={styles.subtitle}>
                  {t("observedSubagents.parentOwnership", { parent: parentLabel })}
                </Text>
              ) : null}
            </View>
            {canStop ? (
              <Button size="sm" variant="secondary" onPress={onStop} disabled={disabled}>
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
    fontWeight: theme.fontWeight.normal,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
})) as unknown as Record<string, object>;
