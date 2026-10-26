import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { readContextReport, type ContextReport } from "@getpaseo/plugin/otto/context-management";
import { ComposerTrackPill, type ComposerTrackPillSegment } from "@/composer/tracks";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useFetchQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useShallow } from "zustand/shallow";
import { createPluginNavigation } from "@/plugins/navigation";
import {
  contextHealthWarning,
  contextModelWindow,
  type ContextHealthWarning,
} from "./health-model";
import { contextHealthPreferences } from "./health-preferences";

function useHealthReport(
  serverId: string,
  workspaceId: string,
  agentId: string,
  active: boolean,
  window: number | null,
) {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const scope = useMemo(
    () => ({
      hostId: serverId,
      workspaceId,
      agentId,
      windowTokens: window === null ? 200000 : Math.max(1024, Math.min(10000000, window)),
    }),
    [serverId, workspaceId, agentId, window],
  );
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoContextReport", scope],
    enabled: active && Boolean(client),
    retry: false,
    refetchInterval: active ? 10000 : false,
    queryFn: async () => {
      if (!client) throw new Error("Host unavailable");
      const reply = readContextReport.output.parse(
        await client.invokePluginRpc("otto-project-knowledge", readContextReport.name, scope),
      );
      if (!reply.ok) throw new Error(reply.error.message);
      return reply.value;
    },
  });
}
function useKnownModelWindow(serverId: string, agentId: string, active: boolean) {
  const identity = useSessionStore(
    useShallow((state) => {
      const agent =
        state.sessions[serverId]?.agentDetails.get(agentId) ??
        state.sessions[serverId]?.agents.get(agentId);
      return {
        window: agent?.lastUsage?.contextWindowMaxTokens ?? null,
        model: agent?.model ?? null,
        provider: agent?.provider ?? null,
      };
    }),
  );
  const observed = contextModelWindow(identity.window, null);
  const { entries } = useProvidersSnapshot(serverId, {
    enabled: active && observed === null,
  });
  const catalog = entries
    ?.find((entry) => entry.provider === identity.provider)
    ?.models?.find((model) => model.id === identity.model)?.contextWindowMaxTokens;
  return contextModelWindow(observed, catalog);
}
export function useComposerContextHealth(serverId: string, workspaceId: string, agentId: string) {
  // COMPAT(ottoContextHealth): added v0.10.0; remove after 2027-04-26 when host floor >= v0.10.0.
  const supported = useHostFeature(serverId, "ottoContextManagement");
  const connected = useHostRuntimeIsConnected(serverId);
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  const [preferences] = useState(contextHealthPreferences);
  const preference = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
    preferences.getSnapshot,
  );
  // A fallback scan window is only a server assessment parameter. The warning's
  // percentage below is computed only from a real provider-reported window.
  const active =
    supported &&
    connected &&
    retained &&
    visible &&
    preference.loaded &&
    preference.writable &&
    preference.enabled;
  const knownWindow = useKnownModelWindow(serverId, agentId, active);
  useEffect(() => {
    if (supported && retained && visible) void preferences.load();
  }, [supported, retained, visible, preferences]);
  const report = useHealthReport(serverId, workspaceId, agentId, active, knownWindow);
  const currentReport =
    report.data?.agentId === agentId && report.data.workspaceId === workspaceId
      ? report.data
      : undefined;
  const warning = useMemo(
    () => contextHealthWarning(currentReport, knownWindow),
    [currentReport, knownWindow],
  );
  const [now, setNow] = useState(Date.now);
  // Both local mute revision and clock are explicit memo inputs. React Compiler
  // cannot infer a private registry mutation or Date.now() hidden inside a method.
  const mutedUntil = useMemo(
    () =>
      warning
        ? preferences.mutedUntil(serverId, workspaceId, warning, now, preference.revision)
        : null,
    [preferences, serverId, workspaceId, warning, preference.revision, now],
  );
  useEffect(() => {
    if (!active || mutedUntil === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, mutedUntil - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [active, mutedUntil]);
  return {
    warning: active && !report.error && !mutedUntil ? warning : null,
    report: currentReport,
  };
}
export function ContextHealthPill({
  serverId,
  workspaceId,
  warning,
  report,
}: {
  serverId: string;
  workspaceId: string;
  warning: ContextHealthWarning;
  report: ContextReport | undefined;
}) {
  const [preferences] = useState(contextHealthPreferences);
  const manage = useCallback(
    () =>
      createPluginNavigation({ serverId, workspaceId }).openWorkspacePanel(
        "otto-project-knowledge",
        "context-management",
        "workspace",
      ),
    [serverId, workspaceId],
  );
  const dismiss = useCallback(
    () => preferences.mute(serverId, workspaceId, warning),
    [preferences, serverId, workspaceId, warning],
  );
  const segments = useMemo<ComposerTrackPillSegment[]>(
    () => [{ bucket: warning.severity === "blocked" ? "failed" : "needs_input", text: "Context" }],
    [warning.severity],
  );
  return (
    <ComposerTrackPill
      testID="composer-context-health"
      panelTitle="Context health"
      accessibilityLabel={warning.summary}
      segments={segments}
    >
      <Text style={styles.summary} testID="composer-context-health-summary">
        {warning.summary}
      </Text>
      {report?.categories.some((category) => category.visibility === "not_visible") ? (
        <Text style={styles.summary}>
          Some provider-owned input is not visible. This estimate is a lower bound.
        </Text>
      ) : null}
      <DropdownMenuItem onSelect={manage} testID="composer-context-health-manage">
        Manage context
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={dismiss} testID="composer-context-health-dismiss">
        Mute this warning for eight hours
      </DropdownMenuItem>
    </ComposerTrackPill>
  );
}
const styles = StyleSheet.create((theme) => ({
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
}));
