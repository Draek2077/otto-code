import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Architecture, Publish, Trash2 } from "@/components/icons/material-icons";
import { ArchitecturalViewHtml } from "@/components/architectural-views/architectural-view-html";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ResizeHandle } from "@/components/resize-handle";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { ChatConversationSurface, storeCreatedWorkspaceAgent } from "@/panels/agent-panel";
import { WorkspaceDraftAgentTab } from "@/composer/draft/workspace-tab";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import {
  DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES,
  useArchitecturalViewAuthoringLayoutStore,
} from "@/stores/architectural-view-authoring-layout-store";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { definePanel } from "@/panels/panel-registry";

const AUTHORING_SPLIT_GROUP_ID = "architectural-view-authoring";
type InteractiveViewDiagramType =
  | "architecture"
  | "workflow"
  | "sequence"
  | "dataflow"
  | "lifecycle";

function interactiveViewRequest(
  action: "create" | "update",
  diagramType: InteractiveViewDiagramType,
): string {
  const label = interactiveViewTypeLabel(diagramType);
  const verb = action === "create" ? "Create" : "Update";
  const emphasis = interactiveViewTypeFocus(diagramType);
  return (
    `${verb} this ${label} Interactive View from its linked Knowledge documentation. ` +
    "First read the linked Interactive View specification and Knowledge article, including prose, Mermaid diagrams, and wiki-links. " +
    `Use the ${diagramType} typed JSON contract and make ${emphasis} explicit. ` +
    "Preserve established facts and useful existing structure; do not invent unsupported components or relationships. " +
    "When the user asks to improve the Knowledge itself, use the normal Knowledge tools as well, then update the visual to reflect the revised facts. Summarize the visual choices when finished."
  );
}

function interactiveViewTypeLabel(type: InteractiveViewDiagramType): string {
  return (
    {
      architecture: "Architecture",
      workflow: "Workflow",
      sequence: "Sequence",
      dataflow: "Data Flow",
      lifecycle: "Lifecycle",
    } as const
  )[type];
}

function interactiveViewTypeFocus(type: InteractiveViewDiagramType): string {
  return (
    {
      architecture: "scope, components, boundaries, and the primary path",
      workflow: "participants, order, branches, and exceptions",
      sequence: "callers, callees, returns, timing, and async traces",
      dataflow: "sources, transforms, stores, sensitivity, and consumers",
      lifecycle: "states, events, retries, waits, cancellation, and terminal outcomes",
    } as const
  )[type];
}

type ArchitecturalViewDraftTarget = Extract<WorkspaceTabTarget, { kind: "architecturalViewDraft" }>;

