import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DiffStat } from "@/components/diff-stat";
import { FILE_ACTIONS_MENU_WIDTH } from "@/components/file-actions-menu";
import { Folder } from "@/components/icons/material-icons";
import {
  TreeChevron,
  TreeIndentGuides,
  treeRowPaddingLeft,
  WORKSPACE_FILE_ROW_VERTICAL_PADDING,
} from "@/components/tree-primitives";
import { useIconSize, type Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedFolder = withUnistyles(Folder);

interface DiffFolderRowProps {
  /** full uncompressed directory path - the collapse identity */
  dirPath: string;
  displayName: string;
  depth: number;
  /** which indent rails keep running below this row - see tree-rail-mask.ts */
  ancestorMask: number;
  collapsed: boolean;
  additions: number;
  deletions: number;
  onToggle: (dirPath: string) => void;
  onHeightChange?: (height: number) => void;
  testID?: string;
}

function folderRowPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  // Subtle background highlight on hover/press, matching the Files explorer rows
  // (entryRowActive) - no opacity darken.
  return [styles.folderRow, (Boolean(hovered) || pressed) && styles.folderRowActive];
}

export function DiffFolderRow({
  dirPath,
  displayName,
  depth,
  ancestorMask,
  collapsed,
  additions,
  deletions,
  onToggle,
  onHeightChange,
  testID,
}: DiffFolderRowProps) {
  const iconSize = useIconSize();
  const handlePress = useCallback(() => {
    onToggle(dirPath);
  }, [dirPath, onToggle]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onHeightChange?.(event.nativeEvent.layout.height);
    },
    [onHeightChange],
  );

  const leftStyle = useMemo(
    () => [styles.left, inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(depth) })],
    [depth],
  );

  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <View style={styles.container} onLayout={handleLayout} testID={testID}>
      <TreeIndentGuides depth={depth} ancestorMask={ancestorMask} />
      <Pressable
        onPress={handlePress}
        style={folderRowPressableStyle}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <View style={leftStyle}>
          <TreeChevron expanded={!collapsed} />
          <View style={styles.folderLabel}>
            <ThemedFolder size={iconSize.md} uniProps={mutedIconColor} />
            <Text style={styles.folderName} numberOfLines={1}>
              {displayName}
            </Text>
          </View>
        </View>
        <View style={styles.right}>
          <DiffStat
            additions={additions}
            deletions={deletions}
            testID={testID ? `${testID}-stat` : undefined}
          />
          <View style={styles.actionSlot} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    overflow: "hidden",
  },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing[3],
    paddingVertical: WORKSPACE_FILE_ROW_VERTICAL_PADDING,
    gap: theme.spacing[1],
    minWidth: 0,
  },
  folderRowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  folderLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    // Match the folder glyph to the icon column of a child file. The chevron
    // already owns the preceding disclosure column.
    marginLeft: -theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
  },
  actionSlot: {
    width: FILE_ACTIONS_MENU_WIDTH,
  },
  folderName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
    marginLeft: 2,
    minWidth: 0,
  },
}));
