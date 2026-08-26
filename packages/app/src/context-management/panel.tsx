import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PageLoading } from "@/components/ui/page-loading";
import type { ContextCategory, ContextNode } from "@otto-code/protocol/messages";
import { FileTabPane } from "@/components/file-tab-pane";
import { AlertTriangle, ChevronLeft, X } from "@/components/icons/material-icons";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
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
import { ContextRefineAction } from "./refine-action";
import { ContextFindingsList, type ContextFindingTarget } from "./findings-list";
import { ContextGraphTree } from "./graph-tree";
import { ContextMemoryList } from "./memory-list";
import { useContextPersonalityMemory } from "./use-context-personality";
import { ContextSidebarTabs, type ContextSidebarTab } from "./sidebar-tabs";
import { PromptSectionView } from "./prompt-preview-view";
import { usePromptPreview } from "./use-prompt-preview";
import { CATEGORY_LABEL_KEYS } from "./format";
import {
  ancestorKeysForNode,
  defaultExpandedKeys,
  findInboundEdge,
  splitAbsolutePath,
} from "./graph-model";
import { useContextSelection } from "./use-context-selection";
import { LoadModeControl } from "./load-mode-control";
import { ContextSummary } from "./summary";
import { useContextReportQuery } from "./use-context-report";
import type { IconSizeProp } from "@/components/icons/icon-size";

const DEFAULT_WINDOW_TOKENS = 200_000;

// The file pane is the point of the tab, so the splitter never squeezes it below
// a width where the editor stops being readable - mirrors MIN_CHAT_WIDTH.
const MIN_CONTEXT_FILE_WIDTH = 360;

// Anchors the absolutely-positioned resize handle that hangs off the shell's edge.
const SIDEBAR_SHELL_STYLE = { position: "relative" } as const;

// Theme-reactive icon color without useUnistyles (docs/unistyles.md).
const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedX = withUnistyles(X);

