import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { HighlightToken } from "@otto-code/highlight";
import { ListChevronsDownUp, ListChevronsUpDown } from "@/components/icons/material-icons";
import { TreeChevron } from "@/components/tree-primitives";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { isWeb } from "@/constants/platform";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { compactFont, compactUp } from "@/styles/theme";

/**
 * The shared row vocabulary for the code-results tabs (Find references, Rename).
 *
 * Both tabs show the same thing — a file heading with source lines under it — so they share
 * one implementation rather than two that drift. The rows are deliberately the *diff
 * viewer's* rows: same `fontSize.code` / `lineHeight.diff` metrics, same compact bumps, same
 * syntax colours. Those two tokens are the user's Code font size setting; the earlier
 * `fontSize.xs` here was on the UI ramp instead, so these panels ignored that setting and
 * read a size smaller than every other code surface in the app.
 *
 * Strings are literal English pending the pre-release i18n sweep.
 */

/** Mirrors the diff viewer's compact bumps — see `revision-diff-body.tsx`. */
const COMPACT_CODE_FONT_BUMP = 2;
const COMPACT_LINE_HEIGHT_BUMP = 6;

export type CodeResultGutterWidth = "line" | "lineColumn";

/** `dir/parts` and `file.ts` — the tail identifies the file, the head is context. */
export function splitPath(path: string): { head: string; tail: string } {
  const normalized = path.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut === -1
    ? { head: "", tail: normalized }
    : { head: normalized.slice(0, cut), tail: normalized.slice(cut + 1) };
}

/**
 * The heading over one file's rows, and the control that folds them away. UI type, not code
 * type — this is a label, so it sits on the UI ramp at `sm` like the Changes tab's file
 * rows, and only the rows below it are mono.
 */
export function CodeResultGroupHeader({
  path,
  count,
  collapsed,
  onToggle,
  trailing,
  testID,
}: {
  path: string;
  count: number;
  collapsed: boolean;
  onToggle: (path: string) => void;
  /**
   * Per-file control parked at the end of the heading — Refine's keep/drop
   * switch. Inside the heading's own Pressable, so anything rendered here must
   * stop its own press from reaching the fold (`Switch` already does).
   */
  trailing?: ReactNode;
  testID?: string;
}) {
  const { head, tail } = useMemo(() => splitPath(path), [path]);
  const toggle = useCallback(() => onToggle(path), [onToggle, path]);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={path}
      onPress={toggle}
      style={groupHeaderStyle}
      testID={testID}
    >
      <TreeChevron expanded={!collapsed} />
      <Text style={styles.groupName} numberOfLines={1}>
        {tail}
      </Text>
      <Text style={styles.groupDir} numberOfLines={1}>
        {head}
      </Text>
      <View style={styles.spacer} />
      <Text style={styles.groupCount}>{count}</Text>
      {trailing}
    </Pressable>
  );
}

function groupHeaderStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.groupHeader, (Boolean(hovered) || pressed) && styles.groupHeaderActive];
}

/**
 * Which file groups are folded away, by path.
 *
 * Collapsed-by-exception rather than expanded-by-exception: a results list is worthless if
 * it opens closed, and the set stays small because the interesting case is folding away the
 * two noisy files, not the twenty quiet ones. Paths that vanish from the results (a
 * provisional list that re-resolves) simply stop being consulted — no reconciliation needed.
 */
export function useCollapsedGroups(): {
  isCollapsed: (path: string) => boolean;
  /** True when none of `paths` is folded — what the toolbar toggle reads. */
  allExpanded: (paths: readonly string[]) => boolean;
  toggle: (path: string) => void;
  /** Fold everything, or unfold everything if anything is already folded. */
  toggleAll: (paths: readonly string[]) => void;
} {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const isCollapsed = useCallback((path: string) => collapsed.has(path), [collapsed]);

  const allExpanded = useCallback(
    (paths: readonly string[]) => !paths.some((path) => collapsed.has(path)),
    [collapsed],
  );

  const toggle = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback((paths: readonly string[]) => {
    setCollapsed((current) =>
      paths.some((path) => current.has(path)) ? new Set() : new Set(paths),
    );
  }, []);

  return { isCollapsed, allExpanded, toggle, toggleAll };
}

const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);

