import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ContextNode } from "@otto-code/protocol/messages";
import { FileTabPane } from "@/components/file-tab-pane";
import { AlertTriangle, ChevronLeft, X } from "@/components/icons/material-icons";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { useIconSize } from "@/styles/theme";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import {
  MAX_CONTEXT_SIDEBAR_WIDTH,
  MIN_CONTEXT_SIDEBAR_WIDTH,
  usePanelStore,
} from "@/stores/panel-store";
import { useToast } from "@/contexts/toast-context";
import { setFileViewModeFor } from "@/stores/file-view-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store/state";
import { ContextFindingsList, type ContextFindingTarget } from "./findings-list";
import { ContextGraphTree } from "./graph-tree";
import { ContextSidebarTabs, type ContextSidebarTab } from "./sidebar-tabs";
import {
  ancestorKeysForNode,
  defaultExpandedKeys,
  findInboundEdge,
  pickInitialNode,
  splitAbsolutePath,
} from "./graph-model";
import { LoadModeControl } from "./load-mode-control";
import { ContextSummary } from "./summary";
import { useContextReportQuery } from "./use-context-report";

const DEFAULT_WINDOW_TOKENS = 200_000;

// The file pane is the point of the tab, so the splitter never squeezes it below
// a width where the editor stops being readable — mirrors MIN_CHAT_WIDTH.
const MIN_CONTEXT_FILE_WIDTH = 360;

// Anchors the absolutely-positioned resize handle that hangs off the shell's edge.
const SIDEBAR_SHELL_STYLE = { position: "relative" } as const;

// Theme-reactive icon color without useUnistyles (docs/unistyles.md).
const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedX = withUnistyles(X);

// The standing edit exemption for context files: being outside the workspace
// root is the entire point of this feature, so the gated-multi-root warning
// would fire on every global CLAUDE.md and mean nothing.
const CONTEXT_EDIT_GATE = { kind: "free" } as const;

/**
 * Context Management — one tab, three parts, no sub-tabs:
 * health summary and pickers, the load graph, and the file being worked on.
 *
 * On a phone three panes cannot coexist, so the same three parts become a
 * drill-down: summary + tree in one scroll, then the file full-screen with a
 * back affordance.
 */