/**
 * Context Management - one tab, three parts, no sub-tabs:
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
  const animationsEnabled = useAnimationsEnabled();
  const isCompact = useIsCompactFormFactor();
  // The back chevron carries a label, so it takes the gentler 1.5x compact bump
  // rather than the ×2 an icon-only control gets - the label only grows by +2.
  const backIconSize = useIconSize();

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
  // Which personality this tab is evaluating context FOR - resolved above the
  // report query because it is one of the query's inputs. Context stopped being
  // a property of the workspace alone once personalities started accruing
  // memory: two personalities here send different things.
  const [sidebarTab, setSidebarTab] = useState<ContextSidebarTab>("context");
  const {
    selectedProfileId,
    slot: personalitySlot,
    lessonCount,
    memory,
  } = useContextPersonalityMemory({ serverId, workspaceId, onTabChange: setSidebarTab });

  const {
    report,
    isLoading,
    isRefreshing,
    error: scanError,
    refresh,
  } = useContextReportQuery(serverId, workspaceId, {
    windowTokens,
    // Selecting a personality re-scopes the whole report: its injected memory
    // joins the fixed weight, so the percentages describe what THAT personality
    // carries rather than a shared average nobody actually pays.
    ...(selectedProfileId ? { personalityId: selectedProfileId } : {}),
  });

  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(["context_files"]),
  );
  // A file row and a prompt row share the right-hand pane; see the hook for the
  // precedence rule the three call sites that move this all have to agree on.
  const {
    node: selectedNode,
    category: selectedCategory,
    highlightNodeId,
    hasSelection,
    showsPane: compactShowsPane,
    selectNode,
    selectCategory,
    goBack: handleCompactBack,
  } = useContextSelection({ report, isCompact });

  // Passing a null workspace until a prompt row is selected is the gate:
  // assembling a section is real work to do for a pane nobody is looking at. It
  // shares the report's what-ifs so the text on screen always describes the same
  // request the numbers above it do.
  const promptPreview = usePromptPreview(serverId, selectedCategory ? workspaceId : null, {
    windowTokens,
    ...(selectedProfileId ? { personalityId: selectedProfileId } : {}),
    ...(selectedCategory ? { category: selectedCategory } : {}),
  });

  // The compact layout puts the whole page in one scroll, so the page itself
  // needs the overlay bar too - not just the lists inside it.
  const compactScrollRef = useRef<ScrollView>(null);
  const compactScrollbar = useWebScrollViewScrollbar(compactScrollRef, { enabled: isWeb });

  // The tree's own re-seed: which rows are open. The selection hook owns the
  // other half of the same report change.
  useEffect(() => {
    if (!report) return;
    setExpandedKeys(defaultExpandedKeys(report));
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
      selectNode(node);
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
    },
    [report, selectNode, serverId, workspaceId],
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
        // Pan defaults to a 15px activation slop, which on a 1px divider reads
        // as a dead zone followed by a catch-up jump. A resize handle has to
        // track from the first pixel, so opt out of the slop entirely.
        .minDistance(0)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = contextSidebarWidth;
          resizeWidth.value = contextSidebarWidth;
        })
        .onUpdate((event) => {
          // This sidebar is on the left, so dragging right widens it - the
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

  // Converting rewrites the parent file, so the report must be re-read
  // afterwards - the daemon also pushes a fresh one, this just closes the gap.
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  // "Fix all" targets every finding the scan already proved has a safe
  // mechanical answer (`fixable`) - the daemon computed that per kind, this
  // just resolves each one's node back to the file path the fix RPC needs.
  const fixableFindings = useMemo(() => {
    if (!report) return [];
    return report.findings.flatMap((finding) => {
      if (!finding.fixable || !finding.range || finding.snippet == null || !finding.nodeId) {
        return [];
      }
      const node = report.nodes.find((candidate) => candidate.id === finding.nodeId);
      if (!node) return [];
      return [{ filePath: node.path, range: finding.range, snippet: finding.snippet }];
    });
  }, [report]);

  const [fixingAll, setFixingAll] = useState(false);
  const handleFixAll = useCallback(() => {
    if (!client || !workspaceId || fixableFindings.length === 0) return;
    setFixingAll(true);
    void (async () => {
      try {
        const result = await client.requestContextFindingsFix({
          workspaceId,
          findings: fixableFindings,
        });
        if (result.fixedCount > 0) {
          toast.show(t("contextManagement.findings.fixedCount", { count: result.fixedCount }), {
            variant: "success",
          });
        }
        if (result.failedCount > 0) {
          toast.error(
            t("contextManagement.findings.fixFailedCount", { count: result.failedCount }),
          );
        }
        refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setFixingAll(false);
      }
    })();
  }, [client, fixableFindings, refresh, t, toast, workspaceId]);

  // One tabbed body, rendered identically in both layouts - only its container
  // differs (a fixed sidebar column vs. a block in the phone's scroll).
  const sidebarBody = (
    <ContextSidebarBody
      tab={sidebarTab}
      report={report}
      isLoading={isLoading}
      onReveal={handleRevealFinding}
      fixableCount={fixableFindings.length}
      isFixing={fixingAll}
      onFixAll={handleFixAll}
      memoryView={memory.view}
      memoryIsLoading={memory.isLoading}
      memoryError={memory.error}
      hasPersonalitySelected={selectedProfileId !== null}
      onSaveEntry={memory.saveEntry}
      onDropEntry={memory.dropEntry}
      onAddEntry={memory.addEntry}
      expandedKeys={expandedKeys}
      // Exactly one row is highlighted: the prompt section wins while it owns
      // the pane, and the file it displaced stays remembered underneath.
      selectedNodeId={highlightNodeId}
      selectedCategory={selectedCategory}
      revealNodeId={activeReveal?.nodeId ?? null}
      revealNonce={activeReveal?.nonce}
      onToggle={handleToggle}
      onSelectNode={selectNode}
      onSelectCategory={selectCategory}
    />
  );
  const findingCount = report?.findings.length ?? 0;

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

  // How this file is LOADED (link vs always) rides in the file toolbar, with
  // the rest of the file's own tools. Compaction does NOT: it opens a job
  // carrying the whole context graph, so it belongs with the graph - see the
  // sidebar tabs below.
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

  const refineAction = useMemo(
    () => (
      <ContextRefineAction
        serverId={serverId}
        workspaceId={workspaceId ?? ""}
        report={report}
        selectedNode={selectedNode}
      />
    ),
    [report, selectedNode, serverId, workspaceId],
  );

  // "No context at all" and "nothing picked yet" are different placeholders.
  const isEmptyReport = report != null && report.nodes.length === 0;

  const filePane = useMemo(() => {
    // A prompt section owns the pane while one is selected. It is read-only and
    // has no file behind it, so none of the file chrome below applies.
    if (selectedCategory) {
      return <PromptSectionView category={selectedCategory} query={promptPreview} />;
    }
    if (!selectedNode || !workspaceId) {
      return <ContextFilePlaceholder isEmptyReport={isEmptyReport} />;
    }
    // Desktop: the load-mode switch rides in the file toolbar rather than above
    // it - a second full-width bar spent a whole row saying two words. A phone
    // toolbar has no width to lend, so there it goes back to its own strip.
    const banner = activeReveal ? (
      <FindingBanner
        message={activeReveal.message}
        iconSize={backIconSize.chromeSm}
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
    backIconSize.chromeSm,
    handleDismissReveal,
    isCompact,
    isEmptyReport,
    loadModeControl,
    promptPreview,
    selectedCategory,
    selectedNode,
    serverId,
    workspaceId,
  ]);

  return renderAfterInitialLoad(isLoading, () => {
    if (isCompact) {
      if (compactShowsPane && hasSelection) {
        return (
          <Animated.View
            entering={animationsEnabled ? FadeIn.duration(180) : undefined}
            style={styles.root}
            testID="context-management-panel"
          >
            <CompactPaneHeader
              node={selectedNode}
              category={selectedCategory}
              iconSize={backIconSize.chromeMd}
              onBack={handleCompactBack}
            />
            <View style={styles.fill}>{filePane}</View>
          </Animated.View>
        );
      }
      return (
        <Animated.View
          entering={animationsEnabled ? FadeIn.duration(180) : undefined}
          style={styles.root}
          testID="context-management-panel"
        >
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
              isRefreshing={isRefreshing}
              error={scanError}
              windowTokens={windowTokens}
              onWindowTokensChange={handleWindowTokensChange}
              personalitySlot={personalitySlot}
            />
            <ContextSidebarTabs
              active={sidebarTab}
              findingCount={findingCount}
              lessonCount={lessonCount}
              onChange={setSidebarTab}
              leading={refineAction}
            />
            <View style={styles.compactTree}>{sidebarBody}</View>
          </ScrollView>
          {compactScrollbar.overlay}
        </Animated.View>
      );
    }

    return (
      <Animated.View
        entering={animationsEnabled ? FadeIn.duration(180) : undefined}
        style={styles.rootRow}
        testID="context-management-panel"
      >
        <Animated.View style={sidebarShellStyle}>
          <View style={styles.sidebar}>
            <ContextSummary
              report={report}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              error={scanError}
              windowTokens={windowTokens}
              onWindowTokensChange={handleWindowTokensChange}
              personalitySlot={personalitySlot}
            />
            <View style={styles.divider} />
            <ContextSidebarTabs
              active={sidebarTab}
              findingCount={findingCount}
              lessonCount={lessonCount}
              onChange={setSidebarTab}
              leading={refineAction}
            />
            {sidebarBody}
          </View>
          <GestureDetector gesture={resizeGesture}>
            <View style={RESIZE_HANDLE_STYLE} testID="context-management-splitter" />
          </GestureDetector>
        </Animated.View>
        <View style={styles.fill}>{filePane}</View>
      </Animated.View>
    );
  });
}

function renderAfterInitialLoad(
  isLoading: boolean,
  renderLoaded: () => ReactElement,
): ReactElement {
  return isLoading ? (
    <PageLoading label="Loading context…" testID="context-management-loading" />
  ) : (
    renderLoaded()
  );
}

type MemoryListProps = ComponentProps<typeof ContextMemoryList>;
type FindingsListProps = ComponentProps<typeof ContextFindingsList>;
type GraphTreeProps = ComponentProps<typeof ContextGraphTree>;

/**
 * Which of the three tabs is showing. Split out of the panel because it is the
 * one branch in there that is pure dispatch: three arms that share `report` and
 * nothing else, each reading only the props its own tab needs. The props stay
 * flat rather than bundled per tab because a bundle would be an object built in
 * the panel's render - exactly what react-perf's new-object-as-prop rule is for.
 */
