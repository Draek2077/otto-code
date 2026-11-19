import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { z } from "zod";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { SuggestedTaskCardData } from "@getpaseo/plugin/otto/suggested-task";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { SelectField } from "@/components/ui/select-field";
import { queueComposerMessage } from "@/composer/actions";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";

import { useHostRuntimeClient } from "@/runtime/host-runtime";

const PLUGIN_ID = "otto-suggested-tasks";
const LAUNCH_MODES = {
  new_chat: "New chat",
  subagent: "Sub-agent",
  worktree: "Worktree",
  in_session: "In session",
} as const;
type LaunchMode = keyof typeof LAUNCH_MODES;
interface LaunchModel {
  provider: string;
  model: string;
}
const Availability = z.object({ pending: z.boolean() });

interface Actions {
  mode: LaunchMode;
  setMode: (value: LaunchMode) => void;
  busy: boolean;
  start: () => void;
  dismiss: () => void;
}

const MODES = ["new_chat", "subagent", "worktree", "in_session"] as const;
const MODE_OPTIONS = MODES.map((value) => ({ id: value, value, label: LAUNCH_MODES[value] }));
const MODE_DISPLAYS = Object.fromEntries(
  MODE_OPTIONS.map((option) => [option.value, { label: option.label }]),
);
const Destination = z.object({ agentId: z.string().min(1), workspaceId: z.string().min(1) });
const StartResult = z.discriminatedUnion("action", [
  Destination.extend({ action: z.literal("open") }),
  Destination.extend({ action: z.literal("queue"), text: z.string().min(1).max(32_000) }),
]);

function TaskActions({ mode, setMode, busy, start, dismiss }: Actions) {
  return (
    <View style={styles.controls}>
      <SelectField
        label="Suggested task destination"
        value={mode}
        selectedDisplay={MODE_DISPLAYS[mode]}
        options={MODE_OPTIONS}
        placeholder="Choose destination"
        emptyText="No destinations"
        onChange={setMode}
        disabled={busy}
      />
      <Button disabled={busy} onPress={start}>
        Start
      </Button>
      <Button variant="secondary" disabled={busy} onPress={dismiss}>
        Dismiss
      </Button>
    </View>
  );
}

function useStartResult(serverId: string, agentId: string, workspaceId: string) {
  return useCallback(
    (raw: unknown) => {
      const result = StartResult.parse(raw);
      if (result.action === "open") {
        navigateToAgent({ serverId, agentId: result.agentId, workspaceId: result.workspaceId });
        return;
      }
      if (result.agentId !== agentId || result.workspaceId !== workspaceId) {
        throw new Error("The suggestion no longer belongs to this chat.");
      }
      const queued = queueComposerMessage({
        agentId,
        text: result.text,
        attachments: [],
        queue: {
          read: (id) => useSessionStore.getState().sessions[serverId]?.queuedMessages.get(id) ?? [],
          write: (update) => useSessionStore.getState().setQueuedMessages(serverId, update),
        },
      });
      if (!queued.queued) throw new Error("Could not queue the suggestion.");
    },
    [serverId, agentId, workspaceId],
  );
}

function useSuggestion(props: PluginTimelineItemProps<SuggestedTaskCardData>) {
  const {
    agentId,
    host,
    item: { data },
  } = props;
  const client = useHostRuntimeClient(host.id);
  const applyStart = useStartResult(host.id, agentId, data.workspaceId);
  const request = useMemo(
    () => ({ agentId, workspaceId: data.workspaceId, taskId: data.id }),
    [agentId, data.id, data.workspaceId],
  );
  const [status, setStatus] = useState<
    "checking" | "pending" | "started" | "dismissed" | "unavailable"
  >("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [mode, setMode] = useState<LaunchMode>("new_chat");
  const [model, setModel] = useState<LaunchModel | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client
      .invokePluginRpc(PLUGIN_ID, "tasks.get", request)
      .then((result) => {
        if (!cancelled) setStatus(Availability.parse(result).pending ? "pending" : "unavailable");
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [client, request]);

  const act = useCallback(
    async (operation: "start" | "dismiss") => {
      if (!client || status !== "pending" || lock.current) return;
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        const result = await client.invokePluginRpc(
          PLUGIN_ID,
          `tasks.${operation}`,
          operation === "start" ? { ...request, mode, model: model ?? undefined } : request,
        );
        if (operation === "start") applyStart(result);
        setStatus(operation === "start" ? "started" : "dismissed");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not update this suggestion.");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [applyStart, client, mode, model, request, status],
  );

  const start = useCallback(() => void act("start"), [act]);
  const dismiss = useCallback(() => void act("dismiss"), [act]);
  return { status, error, busy, mode, setMode, model, setModel, start, dismiss };
}

const STATUS_TEXT = {
  checking: "Checking suggestion…",
  started: "Task started",
  dismissed: "Suggestion dismissed",
  unavailable: "This suggestion is no longer pending",
  pending: "",
};

function TaskModelPicker({
  host,
  model,
  onChange,
  disabled,
}: {
  host: string;
  model: LaunchModel | null;
  onChange: (selection: LaunchModel | null) => void;
  disabled: boolean;
}) {
  const connected = useHostRuntimeIsConnected(host);
  const { entries, isLoading, refetchIfStale } = useProvidersSnapshot(host);
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(entries, connected),
    [entries, connected],
  );
  const select = useCallback(
    (provider: string, id: string) => onChange({ provider, model: id }),
    [onChange],
  );
  const reset = useCallback(() => onChange(null), [onChange]);
  const open = useCallback(() => {
    refetchIfStale();
  }, [refetchIfStale]);
  return (
    <View style={styles.controls}>
      <CombinedModelSelector
        providers={providers}
        selectedProvider={model?.provider ?? ""}
        selectedModel={model?.model ?? ""}
        onSelect={select}
        isLoading={isLoading}
        onOpen={open}
        disabled={disabled}
        serverId={host}
        roleSelectionLabel={model ? undefined : "Use source chat model"}
      />
      {model ? (
        <Button variant="secondary" size="sm" onPress={reset} disabled={disabled}>
          Use source chat model
        </Button>
      ) : null}
    </View>
  );
}

export function SuggestedTaskCard(props: PluginTimelineItemProps<SuggestedTaskCardData>) {
  const state = useSuggestion(props);
  const { title, summary } = props.item.data;
  return (
    <View style={styles.card} testID="otto-suggested-task">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{summary}</Text>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.status === "pending" && state.mode !== "in_session" ? (
        <TaskModelPicker
          host={props.host.id}
          model={state.model}
          onChange={state.setModel}
          disabled={state.busy}
        />
      ) : null}
      {state.status === "pending" ? (
        <TaskActions {...state} />
      ) : (
        <Text style={styles.description}>{STATUS_TEXT[state.status]}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  title: { color: theme.colors.foreground, fontWeight: "600", fontSize: theme.fontSize.base },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
}));
