import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Architecture, Publish, Trash2 } from "@/components/icons/material-icons";
import { ArchitecturalViewHtml } from "@/components/architectural-views/architectural-view-html";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ResizeHandle } from "@/components/resize-handle";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import {
  AgentPanelContent,
  ChatConversationSurface,
  storeCreatedWorkspaceAgent,
} from "@/panels/agent-panel";
import { WorkspaceDraftAgentTab } from "@/composer/draft/workspace-tab";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { definePanel } from "@/panels/panel-registry";

const AUTHORING_SPLIT_GROUP_ID = "architectural-view-authoring";
const DEFAULT_SPLIT_SIZES = [0.46, 0.54];
const INITIAL_ARCHITECTURAL_VIEW_REQUEST =
  "Create or refresh this Architectural View from the Knowledge documentation linked to the staged draft. " +
  "First read the staged draft to identify its linked Knowledge article and its current specification. Read that Knowledge article, including its prose, Mermaid diagrams, and wiki-links, then translate the established facts into a focused interactive Architectural View. Reuse and improve what is already documented; do not invent unsupported components or relationships. Update only the staged draft and summarize the visual choices when finished.";

type ArchitecturalViewDraftTarget = Extract<WorkspaceTabTarget, { kind: "architecturalViewDraft" }>;

function useArchitecturalViewDraftPanelDescriptor(
  target: ArchitecturalViewDraftTarget,
  context: { serverId: string },
): PanelDescriptor {
  const authoringAgent = useSessionStore((state) =>
    target.authoringAgentId
      ? (state.sessions[context.serverId]?.agents.get(target.authoringAgentId) ??
        state.sessions[context.serverId]?.agentDetails.get(target.authoringAgentId) ??
        null)
      : null,
  );
  const isAuthoring = authoringAgent?.status === "running";
  return {
    label: `Architecture: ${target.viewId}`,
    tooltip: `Architectural View authoring for ${target.viewId}`,
    subtitle: isAuthoring
      ? "Architectural View authoring in progress"
      : "Architectural View authoring",
    titleState: "ready",
    icon: Architecture,
    statusBucket: isAuthoring ? "running" : null,
    personalitySpinner: authoringAgent?.personalitySpinner ?? null,
  };
}

