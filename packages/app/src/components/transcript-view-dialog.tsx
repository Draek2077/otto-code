import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AgentStreamView } from "@/agent-stream/view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToastViewport, useToastHost } from "@/components/toast-host";
import {
  buildChatAgentFromState,
  selectChatAgentState,
  storeFetchedAgentDetail,
} from "@/panels/agent-panel";
import {
  createSetAgentInitializing,
  ensureAgentIsInitialized,
} from "@/hooks/use-agent-initialization";
import { useSessionStore } from "@/stores/session-store";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// The read-only viewer never surfaces a permission prompt (the generation
// agent is closed), so a single shared empty Map satisfies AgentStreamView's
// required prop without re-allocating per render.
const EMPTY_PENDING_PERMISSIONS: Map<string, PendingPermission> = new Map();
const EMPTY_STREAM_ITEMS: StreamItem[] = [];

export interface TranscriptViewDialogProps {
  /** The transcript to view; the dialog is hidden while this is null. */
  target: { serverId: string; agentId: string; title: string } | null;
  onClose: () => void;
}

/**
 * Read-only view of a closed generation agent's chat transcript, reachable from
 * the Artifacts and Schedules kebab menus. Reuses the live chat renderer
 * (AgentStreamView) with no composer and an empty permissions map, so the
 * dialog can only ever read the transcript — never steer it.
 *
 * The generation agent is terminal, so a single fetch of the record plus one
 * timeline sync is enough; there is no live stream to keep frozen while hidden
 * (the dialog is only mounted while visible).
 */
export function TranscriptViewDialog({ target, onClose }: TranscriptViewDialogProps): ReactElement {
  const header = useMemo<SheetHeader>(() => ({ title: target?.title?.trim() || "Chat" }), [target]);
  return (
    <AdaptiveModalSheet
      header={header}
      visible={target !== null}
      onClose={onClose}
      scrollable={false}
      desktopMaxWidth={860}
      desktopHeight={720}
      testID="transcript-view-dialog"
    >
      {target ? (
        <TranscriptViewDialogContent
          key={`${target.serverId}:${target.agentId}`}
          serverId={target.serverId}
          agentId={target.agentId}
        />
      ) : null}
    </AdaptiveModalSheet>
  );
}

type LoadState = "loading" | "ready" | "not_found" | "error";

function TranscriptViewDialogContent({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const setInitializingAgents = useSessionStore((state) => state.setInitializingAgents);
  const setAgentInitializing = useMemo(
    () => createSetAgentInitializing(serverId, setInitializingAgents),
    [serverId, setInitializingAgents],
  );

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const agentState = useSessionStore(
    useShallow((state) => selectChatAgentState(state, serverId, agentId)),
  );
  const projectPlacement = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const session = state.sessions[serverId];
      return (
        session?.agents?.get(agentId)?.projectPlacement ??
        session?.agentDetails?.get(agentId)?.projectPlacement ??
        null
      );
    },
    (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  );
  const agent = useMemo(
    () => buildChatAgentFromState(agentState, projectPlacement),
    [agentState, projectPlacement],
  );

  const streamItems = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamTail?.get(agentId) ?? EMPTY_STREAM_ITEMS,
  );
  const hasAppliedAuthoritativeHistory = useSessionStore(
    (state) => state.sessions[serverId]?.agentAuthoritativeHistoryApplied?.get(agentId) === true,
  );

  const { api: toast, toast: toastState, dismiss } = useToastHost();

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setErrorMessage(null);

    if (!client) {
      setLoadState("error");
      setErrorMessage("Host disconnected.");
      return;
    }

    void (async () => {
      try {
        const result = await client.fetchAgent({ agentId });
        if (cancelled) {
          return;
        }
        if (!result) {
          setLoadState("not_found");
          return;
        }
        storeFetchedAgentDetail({ serverId, result });
        // Pull the transcript into agentStreamTail. Tolerate a rejection (e.g. a
        // sync timeout) — the record is already stored, so we still render what
        // arrived rather than dead-ending the viewer.
        try {
          await ensureAgentIsInitialized({ serverId, agentId, client, setAgentInitializing });
        } catch {
          // ignore — render whatever timeline made it into the store
        }
        if (cancelled) {
          return;
        }
        setLoadState("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadState("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, serverId, agentId, setAgentInitializing]);

  if (loadState === "not_found") {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>This chat is no longer available.</Text>
      </View>
    );
  }

  if (loadState === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorMessage ?? "Unable to load the chat."}</Text>
      </View>
    );
  }

  if (!agent) {
    return (
      <View style={styles.centered}>
        <ThemedLoadingSpinner uniProps={mutedColorMapping} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AgentStreamView
        agentId={agent.id}
        serverId={serverId}
        agent={agent}
        streamItems={streamItems}
        pendingPermissions={EMPTY_PENDING_PERMISSIONS}
        isAuthoritativeHistoryReady={hasAppliedAuthoritativeHistory}
        toast={toast}
      />
      <ToastViewport toast={toastState} onDismiss={dismiss} placement="panel" />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  message: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.palette.red[500],
  },
}));