function ContextSidebarBody({
  tab,
  report,
  isLoading,
  onReveal,
  fixableCount,
  isFixing,
  onFixAll,
  memoryView,
  memoryIsLoading,
  memoryError,
  hasPersonalitySelected,
  onSaveEntry,
  onDropEntry,
  onAddEntry,
  expandedKeys,
  selectedNodeId,
  selectedCategory,
  revealNodeId,
  revealNonce,
  onToggle,
  onSelectNode,
  onSelectCategory,
}: {
  tab: ContextSidebarTab;
  report: GraphTreeProps["report"];
  isLoading: boolean;
  onReveal: FindingsListProps["onReveal"];
  fixableCount: FindingsListProps["fixableCount"];
  isFixing: FindingsListProps["isFixing"];
  onFixAll: FindingsListProps["onFixAll"];
  memoryView: MemoryListProps["view"];
  memoryIsLoading: MemoryListProps["isLoading"];
  memoryError: MemoryListProps["error"];
  hasPersonalitySelected: MemoryListProps["hasPersonalitySelected"];
  onSaveEntry: MemoryListProps["onSaveEntry"];
  onDropEntry: MemoryListProps["onDropEntry"];
  onAddEntry: MemoryListProps["onAddEntry"];
  expandedKeys: GraphTreeProps["expandedKeys"];
  selectedNodeId: GraphTreeProps["selectedNodeId"];
  selectedCategory: GraphTreeProps["selectedCategory"];
  revealNodeId: GraphTreeProps["revealNodeId"];
  revealNonce: GraphTreeProps["revealNonce"];
  onToggle: GraphTreeProps["onToggle"];
  onSelectNode: GraphTreeProps["onSelectNode"];
  onSelectCategory: GraphTreeProps["onSelectCategory"];
}): ReactElement {
  if (tab === "findings") {
    return (
      <ContextFindingsList
        report={report}
        isLoading={isLoading}
        onReveal={onReveal}
        fixableCount={fixableCount}
        isFixing={isFixing}
        onFixAll={onFixAll}
      />
    );
  }
  if (tab === "memory") {
    return (
      <ContextMemoryList
        view={memoryView}
        isLoading={memoryIsLoading}
        error={memoryError}
        hasPersonalitySelected={hasPersonalitySelected}
        onSaveEntry={onSaveEntry}
        onDropEntry={onDropEntry}
        onAddEntry={onAddEntry}
      />
    );
  }
  return (
    <ContextGraphTree
      report={report}
      isLoading={isLoading}
      expandedKeys={expandedKeys}
      selectedNodeId={selectedNodeId}
      selectedCategory={selectedCategory}
      revealNodeId={revealNodeId}
      revealNonce={revealNonce}
      onToggle={onToggle}
      onSelectNode={onSelectNode}
      onSelectCategory={onSelectCategory}
    />
  );
}