function ArchitecturalViewDraftPanel() {
  const {
    serverId,
    workspaceId,
    tabId,
    target,
    closeCurrentTab,
    openFileInWorkspace,
    openImportSheet,
    retargetCurrentTab,
  } = usePaneContext();
  const { isInteractive, isWorkspaceFocused } = usePaneFocus();
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
  const authoringAgentIsRunning = useSessionStore((state) => {
    if (!authoringAgentId) return false;
    return state.sessions[serverId]?.agents.get(authoringAgentId)?.status === "running";
  });
  const [splitSizes, setSplitSizes] = useState(DEFAULT_SPLIT_SIZES);
  const [previewSplitSizes, setPreviewSplitSizes] = useState<number[] | null>(null);
  const [splitContainerWidth, setSplitContainerWidth] = useState(0);
  const previewRefreshInFlight = useRef(false);

  const bindAuthoringAgent = useCallback(
    (agentId: string | null) => {
      setAuthoringAgentId(agentId);
      if (agentId && target.authoringAgentId !== agentId) {
        retargetCurrentTab({
          kind: "architecturalViewDraft",
          viewId: target.viewId,
          draftId: target.draftId,
          authoringAgentId: agentId,
        });
      }
    },
    [retargetCurrentTab, target.authoringAgentId, target.draftId, target.viewId],
  );

  const consumeInitialGeneration = useCallback(() => {
    if (!target.generateOnOpen) return;
    retargetCurrentTab({
      kind: "architecturalViewDraft",
      viewId: target.viewId,
      draftId: target.draftId,
      ...(target.authoringAgentId ? { authoringAgentId: target.authoringAgentId } : {}),
    });
  }, [retargetCurrentTab, target]);

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
        bindAuthoringAgent(result.draft?.authoringAgentId ?? null);
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
  }, [bindAuthoringAgent, client, supported, target.draftId, target.viewId, workspaceId]);

  // The bound authoring agent writes directly through the daemon service, so
  // its edit does not originate from this panel's RPC request. Refresh only
  // the one staged document while that agent is running; no Knowledge pages
  // or project-wide index are reread.
  useEffect(() => {
    if (!client || !supported || !authoringAgentId || !authoringAgentIsRunning) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const refreshPreview = async () => {
      if (previewRefreshInFlight.current) return;
      previewRefreshInFlight.current = true;
      try {
        const result = await client.getArchitecturalViewDraftContent({
          workspaceId,
          viewId: target.viewId,
          draftId: target.draftId,
        });
        if (cancelled || !result.success || !result.html) return;
        setHtml(result.html);
        setError(null);
      } catch {
        // The existing last-known-good preview remains usable while a refresh
        // races an authoring write or a transient host disconnect.
      } finally {
        previewRefreshInFlight.current = false;
        if (!cancelled) timeout = setTimeout(() => void refreshPreview(), 1_500);
      }
    };
    void refreshPreview();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [
    authoringAgentId,
    authoringAgentIsRunning,
    client,
    supported,
    target.draftId,
    target.viewId,
    workspaceId,
  ]);

  const handleSplitLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSplitContainerWidth((current) => (current === width ? current : width));
  }, []);
  const handlePreviewResizeSplit = useCallback((_groupId: string, sizes: number[]) => {
    setPreviewSplitSizes(sizes);
  }, []);
  const handleResizeSplit = useCallback((_groupId: string, sizes: number[]) => {
    setPreviewSplitSizes(null);
    setSplitSizes(sizes);
  }, []);
  const effectiveSplitSizes = previewSplitSizes ?? splitSizes;
  const chatPaneStyle = useMemo(
    () => [
      styles.chatPane,
      inlineUnistylesStyle({
        flexGrow: effectiveSplitSizes[0] ?? DEFAULT_SPLIT_SIZES[0],
        flexBasis: 0,
      }),
    ],
    [effectiveSplitSizes],
  );
  const viewPaneStyle = useMemo(
    () => [
      styles.viewPane,
      inlineUnistylesStyle({
        flexGrow: effectiveSplitSizes[1] ?? DEFAULT_SPLIT_SIZES[1],
        flexBasis: 0,
      }),
    ],
    [effectiveSplitSizes],
  );
  const architecturalViewDraft = useMemo(
    () => ({ viewId: target.viewId, draftId: target.draftId }),
    [target.draftId, target.viewId],
  );

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

  const handleAuthoringAgentCreated = useCallback(
    (agentSnapshot: Parameters<typeof storeCreatedWorkspaceAgent>[0]["agentSnapshot"]) => {
      storeCreatedWorkspaceAgent({ serverId, agentSnapshot });
      bindAuthoringAgent(agentSnapshot.id);
    },
    [bindAuthoringAgent, serverId],
  );

  const chat = authoringAgentId ? (
    <AgentPanelContent
      serverId={serverId}
      agentId={authoringAgentId}
      isPaneFocused={isInteractive}
      isWorkspaceFocused={isWorkspaceFocused}
      onOpenWorkspaceFile={openFileInWorkspace}
    />
  ) : (
    <WorkspaceDraftAgentTab
      serverId={serverId}
      workspaceId={workspaceId}
      tabId={tabId}
      draftId={`architectural-view-${target.viewId}-${target.draftId}`}
      autoSubmitInitialPrompt={
        target.generateOnOpen ? INITIAL_ARCHITECTURAL_VIEW_REQUEST : undefined
      }
      onAutoSubmitInitialPromptStarted={consumeInitialGeneration}
      architecturalViewDraft={architecturalViewDraft}
      isPaneFocused={isInteractive}
      onOpenWorkspaceFile={openFileInWorkspace}
      onOpenImportSheet={openImportSheet}
      onCreated={handleAuthoringAgentCreated}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <ToolbarIconButton
          label="Publish Architectural View"
          Icon={ThemedPublish}
          loading={action === "publish"}
          onPress={publish}
          disabled={!html || !!action}
          tone="accent"
        />
        <View style={styles.toolbarSpacer} />
        <ToolbarIconButton
          label="Discard Architectural View draft"
          Icon={ThemedTrash2}
          loading={action === "discard"}
          onPress={discard}
          disabled={!!action}
          tone="destructive"
        />
      </View>
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      <View style={styles.authoringSurface} onLayout={handleSplitLayout}>
        <View style={chatPaneStyle} testID="architectural-view-authoring-chat">
          <ChatConversationSurface>{chat}</ChatConversationSurface>
        </View>
        <ResizeHandle
          testID="architectural-view-authoring-splitter"
          direction="horizontal"
          groupId={AUTHORING_SPLIT_GROUP_ID}
          index={0}
          sizes={effectiveSplitSizes}
          containerSize={splitContainerWidth}
          onPreviewResizeSplit={handlePreviewResizeSplit}
          onResizeSplit={handleResizeSplit}
        />
        <View style={viewPaneStyle} testID="architectural-view-authoring-preview">
          {html ? (
            <ArchitecturalViewHtml html={html} />
          ) : (
            <View style={styles.centered}>
              {loading ? <LoadingSpinner size="small" /> : null}
              <Text style={styles.message}>{error ?? "Loading Architectural View draft…"}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export const architecturalViewDraftPanelRegistration = definePanel("architecturalViewDraft", {
  component: ArchitecturalViewDraftPanel,
  useDescriptor: useArchitecturalViewDraftPanelDescriptor,
  // Closing a preview is a detach, never a discard. The daemon retains the
  // staged document until an explicit publish or discard action.
  confirmClose: () => Promise.resolve(true),
});

const ThemedPublish = withUnistyles(Publish);
const ThemedTrash2 = withUnistyles(Trash2);

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  toolbar: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarSpacer: { flex: 1 },
  authoringSurface: { flex: 1, minHeight: 0, flexDirection: "row" },
  chatPane: { minWidth: 0, minHeight: 0, overflow: "hidden" },
  viewPane: { minWidth: 0, minHeight: 0, overflow: "hidden" },
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
