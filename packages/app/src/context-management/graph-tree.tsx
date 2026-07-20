import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ContextNode, ContextReport } from "@otto-code/protocol/messages";
import { Link, Zap } from "@/components/icons/material-icons";
import { TreeChevron, TreeIndentGuides, TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { CATEGORY_LABEL_KEYS, formatTokens } from "./format";
import { buildContextTree, type ContextTreeRow } from "./graph-model";
import { ScopeBadge, ScopeIcon, SCOPE_ICON_SIZE } from "./scope-icon";

// Themed icons: `color` is required on every icon and `useUnistyles()` is banned
// (docs/unistyles.md), so each tint is a uniProps mapping.
const ThemedLink = withUnistyles(Link);
const ThemedZap = withUnistyles(Zap);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.mutedForeground });
const infoIconColor = (theme: Theme) => ({ color: theme.colors.statusInfo });

function keyForRow(row: ContextTreeRow): string {
  return row.key;
}

/** Enough to outlast mount + expand relayout; short enough to never spin. */
const SCROLL_RETRY_LIMIT = 5;

interface ContextGraphTreeProps {
  report: ContextReport | null;
  expandedKeys: ReadonlySet<string>;
  selectedNodeId: string | null;
  /** Bumped by the fix list to scroll that file's row into view. */
  revealNodeId?: string | null;
  revealNonce?: number;
  onToggle: (key: string) => void;
  onSelectNode: (node: ContextNode) => void;
}

/**
 * The load graph, not the filesystem. Rows carry two things a file explorer
 * never has to: whether the file is actually loaded or merely linked, and
 * whether it is scoped to this project or to every project on the machine.
 *
 * Both are icons rather than words. A tree where every other row ends in "link
 * only · when needed · Every project" is unreadable at a glance, which is the
 * one thing a tree is for.
 */
export function ContextGraphTree({
  report,
  expandedKeys,
  selectedNodeId,
  revealNodeId,
  revealNonce,
  onToggle,
  onSelectNode,
}: ContextGraphTreeProps): ReactElement {
  const { t } = useTranslation();
  const rows = useMemo(
    () => (report ? buildContextTree({ report, expandedKeys }) : []),
    [report, expandedKeys],
  );

  // Web at every width, not desktop only: the browser's default bar is the
  // thing being replaced, and it looks just as dated in a narrow window. On
  // native the hook no-ops and the platform's own indicator already auto-hides.
  const listRef = useRef<FlatList<ContextTreeRow>>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, { enabled: isWeb });

  // A reveal from the fix list has already expanded the chain, so by the time
  // this runs the row exists; the nonce is what makes revealing the same file
  // twice scroll twice.
  //
  // Revealing switches the sidebar from the fix list to this tree, so the very
  // first attempt runs against a FlatList that has just mounted and laid out
  // nothing. `scrollToIndex` cannot resolve an offset for a row that has never
  // been measured — it fails silently through `onScrollToIndexFailed`, which is
  // exactly what "the tree never scrolled" looked like. Hence: retry after
  // layout, a bounded number of times.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const retriesRef = useRef(0);

  const scrollToReveal = useCallback((nodeId: string) => {
    const index = rowsRef.current.findIndex(
      (row) => row.kind === "node" && row.node?.id === nodeId,
    );
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, []);

  useEffect(() => {
    if (!revealNodeId) return;
    retriesRef.current = 0;
    scrollToReveal(revealNodeId);
  }, [revealNodeId, revealNonce, rows, scrollToReveal]);

  const handleScrollToIndexFailed = useCallback(() => {
    if (!revealNodeId || retriesRef.current >= SCROLL_RETRY_LIMIT) return;
    retriesRef.current += 1;
    // One frame is usually enough — the failure means layout was mid-flight,
    // not that the row is missing.
    requestAnimationFrame(() => scrollToReveal(revealNodeId));
  }, [revealNodeId, scrollToReveal]);

  const renderItem = useCallback(
    ({ item }: { item: ContextTreeRow }) => (
      <ContextTreeRowView
        row={item}
        expanded={expandedKeys.has(item.key)}
        selected={item.kind === "node" && item.node?.id === selectedNodeId}
        onToggle={onToggle}
        onSelectNode={onSelectNode}
      />
    ),
    [expandedKeys, onSelectNode, onToggle, selectedNodeId],
  );

  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t("contextManagement.tree.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listWrap}>
      <FlatList
        ref={listRef}
        style={styles.list}
        data={rows}
        keyExtractor={keyForRow}
        renderItem={renderItem}
        testID="context-graph-tree"
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!isWeb}
      />
      {scrollbar.overlay}
    </View>
  );
}

