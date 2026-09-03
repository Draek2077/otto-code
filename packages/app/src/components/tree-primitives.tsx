import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "@/components/icons/material-icons";
import { TREE_RAILS_ALL_CONTINUE, treeRailContinuesAt } from "@/components/tree-rail-mask";
import { compactUp, SPACING, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

// Shared presentation primitives for the app's directory trees. Both the Files
// explorer (server-loaded listings) and the Changes view (client-built from diff
// paths) render different data, but their ROWS should look identical - same
// indentation, guide lines, and chevron. Keep those here so the two trees can't
// drift apart.
export const TREE_INDENT_PER_LEVEL = 16;
/** Shared vertical padding for file-tree rows, so diff and explorer rows align. */
export const WORKSPACE_FILE_ROW_VERTICAL_PADDING = SPACING[1.5];
export const WORKSPACE_TREE_ICON_SIZE = 16;
export const WORKSPACE_TREE_LOADING_ICON_SIZE = 14;
/**
 * How much bigger a tree glyph gets on a compact form factor.
 *
 * Gentler than the app-wide 2x, because these rows are a dense list rather than chrome: a 32pt
 * glyph makes a 32pt row a 48pt one, and a screenful of files then scrolls a third less content.
 * 1.5x lands the row on the same ~36pt pitch as a sidebar workspace row, which is a comfortable
 * touch target, with a glyph that is still unmistakably bigger than the desktop one.
 *
 * Frame and glyph move together, always. A frame that scales while its glyph does not is what
 * left the icon column looking empty, the rows looking too tall, and - where two glyphs share one
 * slot, as a folder row's chevron and folder do - the second glyph squeezed out of the row.
 */
export const TREE_ICON_COMPACT_SCALE = 1.5;
export const WORKSPACE_TREE_ICON_FRAME_SIZE = compactUp(
  WORKSPACE_TREE_ICON_SIZE,
  TREE_ICON_COMPACT_SCALE,
);
/** A directory row's leading slot: the disclosure chevron and the folder glyph, side by side. */
export const WORKSPACE_TREE_DIRECTORY_ICON_FRAME_SIZE = compactUp(
  WORKSPACE_TREE_ICON_SIZE * 2,
  TREE_ICON_COMPACT_SCALE,
);

/**
 * The glyph size that fills {@link WORKSPACE_TREE_ICON_FRAME_SIZE}. A plain `size` prop never
 * sees the ambient compact patch, so every tree glyph reads it from here.
 */
export function useTreeIconSize(): number {
  const isCompact = useIsCompactFormFactor();
  return isCompact ? WORKSPACE_TREE_ICON_SIZE * TREE_ICON_COMPACT_SCALE : WORKSPACE_TREE_ICON_SIZE;
}
export const WORKSPACE_TREE_ICON_LABEL_GAP = SPACING[2];
/**
 * Trailing glyph rail shared with the explorer X and Changes options chevron.
 * The extra 2px is optical: text ink ends inside its layout box, while the
 * header icons' strokes extend to theirs.
 */
export const WORKSPACE_FILE_ROW_TRAILING_PADDING = SPACING[4] + 2;

// The rail is centered on the disclosure slot. The connector stops at the child
// slot's leading edge, leaving the child chevron clear instead of running through it.
const TREE_ICON_CENTER_OFFSET = WORKSPACE_TREE_ICON_SIZE / 2;
const TREE_CONNECTOR_WIDTH = TREE_INDENT_PER_LEVEL - TREE_ICON_CENTER_OFFSET;

/** Left padding for a tree row at `depth`. Shared by folder rows and file headers
 * in the Changes tree so their indentation can't drift apart. */
export function treeRowPaddingLeft(depth: number): number {
  return SPACING[3] + depth * TREE_INDENT_PER_LEVEL;
}

const foregroundExtraMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
});

const ThemedChevronRight = withUnistyles(ChevronRight);

function indentGuideLeft(index: number): number {
  return SPACING[3] + index * TREE_INDENT_PER_LEVEL + TREE_ICON_CENTER_OFFSET;
}