/**
 * The phone's drill-down header. Three panes cannot coexist at that width, so
 * the pane takes the screen and this is the way back - titled with whatever the
 * pane is showing, a file's path or a prompt section's name.
 */
function CompactPaneHeader({
  node,
  category,
  iconSize,
  onBack,
}: {
  node: ContextNode | null;
  category: ContextCategory | null;
  iconSize: IconSizeProp;
  onBack: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.compactHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("contextManagement.back")}
        onPress={onBack}
        style={styles.backButton}
        hitSlop={8}
        testID="context-management-back"
      >
        <ThemedChevronLeft size={iconSize} style={styles.backIcon} />
        <Text style={styles.backLabel} numberOfLines={1}>
          {category ? t(CATEGORY_LABEL_KEYS[category]) : (node?.relPath ?? "")}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The pane before anything is picked. Before the first scan lands there is
 * nothing to pick yet, so "Pick a file" reads as a broken tab - say what is
 * actually happening instead. And a project that loads nothing is a clean slate
 * rather than an error, which is a different sentence again.
 */
function ContextFilePlaceholder({ isEmptyReport }: { isEmptyReport: boolean }): ReactElement {
  const { t } = useTranslation();
  const prefix = isEmptyReport
    ? "contextManagement.emptyState"
    : "contextManagement.filePlaceholder";
  return (
    <View style={styles.filePlaceholder}>
      <Text style={styles.placeholderTitle}>{t(`${prefix}.title`)}</Text>
      <Text style={styles.placeholderBody}>{t(`${prefix}.body`)}</Text>
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
 * on a line with no explanation - the fix list is one tab away, and the whole
 * point of the arrow was not having to hold the sentence in your head.
 */
function FindingBanner({
  message,
  iconSize,
  onDismiss,
}: {
  message: string;
  iconSize: IconSizeProp;
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
