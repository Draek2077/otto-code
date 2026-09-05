import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  buildSelectableProviderSelectorProviders,
  getAllProviderModelRows,
} from "@/provider-selection/provider-selection";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { CompactSuggestedTasksCard, type CompactSuggestedTasksCardProps } from "./compact-card";
import type { SuggestedTaskActions } from "./use-suggested-task-actions";

export function SuggestedTaskLaunchCard({
  serverId,
  parentAgentId,
  actions,
  ...cardProps
}: CompactSuggestedTasksCardProps & { serverId: string; parentAgentId: string }) {
  const parent = useSessionStore((state) => state.sessions[serverId]?.agents.get(parentAgentId));
  // COMPAT(suggestedTaskModelSelection): added in v0.9.0, remove after 2027-03-05 when the daemon floor supports it.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.suggestedTaskModelSelection === true,
  );
  const snapshot = useProvidersSnapshot(serverId, {
    cwd: cardProps.rows[0]?.cwd ?? parent?.cwd,
    enabled: supported,
  });
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const [selection, setSelection] = useState<{ provider: string; model: string } | null>(null);
  const provider = selection?.provider ?? parent?.provider ?? "";
  const model = selection?.model ?? parent?.model ?? "";
  const [starting, setStarting] = useState(false);
  const [launchError, setError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const canStartNewChat =
    supported &&
    getAllProviderModelRows(providers).some(
      (row) => row.provider === provider && row.modelId === model,
    );
  const selectModel = useCallback((nextProvider: string, nextModel: string) => {
    setSelection({ provider: nextProvider, model: nextModel });
    setError(null);
  }, []);
  const { refresh, refetchIfStale } = snapshot;
  const retryProvider = useCallback(
    (nextProvider: string) => {
      void refresh([nextProvider]).catch((error) => setError(toErrorMessage(error)));
    },
    [refresh],
  );
  const openPicker = useCallback(() => refetchIfStale(provider), [refetchIfStale, provider]);
  const startTasks = useCallback<SuggestedTaskActions["startTasks"]>(
    async (taskIds, mode) => {
      if (startingRef.current || (mode !== "in_session" && !canStartNewChat)) return false;
      startingRef.current = true;
      setStarting(true);
      setError(null);
      try {
        const succeeded = await actions.startTasks(
          taskIds,
          mode,
          mode === "in_session" ? undefined : { provider, model },
        );
        if (!succeeded)
          setError("Could not start every task. Pending tasks are still available to retry.");
        return succeeded;
      } catch (error) {
        setError(toErrorMessage(error));
        return false;
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [actions, canStartNewChat, provider, model],
  );
  const launchActions = useMemo(
    () => ({ ...actions, startTasks, starting, canStartNewChat }),
    [actions, startTasks, starting, canStartNewChat],
  );
  const modelControl = useMemo(
    () =>
      supported ? (
        <CombinedModelSelector
          triggerVariant="compact-filled"
          desktopMinWidth={360}
          providers={providers}
          selectedProvider={provider}
          selectedModel={model}
          onSelect={selectModel}
          isLoading={snapshot.isLoading}
          serverId={serverId}
          disabled={starting}
          onRetryProvider={retryProvider}
          isRetryingProvider={snapshot.isRefreshing}
          onOpen={openPicker}
        />
      ) : (
        <Text style={styles.hint}>Update the host to choose a model.</Text>
      ),
    [
      supported,
      providers,
      provider,
      model,
      selectModel,
      snapshot.isLoading,
      snapshot.isRefreshing,
      serverId,
      starting,
      retryProvider,
      openPicker,
    ],
  );
  return (
    <>
      <CompactSuggestedTasksCard
        {...cardProps}
        actions={launchActions}
        modelControl={modelControl}
      />
      {snapshot.error || launchError ? (
        <View style={styles.feedback}>
          <Text style={styles.error} accessibilityRole="alert">
            {launchError ?? snapshot.error}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  feedback: { padding: theme.spacing[2], backgroundColor: theme.colors.statusInfoSurface },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.xs },
}));