/**
 * Vertical guide lines connecting nested rows to their ancestors - one line per
 * ancestor depth level, positioned absolutely within the (relative) row - plus a
 * horizontal tick branching off the deepest rail into this row. Renders nothing
 * at depth 0.
 *
 * `ancestorMask` (see tree-rail-mask.ts) decides how each rail terminates: full
 * height while that branch has more rows below, half height meeting the tick when
 * this row is the last of its group (└), and absent entirely once an ancestor's
 * branch has already closed. Callers that don't track sibling position get the
 * old look - every rail full height - by leaving it unset.
 */
export function TreeIndentGuides({
  depth,
  ancestorMask = TREE_RAILS_ALL_CONTINUE,
}: {
  depth: number;
  ancestorMask?: number;
}) {
  const guides = useMemo(() => {
    const rails: { key: number; style: ReturnType<typeof inlineUnistylesStyle>[] }[] = [];
    for (let index = 0; index < depth; index += 1) {
      // Column `index` carries the rail of the node one level deeper than it sits;
      // the innermost column (index === depth - 1) is this row's own group.
      const railDepth = index + 1;
      const continues = treeRailContinuesAt(ancestorMask, railDepth);
      if (!continues && railDepth !== depth) {
        continue;
      }
      rails.push({
        key: index,
        style: [
          continues ? styles.indentGuide : styles.indentGuideClosing,
          inlineUnistylesStyle({ left: indentGuideLeft(index) }),
        ],
      });
    }
    return rails;
  }, [depth, ancestorMask]);
  const connectorStyle = useMemo(
    () =>
      depth > 0
        ? [styles.indentConnector, inlineUnistylesStyle({ left: indentGuideLeft(depth - 1) })]
        : null,
    [depth],
  );
  return (
    <>
      {guides.map((guide) => (
        <View key={guide.key} style={guide.style} pointerEvents="none" />
      ))}
      {connectorStyle ? <View style={connectorStyle} pointerEvents="none" /> : null}
    </>
  );
}

/** Rotating disclosure chevron for a directory row (points right; rotates down when expanded). */
export function TreeChevron({ expanded }: { expanded: boolean }) {
  const iconSize = useTreeIconSize();
  return (
    <View style={expanded ? CHEVRON_EXPANDED_STYLE : styles.chevron}>
      <ThemedChevronRight size={iconSize} uniProps={foregroundExtraMutedIconColorMapping} />
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  indentGuide: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.colors.surface2,
  },
  // Last child of its group: the rail stops dead at the connector, forming a └.
  indentGuideClosing: {
    position: "absolute",
    top: 0,
    height: "50%",
    width: 1,
    backgroundColor: theme.colors.surface2,
  },
  indentConnector: {
    position: "absolute",
    top: "50%",
    height: 1,
    width: TREE_CONNECTOR_WIDTH,
    backgroundColor: theme.colors.surface2,
  },
  chevron: {
    width: WORKSPACE_TREE_ICON_FRAME_SIZE,
    height: WORKSPACE_TREE_ICON_FRAME_SIZE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
}));

// Stable module-level style ref so TreeChevron passes a constant array, not one created
// per render - satisfies react-perf (no inline-array prop) without a per-render useMemo.
const CHEVRON_EXPANDED_STYLE = [styles.chevron, styles.chevronExpanded];

/**
 * Trailing glyph rail shared with the explorer X and Changes options chevron.
 * The extra 2px is optical: text ink ends inside its layout box, while the
 * header icons' strokes extend to theirs.
 */
/** Shared painted-edge rail for pane headers, toolbars, and tree/diff rows. */
export const WORKSPACE_PANE_TRAILING_GLYPH_RAIL = SPACING[2];

export const workspaceTreeRowStyles = StyleSheet.create((theme: Theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: WORKSPACE_FILE_ROW_VERTICAL_PADDING,
    paddingRight: WORKSPACE_PANE_TRAILING_GLYPH_RAIL,
  },
  active: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // Row names sit at the explorer's size, not the diff document header's. FileHeader
  // shares one name style with that header, so the tree size has to be reasserted
  // here or Changes file rows render a step larger than the folder rows beside them.
  name: { fontSize: theme.fontSize.sm, color: theme.colors.foreground, opacity: 0.76 },
  nameHovered: { opacity: 1 },
}));
