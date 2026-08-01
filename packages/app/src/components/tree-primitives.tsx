import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "@/components/icons/material-icons";
import { TREE_RAILS_ALL_CONTINUE, treeRailContinuesAt } from "@/components/tree-rail-mask";
import { compactUp, SPACING, useIconSize, type Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

// Shared presentation primitives for the app's directory trees. Both the Files
// explorer (server-loaded listings) and the Changes view (client-built from diff
// paths) render different data, but their ROWS should look identical — same
// indentation, guide lines, and chevron. Keep those here so the two trees can't
// drift apart.
export const TREE_INDENT_PER_LEVEL = 16;
/** Shared vertical padding for file-tree rows, so diff and explorer rows align. */
export const WORKSPACE_FILE_ROW_VERTICAL_PADDING = SPACING[1.5];

// Length of the horizontal tick that branches off the deepest rail into a nested
// row. Kept just short of the row's own content padding (8px in the explorer and
// graph trees, 12px in the Changes tree) so the tick never runs under the icon.
const TREE_CONNECTOR_WIDTH = 8;

/** Left padding for a tree row at `depth`. Shared by folder rows and file headers
 * in the Changes tree so their indentation can't drift apart. */
export function treeRowPaddingLeft(depth: number): number {
  return SPACING[3] + depth * TREE_INDENT_PER_LEVEL;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedChevronRight = withUnistyles(ChevronRight);

function indentGuideLeft(index: number): number {
  return SPACING[3] + index * TREE_INDENT_PER_LEVEL + 4;
}

/**
 * Vertical guide lines connecting nested rows to their ancestors — one line per
 * ancestor depth level, positioned absolutely within the (relative) row — plus a
 * horizontal tick branching off the deepest rail into this row. Renders nothing
 * at depth 0.
 *
 * `ancestorMask` (see tree-rail-mask.ts) decides how each rail terminates: full
 * height while that branch has more rows below, half height meeting the tick when
 * this row is the last of its group (└), and absent entirely once an ancestor's
 * branch has already closed. Callers that don't track sibling position get the
 * old look — every rail full height — by leaving it unset.
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
  const iconSize = useIconSize();
  return (
    <View style={expanded ? CHEVRON_EXPANDED_STYLE : styles.chevron}>
      <ThemedChevronRight size={iconSize.md} uniProps={foregroundMutedIconColorMapping} />
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
    // Doubled on compact to wrap the chevron icon's compact upscale.
    width: compactUp(16),
    height: compactUp(16),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
}));

// Stable module-level style ref so TreeChevron passes a constant array, not one created
// per render — satisfies react-perf (no inline-array prop) without a per-render useMemo.
const CHEVRON_EXPANDED_STYLE = [styles.chevron, styles.chevronExpanded];