export function ContextManagementPanel(): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const { serverId, workspaceId } = usePaneContext();
  const isCompact = useIsCompactFormFactor();
  // The back chevron carries a label, so it takes the gentler 1.5x compact bump
  // rather than the ×2 an icon-only control gets — the label only grows by +2.
  const backIconSize = useIconSize(1.5);

  // The picker is a viewing preference, so it persists device-locally and the
  // tab reopens where the user left it.
  const { settings, updateSettings } = useAppSettings();
  const windowTokens = settings.contextWindowTokens || DEFAULT_WINDOW_TOKENS;
  const handleWindowTokensChange = useCallback(
    (contextWindowTokens: number) => {
      void updateSettings({ contextWindowTokens });
    },
    [updateSettings],
  );
  const { report, isLoading, refresh } = useContextReportQuery(serverId, workspaceId, {
    windowTokens,
  });

  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(["context_files"]),
  );
  const [selectedNode, setSelectedNode] = useState<ContextNode | null>(null);
  const [compactShowsFile, setCompactShowsFile] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<ContextSidebarTab>("context");

  // The compact layout puts the whole page in one scroll, so the page itself
  // needs the overlay bar too — not just the lists inside it.
  const compactScrollRef = useRef<ScrollView>(null);
  const compactScrollbar = useWebScrollViewScrollbar(compactScrollRef, { enabled: isWeb });

  // Re-seed when a different report arrives (provider or window changed), but
  // never stomp a selection the user made themselves.
  useEffect(() => {
    if (!report) return;
    setExpandedKeys(defaultExpandedKeys(report));
    setSelectedNode((current) => {
      if (current && report.nodes.some((node) => node.id === current.id)) return current;
      return pickInitialNode(report);
    });
  }, [report]);

  const handleToggle = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleSelectNode = useCallback(
    (node: ContextNode) => {
      setSelectedNode(node);
      if (isCompact) setCompactShowsFile(true);
    },
    [isCompact],
  );

  const handleCompactBack = useCallback(() => setCompactShowsFile(false), []);

  // What the fix list sent us to. One action does four things, because any
  // fewer leaves the user hunting: open the file at the line, reveal and select
  // its row in the tree, switch back to Context, and keep the finding on screen
  // over the editor so what is wrong is still readable while fixing it.
  const [revealed, setRevealed] = useState<RevealedFinding | null>(null);

  const handleRevealFinding = useCallback(
    ({ node, finding }: ContextFindingTarget) => {
      // Context files are markdown, and markdown opens in rendered preview,
      // where there is no line to land on. A finding is a request to edit, so
      // it overrides the per-file mode memory the same way the explorer's
      // "Edit" command does.
      const persistenceKey = workspaceId
        ? buildWorkspaceTabPersistenceKey({ serverId, workspaceId })
        : null;
      if (finding.line != null && persistenceKey) {
        setFileViewModeFor({
          persistenceKey,
          path: splitAbsolutePath(node.path).base,
          mode: "editor",
        });
      }
      setSelectedNode(node);
      setExpandedKeys((prev) => new Set([...prev, ...ancestorKeysForNode(report, node.id)]));
      setSidebarTab("context");
      setRevealed((prev) => ({
        nodeId: node.id,
        line: finding.line,
        lineEnd: finding.lineEnd,
        message: finding.message,
        // Revealing the same finding twice must still scroll and re-jump, so
        // the tree and the editor watch a counter rather than the identity.
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      if (isCompact) setCompactShowsFile(true);
    },
    [isCompact, report, serverId, workspaceId],
  );

  const handleDismissReveal = useCallback(() => setRevealed(null), []);

  // Picking another file in the tree does not clear the reveal; it just stops
  // applying, so coming back to the flagged file restores it.
  const activeReveal = revealed && revealed.nodeId === selectedNode?.id ? revealed : null;

  // Desktop splitter for the left column. Compact never renders the two-column
  // row, but the hooks run unconditionally either way.
  const contextSidebarWidth = usePanelStore((state) => state.contextSidebarWidth);
  const setContextSidebarWidth = usePanelStore((state) => state.setContextSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const startWidthRef = useRef(contextSidebarWidth);
  const resizeWidth = useSharedValue(contextSidebarWidth);
  const maxSidebarWidth = Math.max(
    MIN_CONTEXT_SIDEBAR_WIDTH,
    Math.min(MAX_CONTEXT_SIDEBAR_WIDTH, viewportWidth - MIN_CONTEXT_FILE_WIDTH),
  );

  // A narrower window can invalidate a persisted width, so reconcile before
  // mirroring the store into the shared value the pane actually renders from.
  useEffect(() => {
    if (contextSidebarWidth > maxSidebarWidth) {
      setContextSidebarWidth(maxSidebarWidth);
      return;
    }
    resizeWidth.value = contextSidebarWidth;
  }, [contextSidebarWidth, maxSidebarWidth, resizeWidth, setContextSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = contextSidebarWidth;
          resizeWidth.value = contextSidebarWidth;
        })
        .onUpdate((event) => {
          // This sidebar is on the left, so dragging right widens it — the
          // opposite sign from the workspace explorer's right-hand sidebar.
          const next = startWidthRef.current + event.translationX;
          resizeWidth.value = Math.max(MIN_CONTEXT_SIDEBAR_WIDTH, Math.min(maxSidebarWidth, next));
        })
        .onEnd(() => {
          runOnJS(setContextSidebarWidth)(resizeWidth.value);
        }),
    [contextSidebarWidth, maxSidebarWidth, resizeWidth, setContextSidebarWidth],
  );

  // The width tracks the pan gesture on the UI thread, so the splitter follows
  // the pointer without re-rendering the tree and the file pane every frame.
  // The shell carries it on a plain node: Unistyles must not own one Reanimated
  // also patches (see explorer-sidebar.tsx for the same split). This sidebar
  // never opens or closes, so there is no slide animation here.
  const sidebarWidthStyle = useAnimatedStyle(() => ({ width: resizeWidth.value }));
  const sidebarShellStyle = useMemo(
    () => [SIDEBAR_SHELL_STYLE, sidebarWidthStyle],
    [sidebarWidthStyle],
  );

  // One tabbed body, rendered identically in both layouts — only its container
  // differs (a fixed sidebar column vs. a block in the phone's scroll).
  const sidebarBody =
    sidebarTab === "findings" ? (
      <ContextFindingsList report={report} onReveal={handleRevealFinding} />
    ) : (
      <ContextGraphTree
        report={report}
        expandedKeys={expandedKeys}
        selectedNodeId={selectedNode?.id ?? null}
        revealNodeId={activeReveal?.nodeId ?? null}
        revealNonce={activeReveal?.nonce}
        onToggle={handleToggle}
        onSelectNode={handleSelectNode}
      />
    );
  const findingCount = report?.findings.length ?? 0;

  // Converting rewrites the parent file, so the report must be re-read
  // afterwards — the daemon also pushes a fresh one, this just closes the gap.
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [converting, setConverting] = useState(false);
  const inbound = useMemo(
    () => findInboundEdge(report, selectedNode?.id ?? null),
    [report, selectedNode],
  );

  const handleConvert = useCallback(
    (target: "import" | "reference") => {
      if (!client || !workspaceId || !inbound) return;
      setConverting(true);
      void (async () => {
        try {
          const result = await client.requestContextEdgeConvert({
            workspaceId,
            filePath: inbound.parent.path,
            rawTarget: inbound.edge.rawTarget,
            range: inbound.edge.range,
            target,
          });
          if (!result.ok && result.error) {
            toast.error(result.error);
          }
          refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        } finally {
          setConverting(false);
        }
      })();
    },
    [client, inbound, refresh, toast, workspaceId],
  );

  const loadModeControl = useMemo(
    () =>
      inbound && selectedNode ? (
        <LoadModeControl
          inbound={inbound}
          estTokens={selectedNode.estTokens}
          supportsImports={report?.supportsImports ?? false}
          busy={converting}
          onConvert={handleConvert}
          layout={isCompact ? "strip" : "toolbar"}
        />
      ) : null,
    [converting, handleConvert, inbound, isCompact, report?.supportsImports, selectedNode],
  );

  const filePane = useMemo(() => {
    if (!selectedNode || !workspaceId) {
      return (
        <View style={styles.filePlaceholder}>
          <Text style={styles.placeholderTitle}>
            {t(
              report && report.nodes.length === 0
                ? "contextManagement.emptyState.title"
                : "contextManagement.filePlaceholder.title",
            )}
          </Text>
          <Text style={styles.placeholderBody}>
            {t(
              report && report.nodes.length === 0
                ? "contextManagement.emptyState.body"
                : "contextManagement.filePlaceholder.body",
            )}
          </Text>
        </View>
      );
    }
    // Desktop: the load-mode switch rides in the file toolbar rather than above
    // it — a second full-width bar spent a whole row saying two words. A phone
    // toolbar has no width to lend, so there it goes back to its own strip.
    const banner = activeReveal ? (
      <FindingBanner
        message={activeReveal.message}
        iconSize={backIconSize.sm}
        onDismiss={handleDismissReveal}
      />
    ) : null;
    if (isCompact) {
      return (
        <View style={styles.fill}>
          {banner}
          {loadModeControl}
          <View style={styles.fill}>
            <ContextFilePane
              serverId={serverId}
              workspaceId={workspaceId}
              absolutePath={selectedNode.path}
              lineStart={activeReveal?.line}
              lineEnd={activeReveal?.lineEnd}
              toolbarLeadingSlot={null}
            />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.fill}>
        {banner}
        <View style={styles.fill}>
          <ContextFilePane
            serverId={serverId}
            workspaceId={workspaceId}
            absolutePath={selectedNode.path}
            lineStart={activeReveal?.line}
            lineEnd={activeReveal?.lineEnd}
            toolbarLeadingSlot={loadModeControl}
          />
        </View>
      </View>
    );
  }, [
    activeReveal,
    backIconSize.sm,
    handleDismissReveal,
    isCompact,
    loadModeControl,
    report,
    selectedNode,
    serverId,
    t,
    workspaceId,
  ]);

  if (isCompact) {
    if (compactShowsFile && selectedNode) {
      return (
        <View style={styles.root} testID="context-management-panel">
          <View style={styles.compactHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("contextManagement.back")}
              onPress={handleCompactBack}
              style={styles.backButton}
              hitSlop={8}
              testID="context-management-back"
            >
              <ThemedChevronLeft size={backIconSize.md} style={styles.backIcon} />
              <Text style={styles.backLabel} numberOfLines={1}>
                {selectedNode.relPath}
              </Text>
            </Pressable>
          </View>
          <View style={styles.fill}>{filePane}</View>
        </View>
      );
    }
    return (
      <View style={styles.root} testID="context-management-panel">
        <ScrollView
          ref={compactScrollRef}
          style={styles.fill}
          onLayout={compactScrollbar.onLayout}
          onScroll={compactScrollbar.onScroll}
          onContentSizeChange={compactScrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!isWeb}
        >
          <ContextSummary
            report={report}
            isLoading={isLoading}
            windowTokens={windowTokens}
            onWindowTokensChange={handleWindowTokensChange}
          />
          <ContextSidebarTabs
            active={sidebarTab}
            findingCount={findingCount}
            onChange={setSidebarTab}
          />
          <View style={styles.compactTree}>{sidebarBody}</View>
        </ScrollView>
        {compactScrollbar.overlay}
      </View>
    );
  }

  return (
    <View style={styles.rootRow} testID="context-management-panel">
      <Animated.View style={sidebarShellStyle}>
        <View style={styles.sidebar}>
          <ContextSummary
            report={report}
            isLoading={isLoading}
            windowTokens={windowTokens}
            onWindowTokensChange={handleWindowTokensChange}
          />
          <View style={styles.divider} />
          <ContextSidebarTabs
            active={sidebarTab}
            findingCount={findingCount}
            onChange={setSidebarTab}
          />
          {sidebarBody}
        </View>
        <GestureDetector gesture={resizeGesture}>
          <View style={RESIZE_HANDLE_STYLE} testID="context-management-splitter" />
        </GestureDetector>
      </Animated.View>
      <View style={styles.fill}>{filePane}</View>
    </View>
  );
}

/** A finding the user chose to act on, pinned until dismissed. */
interface RevealedFinding {
  nodeId: string;
  line?: number;
  lineEnd?: number;
  message: string;
  nonce: number;
}

/**
 * Restates the finding over the file it sent you to. Without it the jump lands
 * on a line with no explanation — the fix list is one tab away, and the whole
 * point of the arrow was not having to hold the sentence in your head.
 */
function FindingBanner({
  message,
  iconSize,
  onDismiss,
}: {
  message: string;
  iconSize: number;
  onDismiss: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.banner} testID="context-finding-banner">
      <ThemedAlertTriangle size={iconSize} style={styles.bannerIcon} />
      <Text style={styles.bannerText}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("contextManagement.findings.dismiss")}
        onPress={onDismiss}
        hitSlop={8}
        testID="context-finding-banner-dismiss"
      >
        <ThemedX size={iconSize} style={styles.bannerDismiss} />
      </Pressable>
    </View>
  );
}

