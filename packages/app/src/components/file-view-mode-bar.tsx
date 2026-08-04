import { useCallback, useMemo } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Columns2, Eye, SquarePen, Wysiwyg } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FileViewMode } from "@/stores/file-view-store";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";

// The file tab's three-way view switch: editor, editor+preview split,
// preview. Icon-only with tooltips; exactly one mode is selected.
//
// Plus one thing that is NOT a mode: Formatted, the markdown live preview.
// It rides here because this is where people look for it, but it stays a
// separate axis behind a divider, because the modes and it form a 2x2
// ({Editor, Split} x {Formatted on, off}), and the cell that would be lost by
// making it a fourth mode is the most useful one: a formatted editor beside the
// rendered preview, where ticking a checkbox on the right writes the document
// on the left. See docs/text-editor.md.

const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedEye = withUnistyles(Eye);
const ThemedWysiwyg = withUnistyles(Wysiwyg);

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

/**
 * The Formatted toggle's state, or null for a file it does not apply to.
 *
 * Null withholds the segment entirely (every non-markdown file); `disabled`
 * keeps it in place but inert. Those are different answers on purpose: markdown
 * in Preview mode still HAS a formatted editor, you are just not looking at it,
 * so the control stays where the eye learned to find it rather than making the
 * bar change width every time the mode does.
 */
export interface FileViewFormattedToggle {
  /** Markers are hidden off the caret's line: the WYSIWYG editing surface. */
  on: boolean;
  /** True in Preview mode: there is no editor pane for it to govern. */
  disabled: boolean;
  onToggle: () => void;
}

export interface FileViewModeBarProps {
  mode: FileViewMode;
  /** Split needs a pointer and room for two panes; hidden on native/compact. */
  showSplit: boolean;
  onChange: (mode: FileViewMode) => void;
  /** The orthogonal markdown axis; null for files it does not apply to. */
  formatted: FileViewFormattedToggle | null;
}

function FormattedButton({
  label,
  iconSize,
  formatted,
}: {
  label: string;
  iconSize: number;
  formatted: FileViewFormattedToggle;
}) {
  const { on, disabled, onToggle } = formatted;
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.modeButton,
      !disabled && (Boolean(hovered) || pressed) && styles.modeButtonHovered,
      on && styles.modeButtonSelected,
      disabled && styles.modeButtonDisabled,
    ],
    [disabled, on],
  );
  const accessibilityState = useMemo(() => ({ disabled, selected: on }), [disabled, on]);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        testID="file-view-formatted"
        onPress={onToggle}
        disabled={disabled}
        style={buttonStyle}
      >
        <ThemedWysiwyg
          size={iconSize}
          uniProps={on ? selectedIconColorMapping : mutedIconColorMapping}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function FileViewModeBar({ mode, showSplit, onChange, formatted }: FileViewModeBarProps) {
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
      {formatted ? (
        <>
          {/* The divider is the whole point: it says "this one is not a mode".
              Without it a fourth glyph in the same pill reads as a fourth
              position in a radio group, which is exactly the wrong model. */}
          <View style={styles.axisDivider} />
          <FormattedButton
            label={t("editor.viewMode.formatted")}
            iconSize={iconSize.md}
            formatted={formatted}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The chrome scales with the icons - a doubled glyph in unchanged padding
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
  // The app-wide disabled idiom (toolbar-icon-button): reduced opacity, no
  // hover response, icon keeps the muted color. There is no "subtle" token.
  modeButtonDisabled: {
    opacity: 0.4,
  },
  axisDivider: {
    width: 1,
    alignSelf: "stretch",
    marginHorizontal: compactUp(theme.spacing[1]),
    marginVertical: compactUp(2),
    backgroundColor: theme.colors.border,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
