import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, Text, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgXml } from "react-native-svg";
import type { SolutionProjectContents } from "@otto-code/client/internal/daemon-client";
import { getFileIconSvg } from "@/components/file-icon-svg";
import { Blocks, Boxes, FolderOpen, TriangleAlert } from "@/components/icons/material-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TreeChevron, TreeIndentGuides, TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { compactUp, SPACING, useIconSize, type Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import {
  buildSolutionRows,
  collapsedKey,
  type SolutionRow,
  type SolutionViewNode,
} from "./solution-rows";
import { useSolutionProjectQuery, useSolutionTreeQuery } from "./use-solution-queries";

// Icon colours have to reach React as props, so each icon is wrapped individually rather than the
// component subscribing to the whole runtime. `useUnistyles()` is banned - see docs/unistyles.md.
const ThemedBoxes = withUnistyles(Boxes);
const ThemedBlocks = withUnistyles(Blocks);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const primaryColor = (theme: Theme) => ({ color: theme.colors.primary });
const destructiveColor = (theme: Theme) => ({ color: theme.colors.destructive });

/**
 * The Solution lens: the tree as the build system sees it.
 *
 * Its own component rather than more branches inside `file-explorer-pane.tsx`, which is already
 * near its complexity cap - but deliberately **inside the Files tab**, not a fourth tab. It is a
 * second view of the same thing, and the precedent is the Changes pane's tree-vs-flat toggle.
 *
 * Row chrome, indent guides, chevrons and file icons are reused unchanged from
 * `tree-primitives.tsx`, so the two lenses look like one module rather than two features.
 */

interface SolutionTreePaneProps {
  serverId: string;
  cwd: string;
  /** Workspace-relative, from the switcher's picker. */
  solutionPath: string | null;
  onOpenFile: (path: string) => void;
  selectedPath: string | null;
}

export function SolutionTreePane(props: SolutionTreePaneProps) {
  const { t } = useTranslation();
  const listRef = useRef<FlatList<SolutionRow>>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, { enabled: isWeb });

  const {
    tree,
    isLoading: isTreeLoading,
    error,
  } = useSolutionTreeQuery({
    serverId: props.serverId,
    cwd: props.cwd,
    solutionPath: props.solutionPath,
    enabled: props.solutionPath !== null,
  });

  // Solution folders start open: the whole point of the lens is seeing the organisation, and a
  // tree that opens fully collapsed shows nothing but two folder names.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string> | null>(null);
  const effectiveExpanded = useMemo(() => {
    if (expandedIds !== null) {
      return expandedIds;
    }
    return new Set((tree?.folders ?? []).map((folder) => folder.path));
  }, [expandedIds, tree]);

  /**
   * Which project the user most recently expanded. One at a time on purpose: each expansion is an
   * MSBuild evaluation, and firing them for every project the user has ever opened would turn a
   * cheap lazy design back into the eager one it replaced. Already-fetched projects stay in the
   * query cache, so re-expanding is free.
   */
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const { project: activeProject, isLoading: isProjectLoading } = useSolutionProjectQuery({
    serverId: props.serverId,
    cwd: props.cwd,
    solutionPath: props.solutionPath,
    projectPath: activeProjectPath,
    enabled: activeProjectPath !== null,
  });

  /**
   * Projects fetched so far, accumulated so one stays rendered after the next is expanded. The
   * query cache is the source of truth for each payload; this only remembers which ones the tree
   * is currently showing.
   */
  const [projects, setProjects] = useState<Map<string, SolutionProjectContents>>(() => new Map());
  useEffect(() => {
    if (activeProjectPath === null || activeProject === null) {
      return;
    }
    setProjects((current) =>
      current.get(activeProjectPath) === activeProject
        ? current
        : new Map(current).set(activeProjectPath, activeProject),
    );
  }, [activeProject, activeProjectPath]);

  // A different solution is a different tree; keeping the old projects would render nodes the new
  // solution does not contain.
  useEffect(() => {
    setProjects(new Map());
    setActiveProjectPath(null);
    setExpandedIds(null);
  }, [props.solutionPath]);

  const rows = useMemo(
    () => buildSolutionRows({ tree, projects, expandedIds: effectiveExpanded }),
    [tree, projects, effectiveExpanded],
  );

  const toggle = useCallback(
    (id: string) => {
      setExpandedIds((current) => {
        const base = new Set(current ?? effectiveExpanded);
        if (base.has(id)) {
          base.delete(id);
        } else {
          base.add(id);
        }
        return base;
      });
    },
    [effectiveExpanded],
  );

  const handlePress = useCallback(
    (node: SolutionViewNode) => {
      switch (node.kind) {
        case "folder":
          toggle(node.id);
          return;
        case "solutionProject":
          if (!effectiveExpanded.has(node.id)) {
            setActiveProjectPath(node.path);
          }
          toggle(node.id);
          return;
        case "directory":
          // Inverted: directories inside a project default to expanded, so the set stores the
          // collapsed ones.
          toggle(collapsedKey(node.id));
          return;
        case "file":
          props.onOpenFile(node.path);
      }
    },
    [effectiveExpanded, props, toggle],
  );

  const renderRow = useCallback(
    (info: ListRenderItemInfo<SolutionRow>): ReactElement => (
      <SolutionRowItem
        row={info.item}
        isExpanded={isRowExpanded(info.item.node, effectiveExpanded)}
        isSelected={"path" in info.item.node && info.item.node.path === props.selectedPath}
        isLoading={
          info.item.node.kind === "solutionProject" &&
          isProjectLoading &&
          info.item.node.path === activeProjectPath
        }
        onPress={handlePress}
      />
    ),
    [activeProjectPath, effectiveExpanded, handlePress, isProjectLoading, props.selectedPath],
  );

  if (error !== null) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (isTreeLoading || tree === null) {
    return (
      <View style={styles.centerState}>
        <ThemedLoadingSpinner size="lg" uniProps={mutedColor} />
        <Text style={styles.mutedText}>{t("workspace.solution.loading")}</Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.mutedText}>{t("workspace.solution.empty")}</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        ref={listRef}
        style={styles.list}
        data={rows}
        renderItem={renderRow}
        keyExtractor={rowKey}
        testID="solution-tree-scroll"
        contentContainerStyle={styles.listContent}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!isWeb}
        initialNumToRender={24}
        maxToRenderPerBatch={40}
        windowSize={12}
      />
      {scrollbar.overlay}
    </>
  );
}