/**
 * One button, not two. The list is either all open or it isn't, so only one of the two
 * actions is ever the one you want — the same shape the Changes toolbar uses.
 *
 * `ToolbarIconButton` rather than a local Pressable, because these tabs sit beside the file
 * editor in a split and their toolbars have to line up with its one pixel-for-pixel. A
 * hand-rolled button agrees with the editor's at one breakpoint and drifts at the other.
 */
export function CodeResultExpandToggle({
  allExpanded,
  onToggle,
  testID,
}: {
  allExpanded: boolean;
  onToggle: () => void;
  testID: string;
}) {
  const label = allExpanded ? "Collapse all" : "Expand all";

  return (
    <ToolbarIconButton
      label={label}
      Icon={allExpanded ? ThemedListChevronsDownUp : ThemedListChevronsUpDown}
      onPress={onToggle}
      testID={testID}
    />
  );
}

/**
 * One navigable hit.
 *
 * Hover lives on the `Pressable`'s own render prop rather than the canonical plain-`View`
 * pattern from docs/hover.md on purpose: the row styles *itself* from its own hover and
 * contains no other pressable, which is exactly the case that doc names as the render prop's.
 */
export function CodeResultRow({
  gutter,
  gutterWidth = "line",
  text,
  tokens,
  accessibilityLabel,
  onPress,
  testID,
}: {
  /** The right-aligned lane: a line number, or `line:column`. */
  gutter: string;
  gutterWidth?: CodeResultGutterWidth;
  /** Plain fallback, shown when there are no tokens to colour. */
  text: string;
  tokens?: readonly HighlightToken[] | null;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}) {
  const gutterStyle = useMemo(
    () => [styles.gutter, gutterWidth === "lineColumn" ? styles.gutterWide : styles.gutterNarrow],
    [gutterWidth],
  );

  const keyedTokens = useMemo(
    () => tokens?.map((token, index) => ({ key: `${index}:${token.text}`, token })) ?? null,
    [tokens],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={rowStyle}
      testID={testID}
    >
      <Text style={gutterStyle} numberOfLines={1}>
        {gutter}
      </Text>
      <Text style={styles.code} numberOfLines={1}>
        {keyedTokens === null
          ? text
          : keyedTokens.map(({ key, token }) => (
              <Text key={key} style={syntaxTokenStyleFor(token.style)}>
                {token.text}
              </Text>
            ))}
      </Text>
    </Pressable>
  );
}

function rowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowActive];
}

/**
 * Re-tokenize a line without its indentation, so a results row can drop the leading
 * whitespace the list has no room for without the colours sliding off the words.
 */
export function trimLeadingTokens(tokens: readonly HighlightToken[]): HighlightToken[] {
  const trimmed: HighlightToken[] = [];
  let dropping = true;
  for (const token of tokens) {
    if (!dropping) {
      trimmed.push(token);
      continue;
    }
    const stripped = token.text.replace(/^\s+/, "");
    if (stripped.length === 0) {
      continue;
    }
    dropping = false;
    trimmed.push({ text: stripped, style: token.style });
  }
  return trimmed;
}

const styles = StyleSheet.create((theme) => ({
  spacer: {
    flex: 1,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  groupHeaderActive: {
    backgroundColor: theme.colors.surface2,
  },
  groupName: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: theme.fontWeight.semibold,
    flexShrink: 0,
  },
  groupDir: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    flexShrink: 1,
  },
  groupCount: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  // No vertical padding: the row's height IS the code line box, so these rows sit at the
  // same density as the diff viewer and the editor instead of reading double-spaced.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    minHeight: compactFont(theme.lineHeight.diff, COMPACT_LINE_HEIGHT_BUMP),
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  rowActive: {
    // Translucent, so one token reads the same over the panel background as over the
    // group header's surface.
    backgroundColor: theme.colors.surfaceHover,
  },
  gutter: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.code, COMPACT_CODE_FONT_BUMP),
    lineHeight: compactFont(theme.lineHeight.diff, COMPACT_LINE_HEIGHT_BUMP),
    fontVariant: ["tabular-nums"],
    textAlign: "right",
    flexShrink: 0,
    userSelect: "none",
  },
  // Fixed lanes so the code starts at one column instead of stair-stepping with the
  // digit count.
  gutterNarrow: {
    width: compactUp(38, 1.4),
  },
  gutterWide: {
    width: compactUp(58, 1.4),
  },
  code: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.code, COMPACT_CODE_FONT_BUMP),
    lineHeight: compactFont(theme.lineHeight.diff, COMPACT_LINE_HEIGHT_BUMP),
    flexShrink: 1,
  },
}));
