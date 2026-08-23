import { useCallback, useMemo } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { View, Text, type LayoutChangeEvent, type PressableStateCallbackType } from "react-native";
import { DiffStat } from "@/components/diff-stat";
import { Folder } from "@/components/icons/material-icons";
import {
  TreeChevron,
  TreeIndentGuides,
  treeRowPaddingLeft,
  useTreeIconSize,
  WORKSPACE_FILE_ROW_VERTICAL_PADDING,
  WORKSPACE_TREE_ICON_LABEL_GAP,
  WORKSPACE_TREE_ICON_FRAME_SIZE,
} from "@/components/tree-primitives";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import { isWeb } from "@/constants/platform";

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
  isSelected?: boolean;
  additions: number;
  deletions: number;
  onToggle: (dirPath: string) => void;
  onCollapse?: (dirPath: string) => void;
  onSelect?: (dirPath: string) => void;
  onHeightChange?: (height: number) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onReveal?: (path: string) => void;
  revealTargetName?: string;
  onDuplicate?: (path: string) => void;
  testID?: string;
}

function folderRowPressableStyle(
  { hovered, pressed }: PressableStateCallbackType & { hovered?: boolean },
  isSelected: boolean,
) {
  return [styles.folderRow, (Boolean(hovered) || pressed || isSelected) && styles.folderRowActive];
}

export function DiffFolderRow({
  dirPath,
  displayName,
  depth,
  ancestorMask,
  collapsed,
  isSelected = false,
  additions,
  deletions,
  onToggle,
  onCollapse,
  onSelect,
  onHeightChange,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDuplicate,
  testID,
}: DiffFolderRowProps) {
  const treeIconSize = useTreeIconSize();
  const handleSelect = useCallback(() => {
    onSelect?.(dirPath);
  }, [dirPath, onSelect]);
  const handlePress = useCallback(() => {
    const selection = isWeb ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return;
    }
    handleSelect();
    onToggle(dirPath);
  }, [dirPath, handleSelect, onToggle]);

  const pressableStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      folderRowPressableStyle(state, isSelected),
    [isSelected],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onHeightChange?.(event.nativeEvent.layout.height);
    },
    [onHeightChange],
  );

  const handleCollapse = useCallback(() => {
    onCollapse?.(dirPath);
  }, [dirPath, onCollapse]);

  const handleCopyPath = useCallback(() => {
    onCopyPath?.(dirPath);
  }, [dirPath, onCopyPath]);

  const handleCopyRelativePath = useCallback(() => {
    onCopyRelativePath?.(dirPath);
  }, [dirPath, onCopyRelativePath]);

  const handleReveal = useCallback(() => {
    onReveal?.(dirPath);
  }, [dirPath, onReveal]);

  const handleDuplicate = useCallback(() => {
    onDuplicate?.(dirPath);
  }, [dirPath, onDuplicate]);

  const leftStyle = useMemo(
    () => [styles.left, inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(depth) })],
    [depth],
  );

  const accessibilityState = useMemo(
    () => ({ expanded: !collapsed, selected: isSelected }),
    [collapsed, isSelected],
  );

  return (
    <View style={styles.container} onLayout={handleLayout} testID={testID}>
      <TreeIndentGuides depth={depth} ancestorMask={ancestorMask} />
      <ContextMenu>
        <ContextMenuTrigger
          onPress={handlePress}
          onLongPress={handleSelect}
          onContextMenu={handleSelect}
          style={pressableStyle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          aria-selected={isSelected}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          <View style={leftStyle}>
            <View style={styles.chevronSlot}>
              <TreeChevron expanded={!collapsed} />
            </View>
            <View style={styles.folderLabel}>
              <ThemedFolder size={treeIconSize} uniProps={mutedIconColor} />
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
          </View>
        </ContextMenuTrigger>
        <FileActionsContextMenuContent
          fileKind="directory"
          onCollapseFolder={!collapsed && onCollapse ? handleCollapse : undefined}
          onCopyPath={onCopyPath ? handleCopyPath : undefined}
          onCopyRelativePath={onCopyRelativePath ? handleCopyRelativePath : undefined}
          onReveal={onReveal ? handleReveal : undefined}
          revealTargetName={revealTargetName}
          onDuplicate={onDuplicate ? handleDuplicate : undefined}
          testIDPrefix={testID}
        />
      </ContextMenu>
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
    // Same trailing inset as a file row (diff-pane's fileHeader), so folder and
    // file diff stats land on one right edge instead of two. The -1 is measured,
    // not arbitrary: a folder row's stat still landed 1px inside the file rows'
    // right edge at a matched 8px padding.
    paddingRight: theme.spacing[2] - 1,
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
    gap: WORKSPACE_TREE_ICON_LABEL_GAP,
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
  chevronSlot: {
    width: WORKSPACE_TREE_ICON_FRAME_SIZE,
    height: WORKSPACE_TREE_ICON_FRAME_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
  },
  folderName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
    marginLeft: 2,
    minWidth: 0,
    userSelect: "none",
  },
}));
