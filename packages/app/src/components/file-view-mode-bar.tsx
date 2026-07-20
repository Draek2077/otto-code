import { useCallback, useMemo } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Columns2, Eye, SquarePen } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FileViewMode } from "@/stores/file-view-store";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";

// The file tab's three-way view switch: editor, editor+preview split,
// preview. Icon-only with tooltips; exactly one mode is selected.

const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedEye = withUnistyles(Eye);

const selectedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type ModeIcon = typeof ThemedSquarePen;

function FileViewModeButton({
  mode,
  label,
  Icon,
  iconSize,
  selected,
  onChange,
}: {
  mode: FileViewMode;
  label: string;
  Icon: ModeIcon;
  iconSize: number;
  selected: boolean;
  onChange: (mode: FileViewMode) => void;
}) {
  const handlePress = useCallback(() => {
    onChange(mode);
  }, [mode, onChange]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.modeButton,
      (Boolean(hovered) || pressed) && styles.modeButtonHovered,
      selected && styles.modeButtonSelected,
    ],
    [selected],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        testID={`file-view-mode-${mode}`}
        onPress={handlePress}
        style={buttonStyle}
      >
        <Icon
          size={iconSize}
          uniProps={selected ? selectedIconColorMapping : mutedIconColorMapping}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export interface FileViewModeBarProps {
  mode: FileViewMode;
  /** Split needs a pointer and room for two panes; hidden on native/compact. */
  showSplit: boolean;
  onChange: (mode: FileViewMode) => void;
}

export function FileViewModeBar({ mode, showSplit, onChange }: FileViewModeBarProps) {
  const { t } = useTranslation();
  // Doubled on compact, like every other icon-only control. The literal 16 this
  // used to pass is ICON_SIZE.md, so the desktop size is unchanged.
  const iconSize = useIconSize();
  return (
    <View style={styles.bar} testID="file-view-mode-bar">
      <FileViewModeButton
        mode="editor"
        label={t("editor.viewMode.editor")}
        Icon={ThemedSquarePen}
        iconSize={iconSize.md}
        selected={mode === "editor"}
        onChange={onChange}
      />
      {showSplit ? (
        <FileViewModeButton
          mode="split"
          label={t("editor.viewMode.split")}
          Icon={ThemedColumns2}
          iconSize={iconSize.md}
          selected={mode === "split"}
          onChange={onChange}
        />
      ) : null}
      <FileViewModeButton
        mode="preview"
        label={t("editor.viewMode.preview")}
        Icon={ThemedEye}
        iconSize={iconSize.md}
        selected={mode === "preview"}
        onChange={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The chrome scales with the icons — a doubled glyph in unchanged padding
  // reads as cramped, and the tap targets need the room on a phone anyway.
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: compactUp(2),
    borderRadius: compactUp(8),
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  modeButton: {
    padding: compactUp(theme.spacing[1]),
    borderRadius: compactUp(6),
  },
  modeButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  modeButtonSelected: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
