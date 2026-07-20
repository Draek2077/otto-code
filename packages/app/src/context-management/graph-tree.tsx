import { useCallback, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ContextNode, ContextReport, ContextScope } from "@otto-code/protocol/messages";
import { FolderTree, Globe, Home, Link, Shield, Zap } from "@/components/icons/material-icons";
import { TreeChevron, TreeIndentGuides, TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { CATEGORY_LABEL_KEYS, formatTokens } from "./format";
import { buildContextTree, type ContextTreeRow } from "./graph-model";

const BADGE_ICON_SIZE = 13;

// Themed icons: `color` is required on every icon and `useUnistyles()` is banned
// (docs/unistyles.md), so each tint is a uniProps mapping.
const ThemedGlobe = withUnistyles(Globe);
const ThemedHome = withUnistyles(Home);
const ThemedShield = withUnistyles(Shield);
const ThemedFolderTree = withUnistyles(FolderTree);
const ThemedLink = withUnistyles(Link);
const ThemedZap = withUnistyles(Zap);

const warningIconColor = (theme: Theme) => ({ color: theme.colors.statusWarning });
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.mutedForeground });
const infoIconColor = (theme: Theme) => ({ color: theme.colors.statusInfo });

const SCOPE_LABEL_KEYS: Record<ContextScope, string | null> = {
  enterprise: "contextManagement.scope.enterprise",
  global: "contextManagement.scope.global",
  local: "contextManagement.scope.local",
  subdirectory: "contextManagement.scope.subdirectory",
  // Project scope is the default and runtime rows are not files — neither
  // earns a badge.
  project: null,
  runtime: null,
};

function keyForRow(row: ContextTreeRow): string {
  return row.key;
}

interface ContextGraphTreeProps {
  report: ContextReport | null;
  expandedKeys: ReadonlySet<string>;
  selectedNodeId: string | null;
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
      {row.node ? <ScopeIcon scope={row.node.scope} /> : null}
      {/* Link-only: costs nothing today. Conditional: costs only when the agent
          works in that area. Both are states of the row, so they sit with the
          scope icon ahead of the name rather than trailing it as prose. */}
      {row.edgeKind === "reference" ? (
        <BadgeIcon label={t("contextManagement.tree.linkOnly")}>
          <ThemedLink size={BADGE_ICON_SIZE} uniProps={mutedIconColor} />
        </BadgeIcon>
      ) : null}
      {row.node?.costClass === "conditional" ? (
        <BadgeIcon label={t("contextManagement.tree.conditional")}>
          <ThemedZap size={BADGE_ICON_SIZE} uniProps={infoIconColor} />
        </BadgeIcon>
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

/**
 * Icons carry no text, so the meaning lives in the tooltip and the a11y label.
 *
 * `asChild` around a plain View is load-bearing: the trigger clones hover and
 * focus handlers onto the View instead of wrapping it in a Pressable, so a
 * click on the icon still reaches the row's own Pressable and selects the file.
 * A nested Pressable would swallow it. Same idiom as LockedAgentModeBadge.
 * Hover-only — on touch there is nothing to hover, and the label covers a11y.
 */
function BadgeIcon({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View
          collapsable={false}
          accessibilityRole="image"
          accessibilityLabel={label}
          style={styles.badgeIcon}
        >
          {children}
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Scope is not decoration. Editing a `global` file changes every project on the
 * machine, and a user who does not know that will be surprised later — which is
 * why it is the one scope that keeps the warning tint.
 */
function ScopeIcon({ scope }: { scope: ContextScope }): ReactElement | null {
  const { t } = useTranslation();
  const key = SCOPE_LABEL_KEYS[scope];
  if (!key) return null;
  const label = t(key);
  if (scope === "global") {
    return (
      <BadgeIcon label={label}>
        <ThemedGlobe size={BADGE_ICON_SIZE} uniProps={warningIconColor} />
      </BadgeIcon>
    );
  }
  if (scope === "enterprise") {
    return (
      <BadgeIcon label={label}>
        <ThemedShield size={BADGE_ICON_SIZE} uniProps={mutedIconColor} />
      </BadgeIcon>
    );
  }
  if (scope === "subdirectory") {
    return (
      <BadgeIcon label={label}>
        <ThemedFolderTree size={BADGE_ICON_SIZE} uniProps={mutedIconColor} />
      </BadgeIcon>
    );
  }
  return (
    <BadgeIcon label={label}>
      <ThemedHome size={BADGE_ICON_SIZE} uniProps={mutedIconColor} />
    </BadgeIcon>
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
    badgeIcon: {
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
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
    tooltipText: {
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.xs),
    },
  };
});
