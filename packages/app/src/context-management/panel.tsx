import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ContextNode } from "@otto-code/protocol/messages";
import { FileTabPane } from "@/components/file-tab-pane";
import { ChevronLeft } from "@/components/icons/material-icons";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { ContextFindingsList } from "./findings-list";
import { ContextGraphTree } from "./graph-tree";
import { ContextSidebarTabs, type ContextSidebarTab } from "./sidebar-tabs";
import {
  defaultExpandedKeys,
  findInboundEdge,
  pickInitialNode,
  splitAbsolutePath,
} from "./graph-model";
import { LoadModeControl } from "./load-mode-control";
import { ContextSummary } from "./summary";
import { useContextReportQuery } from "./use-context-report";

const DEFAULT_WINDOW_TOKENS = 200_000;

// Theme-reactive icon color without useUnistyles (docs/unistyles.md).
const ThemedChevronLeft = withUnistyles(ChevronLeft);

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

  // One tabbed body, rendered identically in both layouts — only its container
  // differs (a fixed sidebar column vs. a block in the phone's scroll).
  const sidebarBody =
    sidebarTab === "findings" ? (
      <ContextFindingsList report={report} onSelectNode={handleSelectNode} />
    ) : (
      <ContextGraphTree
        report={report}
        expandedKeys={expandedKeys}
        selectedNodeId={selectedNode?.id ?? null}
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
    if (isCompact) {
      return (
        <View style={styles.fill}>
          {loadModeControl}
          <View style={styles.fill}>
            <ContextFilePane
              serverId={serverId}
              workspaceId={workspaceId}
              absolutePath={selectedNode.path}
              toolbarLeadingSlot={null}
            />
          </View>
        </View>
      );
    }
    return (
      <ContextFilePane
        serverId={serverId}
        workspaceId={workspaceId}
        absolutePath={selectedNode.path}
        toolbarLeadingSlot={loadModeControl}
      />
    );
  }, [isCompact, loadModeControl, report, selectedNode, serverId, t, workspaceId]);

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
              <ThemedChevronLeft size={18} style={styles.backIcon} />
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
      <View style={styles.fill}>{filePane}</View>
    </View>
  );
}

interface ContextFilePaneProps {
  serverId: string;
  workspaceId: string;
  absolutePath: string;
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
  toolbarLeadingSlot,
}: ContextFilePaneProps): ReactElement {
  const { dir, base } = useMemo(() => splitAbsolutePath(absolutePath), [absolutePath]);
  const location = useMemo(() => ({ path: base }), [base]);
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
    width: 320,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
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