interface ContextTreeRowViewProps {
  row: ContextTreeRow;
  expanded: boolean;
  selected: boolean;
  onToggle: (key: string) => void;
  onSelectNode: (node: ContextNode) => void;
}

function ContextTreeRowView({
  row,
  expanded,
  selected,
  onToggle,
  onSelectNode,
}: ContextTreeRowViewProps): ReactElement {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    if (row.kind === "node" && row.node) {
      onSelectNode(row.node);
      if (row.expandable) onToggle(row.key);
      return;
    }
    if (row.expandable) onToggle(row.key);
  }, [onSelectNode, onToggle, row]);

  const label =
    row.kind === "category"
      ? t(CATEGORY_LABEL_KEYS[row.category ?? "context_files"])
      : (row.node?.relPath ?? "");

  const rowStyle = useMemo(
    () => [
      selected ? styles.rowSelected : styles.row,
      { paddingLeft: 8 + row.depth * TREE_INDENT_PER_LEVEL },
    ],
    [row.depth, selected],
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={rowStyle}
      testID={`context-tree-row-${row.key}`}
    >
      <TreeIndentGuides depth={row.depth} />
      <View style={styles.chevronSlot}>
        {row.expandable ? <TreeChevron expanded={expanded} /> : null}
      </View>
      {/* Project scope stays unbadged here: it is the default, and a badge on
          nearly every row is noise. The fix list shows it — see scope-icon.tsx. */}
      {row.node ? <ScopeIcon scope={row.node.scope} /> : null}
      {/* Link-only: costs nothing today. Conditional: costs only when the agent
          works in that area. Both are states of the row, so they sit with the
          scope icon ahead of the name rather than trailing it as prose. */}
      {row.edgeKind === "reference" ? (
        <ScopeBadge label={t("contextManagement.tree.linkOnly")}>
          <ThemedLink size={SCOPE_ICON_SIZE} uniProps={mutedIconColor} />
        </ScopeBadge>
      ) : null}
      {row.node?.costClass === "conditional" ? (
        <ScopeBadge label={t("contextManagement.tree.conditional")}>
          <ThemedZap size={SCOPE_ICON_SIZE} uniProps={infoIconColor} />
        </ScopeBadge>
      ) : null}
      <Text
        style={row.edgeKind === "reference" ? styles.labelReferenced : styles.label}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={styles.tokens}>{formatTokens(row.estTokens)}</Text>
    </Pressable>
  );
}

// Part of Context Management's compact first screen, so every font takes the +2
// compact bump (docs convention; `md` and up stay put).
function bump(size: number) {
  return { xs: size + 2, md: size };
}

const styles = StyleSheet.create((theme) => {
  const rowBase = {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  } as const;
  const labelBase = {
    flex: 1,
    minWidth: 0,
    fontSize: bump(theme.fontSize.sm),
  } as const;
  return {
    listWrap: {
      flex: 1,
      minHeight: 0,
    },
    list: { flex: 1 },
    row: rowBase,
    rowSelected: { ...rowBase, backgroundColor: theme.colors.surface2 },
    chevronSlot: {
      width: 14,
      alignItems: "center",
      flexShrink: 0,
    },
    label: { ...labelBase, color: theme.colors.foreground },
    labelReferenced: { ...labelBase, color: theme.colors.mutedForeground },
    tokens: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.xs),
      fontVariant: ["tabular-nums"],
      flexShrink: 0,
    },
    empty: {
      padding: theme.spacing[3],
    },
    emptyText: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
    },
  };
});
