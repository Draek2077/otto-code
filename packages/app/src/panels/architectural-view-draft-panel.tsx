import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Architecture } from "@/components/icons/material-icons";
import { ArchitecturalViewHtml } from "@/components/architectural-views/architectural-view-html";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

type ArchitecturalViewDraftTarget = Extract<WorkspaceTabTarget, { kind: "architecturalViewDraft" }>;

function useArchitecturalViewDraftPanelDescriptor(
  target: ArchitecturalViewDraftTarget,
): PanelDescriptor {
  return {
    label: `Draft: ${target.viewId}`,
    tooltip: `Architectural View draft for ${target.viewId}`,
    subtitle: "Staged Architectural View",
    titleState: "ready",
    icon: Architecture,
    statusBucket: null,
  };
}

function ArchitecturalViewDraftPanel() {
  const { serverId, workspaceId, target, closeCurrentTab, openTab } = usePaneContext();
  invariant(
    target.kind === "architecturalViewDraft",
    "ArchitecturalViewDraftPanel requires architecturalViewDraft target",
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.architecturalViews === true,
  );
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [action, setAction] = useState<"publish" | "discard" | null>(null);
  const [authoringAgentId, setAuthoringAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !supported) {
      setHtml(null);
      setError("Update the host to use Architectural Views.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .getArchitecturalViewDraftContent({
        workspaceId,
        viewId: target.viewId,
        draftId: target.draftId,
      })
      .then((result) => {
        if (cancelled) return undefined;
        if (!result.success || !result.html) {
          throw new Error(result.error ?? "Could not open Architectural View draft.");
        }
        setHtml(result.html);
        setAuthoringAgentId(result.draft?.authoringAgentId ?? null);
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setHtml(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, supported, target.draftId, target.viewId, workspaceId]);

  const publish = useCallback(async () => {
    if (!client || action) return;
    setAction("publish");
    setActionError(null);
    try {
      const result = await client.publishArchitecturalViewDraft({
        workspaceId,
        viewId: target.viewId,
        draftId: target.draftId,
      });
      if (!result.success)
        throw new Error(result.error ?? "Could not publish Architectural View draft.");
      closeCurrentTab();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAction(null);
    }
  }, [action, client, closeCurrentTab, target.draftId, target.viewId, workspaceId]);

  const discard = useCallback(async () => {
    if (!client || action) return;
    const confirmed = await confirmDialog({
      title: "Discard Architectural View draft?",
      message:
        "This permanently removes the staged draft. The current published view is unchanged.",
      confirmLabel: "Discard draft",
      destructive: true,
    });
    if (!confirmed) return;
    setAction("discard");
    setActionError(null);
    try {
      const result = await client.discardArchitecturalViewDraft({
        workspaceId,
        viewId: target.viewId,
        draftId: target.draftId,
      });
      if (!result.success)
        throw new Error(result.error ?? "Could not discard Architectural View draft.");
      closeCurrentTab();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAction(null);
    }
  }, [action, client, closeCurrentTab, target.draftId, target.viewId, workspaceId]);

  const openAuthoringChat = useCallback(() => {
    if (authoringAgentId) {
      openTab({ kind: "agent", agentId: authoringAgentId });
      return;
    }
    openTab({
      kind: "draft",
      draftId: `architectural-view-${target.viewId}-${target.draftId}`,
      architecturalViewDraft: { viewId: target.viewId, draftId: target.draftId },
    });
  }, [authoringAgentId, openTab, target.draftId, target.viewId]);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text numberOfLines={1} style={styles.title}>
          Staged draft
        </Text>
        <View style={styles.actions}>
          <Button
            loading={action === "publish"}
            size="sm"
            onPress={publish}
            disabled={!html || !!action}
          >
            Publish
          </Button>
          <Button
            loading={action === "discard"}
            variant="destructive"
            size="sm"
            onPress={discard}
            disabled={!!action}
          >
            Discard
          </Button>
          <Button variant="secondary" size="sm" onPress={openAuthoringChat} disabled={!!action}>
            {authoringAgentId ? "Show chat" : "Open authoring chat"}
          </Button>
        </View>
      </View>
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {html ? (
        <ArchitecturalViewHtml html={html} />
      ) : (
        <View style={styles.centered}>
          {loading ? <LoadingSpinner size="small" /> : null}
          <Text style={styles.message}>{error ?? "Loading Architectural View draft…"}</Text>
        </View>
      )}
    </View>
  );
}

export const architecturalViewDraftPanelRegistration: PanelRegistration<"architecturalViewDraft"> =
  {
    kind: "architecturalViewDraft",
    component: ArchitecturalViewDraftPanel,
    useDescriptor: useArchitecturalViewDraftPanelDescriptor,
    // Closing a preview is a detach, never a discard. The daemon retains the
    // staged document until an explicit publish or discard action.
    confirmClose: () => Promise.resolve(true),
  };

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  toolbar: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  error: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
