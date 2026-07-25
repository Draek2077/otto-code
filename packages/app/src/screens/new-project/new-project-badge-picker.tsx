import { useCallback, useRef, useState, type ReactNode } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "@/components/icons/material-icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compactUp, type Theme } from "@/styles/theme";

// The New project page's pickers are pills in a row above the input, the same
// language New workspace uses for project / host / isolation / base — not
// stacked settings rows. Everything selectable on this page goes through here so
// the row stays visually uniform however many choices a mode adds.

const BADGE_HEIGHT = 28;

const ThemedChevronDown = withUnistyles(ChevronDown);
const chevronMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

interface NewProjectBadgePickerProps {
  // An already-themed icon element. Callers wrap their icon once at module
  // scope with withUnistyles; wrapping per render would remount it every time.
  icon: ReactNode;
  label: string;
  tooltip: string;
  options: ComboboxOption[];
  value: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  title: string;
  testID?: string;
}

export function NewProjectBadgePicker({
  icon,
  label,
  tooltip,
  options,
  value,
  onSelect,
  disabled = false,
  searchable = false,
  searchPlaceholder,
  emptyText,
  title,
  testID,
}: NewProjectBadgePickerProps) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const handlePress = useCallback(() => setOpen(true), []);
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );

  const badgeStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.badge,
      Boolean(hovered) && !disabled && styles.badgeHovered,
      pressed && !disabled && styles.badgePressed,
      disabled && styles.badgeDisabled,
    ],
    [disabled],
  );

  return (
    <View>
      <Tooltip>
        <TooltipTrigger asChild triggerRefProp="ref">
          <ComboboxTrigger
            ref={anchorRef}
            onPress={handlePress}
            disabled={disabled}
            style={badgeStyle}
            accessibilityRole="button"
            accessibilityLabel={tooltip}
            testID={testID}
            chevron={null}
          >
            <View style={styles.badgeIconBox}>{icon}</View>
            <Text style={styles.badgeText} numberOfLines={1}>
              {label}
            </Text>
            <ThemedChevronDown uniProps={chevronMapping} />
          </ComboboxTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        title={title}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    // 1.5x on compact to wrap the badge icons' compact upscale — otherwise the
    // theme-scaled icon/text get clipped by the fixed desktop height.
    height: compactUp(BADGE_HEIGHT, 1.5),
    maxWidth: 240,
    overflow: "hidden",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    gap: theme.spacing[1],
  },
  badgeHovered: {
    backgroundColor: theme.colors.surface2,
  },
  badgePressed: {
    backgroundColor: theme.colors.surface0,
  },
  badgeDisabled: {
    opacity: 0.6,
  },
  badgeText: {
    minWidth: 0,
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  badgeIconBox: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