interface ContextFilePaneProps {
  serverId: string;
  workspaceId: string;
  absolutePath: string;
  /** 1-based line the finding points at; the editor opens there. */
  lineStart?: number;
  /** Last line of the finding's span; the editor selects through it. */
  lineEnd?: number;
  toolbarLeadingSlot: ReactNode;
}

/**
 * Hosts the ordinary file editor for a context file. Context files routinely
 * live outside the workspace root (`~/.claude/CLAUDE.md`), so the pane is
 * rooted at the file's own directory rather than the project.
 */
function ContextFilePane({
  serverId,
  workspaceId,
  absolutePath,
  lineStart,
  lineEnd,
  toolbarLeadingSlot,
}: ContextFilePaneProps): ReactElement {
  const { dir, base } = useMemo(() => splitAbsolutePath(absolutePath), [absolutePath]);
  const location = useMemo(() => ({ path: base, lineStart, lineEnd }), [base, lineStart, lineEnd]);
  return (
    <FileTabPane
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={dir}
      location={location}
      editGate={CONTEXT_EDIT_GATE}
      toolbarLeadingSlot={toolbarLeadingSlot}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  rootRow: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: theme.colors.background,
  },
  sidebar: {
    // Width lives on the animated shell; this fills it.
    flex: 1,
    minWidth: 0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  divider: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
  },
  fill: {
    flex: 1,
    minWidth: 0,
  },
  compactTree: {
    minHeight: 320,
  },
  compactHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  backIcon: {
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  backLabel: {
    color: theme.colors.foreground,
    // This header only renders on compact, but the breakpoint form keeps the
    // +2 bump explicit rather than baking it into a bare number.
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
    flex: 1,
    minWidth: 0,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  bannerIcon: {
    color: theme.colors.statusWarning,
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
  },
  bannerDismiss: {
    color: theme.colors.mutedForeground,
    flexShrink: 0,
  },
  filePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  placeholderTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    textAlign: "center",
  },
  placeholderBody: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 420,
  },
}));

const RESIZE_HANDLE_STYLE = [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)];