function rowKey(row: SolutionRow): string {
  return `${row.node.kind}:${row.node.id}`;
}

function isRowExpanded(node: SolutionViewNode, expanded: ReadonlySet<string>): boolean {
  if (node.kind === "directory") {
    return !expanded.has(collapsedKey(node.id));
  }
  return expanded.has(node.id);
}

function SolutionRowItem({
  row,
  isExpanded,
  isSelected,
  isLoading,
  onPress,
}: {
  row: SolutionRow;
  isExpanded: boolean;
  isSelected: boolean;
  isLoading: boolean;
  onPress: (node: SolutionViewNode) => void;
}) {
  const { t } = useTranslation();
  const iconSize = useIconSize();
  const [isHovered, setIsHovered] = useState(false);
  const node = row.node;

  const handlePress = useCallback(() => onPress(node), [node, onPress]);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.row,
      // Same computation the Files lens does. `SPACING` is a static import, which docs/unistyles.md
      // sanctions precisely so a fixed number does not need a runtime subscription.
      { paddingLeft: SPACING[2] + row.depth * TREE_INDENT_PER_LEVEL },
      isSelected && styles.rowSelected,
      isHovered && !pressed && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isHovered, isSelected, row.depth],
  );

  return (
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <Pressable onPress={handlePress} style={pressableStyle} testID={`solution-row-${node.id}`}>
        <TreeIndentGuides depth={row.depth} ancestorMask={row.ancestorMask} />
        <View style={styles.rowInfo}>
          <View style={styles.rowIcon}>
            <RowIcon node={node} isExpanded={isExpanded} isLoading={isLoading} />
          </View>
          <Text style={styles.rowName} numberOfLines={1}>
            {node.name}
          </Text>
          <RowSuffix node={node} />
        </View>
        {node.kind === "solutionProject" && node.status === "failed" ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger hitSlop={8} accessibilityLabel={t("workspace.solution.projectFailed")}>
              <ThemedTriangleAlert size={iconSize.sm} uniProps={destructiveColor} />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" offset={8}>
              {/* MSBuild's own words. A generic "failed to load" would leave the user with
                  nothing to act on, and the build system already wrote the useful sentence. */}
              <Text style={styles.tooltipText}>
                {node.error ?? t("workspace.solution.projectFailed")}
              </Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </Pressable>
    </View>
  );
}

function RowIcon({
  node,
  isExpanded,
  isLoading,
}: {
  node: SolutionViewNode;
  isExpanded: boolean;
  isLoading: boolean;
}) {
  const iconSize = useIconSize();

  if (isLoading) {
    return <ThemedLoadingSpinner size={iconSize.sm} uniProps={mutedColor} />;
  }
  switch (node.kind) {
    case "folder":
      // A solution folder is virtual - it has no filesystem location - so it deliberately does
      // not borrow the file explorer's folder glyph.
      return <ThemedBoxes size={iconSize.md} uniProps={mutedColor} />;
    case "solutionProject":
      return <ThemedBlocks size={iconSize.md} uniProps={primaryColor} />;
    case "directory":
      return isExpanded ? (
        <ThemedFolderOpen size={iconSize.md} uniProps={mutedColor} />
      ) : (
        <TreeChevron expanded={false} />
      );
    case "file":
      return <SvgXml xml={getFileIconSvg(node.name)} width={iconSize.md} height={iconSize.md} />;
  }
}

/**
 * The small facts worth carrying on the row itself: a project's target framework, and the badge
 * for a project the solution names outside this workspace. Everything else stays out - a tree row
 * that reads like a table is a tree nobody scans.
 */
function RowSuffix({ node }: { node: SolutionViewNode }) {
  const { t } = useTranslation();

  if (node.kind !== "solutionProject") {
    return null;
  }
  return (
    <View style={styles.suffix}>
      {node.targetFrameworks.length > 0 ? (
        <Text style={styles.suffixText} numberOfLines={1}>
          {node.targetFrameworks.join(", ")}
        </Text>
      ) : null}
      {node.outsideWorkspace ? (
        <Text style={styles.outsideBadge} numberOfLines={1}>
          {t("workspace.solution.outsideWorkspace")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  // Matches the Files lens's row metrics exactly, so switching lenses does not shift the tree.
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: compactUp(34, 1.5),
    paddingVertical: 2,
    // `paddingLeft` is set inline per row, since it carries the depth indent.
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceInteractiveSelected,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceInteractivePressed,
  },
  rowInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  rowIcon: {
    flexShrink: 0,
  },
  rowName: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
  },
  suffix: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  suffixText: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
  },
  outsideBadge: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