function useArchitecturalViewDraftPanelDescriptor(
  target: ArchitecturalViewDraftTarget,
  context: { serverId: string },
): PanelDescriptor {
  const authoringAgent = useSessionStore((state) =>
    target.authoringChatId
      ? (state.sessions[context.serverId]?.agents.get(target.authoringChatId) ??
        state.sessions[context.serverId]?.agentDetails.get(target.authoringChatId) ??
        null)
      : null,
  );
  const isAuthoring = authoringAgent?.status === "running";
  return {
    label: `Interactive View: ${target.viewId}`,
    tooltip: `Interactive View authoring for ${target.viewId}`,
    subtitle: isAuthoring ? "Interactive View authoring in progress" : "Interactive View authoring",
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
  const { isInteractive } = usePaneFocus();
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
  const splitSizes = useArchitecturalViewAuthoringLayoutStore((state) => state.splitSizes);
  const setSplitSizes = useArchitecturalViewAuthoringLayoutStore((state) => state.setSplitSizes);
  const [previewSplitSizes, setPreviewSplitSizes] = useState<number[] | null>(null);
  const [splitContainerWidth, setSplitContainerWidth] = useState(0);
  // A completed create always becomes an ordinary agent tab carrying the
  // authoring presentation. Older persisted compound targets can contain the
  // same chat id, so promote them on mount too. Keeping a created chat behind
  // this temporary target excluded it from selective timeline delivery.
  useEffect(() => {
    if (!target.authoringChatId) return;
    retargetCurrentTab({
      kind: "agent",
      agentId: target.authoringChatId,
      architecturalViewDraft: { viewId: target.viewId, draftId: target.draftId },
    });
  }, [retargetCurrentTab, target.authoringChatId, target.draftId, target.viewId]);

  useEffect(() => {
    if (!client || !supported) {
      setHtml(null);
      setError("Update the host to use Interactive Views.");
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
          throw new Error(result.error ?? "Could not open Interactive View.");
        }
        setHtml(result.html);
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

  const handleSplitLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSplitContainerWidth((current) => (current === width ? current : width));
  }, []);
  const handlePreviewResizeSplit = useCallback((_groupId: string, sizes: number[]) => {
    setPreviewSplitSizes(sizes);
  }, []);
  const handleResizeSplit = useCallback(
    (_groupId: string, sizes: number[]) => {
      setPreviewSplitSizes(null);
      setSplitSizes(sizes);
    },
    [setSplitSizes],
  );
  const effectiveSplitSizes = previewSplitSizes ?? splitSizes;
  const chatPaneStyle = useMemo(
    () => [
      styles.chatPane,
      inlineUnistylesStyle({
        flexGrow: effectiveSplitSizes[0] ?? DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES[0],
        flexBasis: 0,
      }),
    ],
    [effectiveSplitSizes],
  );
  const viewPaneStyle = useMemo(
    () => [
      styles.viewPane,
      inlineUnistylesStyle({
        flexGrow: effectiveSplitSizes[1] ?? DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES[1],
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
      if (!result.success) {
        throw new Error(result.error ?? "Could not publish Interactive View.");
      }
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
      title: "Delete Interactive View?",
      message:
        "This permanently removes this unpublished Interactive View. The published view is unchanged.",
      confirmLabel: "Delete Interactive View",
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
      if (!result.success) {
        throw new Error(result.error ?? "Could not delete Interactive View.");
      }
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
      retargetCurrentTab({
        kind: "agent",
        agentId: agentSnapshot.id,
        architecturalViewDraft: { viewId: target.viewId, draftId: target.draftId },
      });
    },
    [retargetCurrentTab, serverId, target.draftId, target.viewId],
  );

  let autoSubmitInitialPrompt: string | undefined;
  if (target.generateOnOpen) {
    autoSubmitInitialPrompt = interactiveViewRequest(
      target.authoringPrompt === "update" ? "update" : "create",
      target.diagramType ?? "architecture",
    );
  }

  const chatContent = (
    <WorkspaceDraftAgentTab
      serverId={serverId}
      workspaceId={workspaceId}
      tabId={tabId}
      draftId={`architectural-view-${target.viewId}-${target.draftId}`}
      autoSubmitInitialPrompt={autoSubmitInitialPrompt}
      architecturalViewDraft={architecturalViewDraft}
      isPaneFocused={isInteractive}
      onOpenWorkspaceFile={openFileInWorkspace}
      onOpenImportSheet={openImportSheet}
      onCreated={handleAuthoringAgentCreated}
    />
  );
  // This compound panel embeds a normal chat rather than being an alternate
  // chat implementation. Keep the same stream/outline/width providers that
  // own live transcript hydration for every regular Agent tab.
  const chat = <ChatConversationSurface>{chatContent}</ChatConversationSurface>;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <ToolbarIconButton
          label="Publish Interactive View"
          Icon={ThemedPublish}
          loading={action === "publish"}
          onPress={publish}
          disabled={!html || Boolean(action)}
          tone="accent"
        />
        <View style={styles.toolbarSpacer} />
        <ToolbarIconButton
          label="Delete Interactive View"
          Icon={ThemedTrash2}
          loading={action === "discard"}
          onPress={discard}
          disabled={Boolean(action)}
          tone="destructive"
        />
      </View>
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      <View style={styles.authoringSurface} onLayout={handleSplitLayout}>
        <View style={chatPaneStyle} testID="architectural-view-authoring-chat">
          {chat}
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
              <Text style={styles.message}>{error ?? "Loading Interactive View…"}</Text>
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
