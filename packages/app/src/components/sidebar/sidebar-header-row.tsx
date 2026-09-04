import { useCallback, useMemo } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { IconComponent } from "@/components/icons/material-icons";
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";

// `size` is folded into uniProps (not a static prop) so it repaints from the live,
// compact-doubled `theme.iconSize` the same way `color` already does.
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
// Accent marks the surface you are already on, the same claim the explorer
// sidebar's selected tab makes. Hover stays plain foreground: pointing at a
// destination is not the same as being on it.
const accentColorMapping = (theme: Theme) => ({
  color: theme.colors.accent,
  size: theme.iconSize.sm,
});

function resolveIconColorMapping(state: { isActive: boolean; isHighlighted: boolean }) {
  if (state.isActive) {
    return accentColorMapping;
  }
  return state.isHighlighted ? foregroundColorMapping : foregroundMutedColorMapping;
}

type SidebarHeaderRowVariant = "header" | "compact";
type SidebarHeaderRowContentAlignment = "start" | "center";

interface SidebarHeaderRowProps {
  icon: IconComponent;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  /**
   * "header" (default): a sidebar-height row with its own bottom separator -
   * the lone header at the top of a sidebar (settings "Back to workspace").
   * "compact": a workspace-row-height row with no separator, for entries that
   * sit in a header group whose wrapper owns the single divider.
   */
  variant?: SidebarHeaderRowVariant;
  contentAlignment?: SidebarHeaderRowContentAlignment;
  allowLabelWrap?: boolean;
  shortcutKeys?: ShortcutKey[][] | null;
  containerStyle?: StyleProp<ViewStyle>;
}

export function SidebarHeaderRow({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  testID,
  nativeID,
  accessibilityLabel,
  variant = "header",
  contentAlignment = "start",
  allowLabelWrap = false,
  shortcutKeys = null,
  containerStyle: containerStyleOverride,
}: SidebarHeaderRowProps) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);

  const containerStyle = useMemo(
    () => [
      variant === "compact" ? styles.containerCompact : styles.container,
      containerStyleOverride,
    ],
    [containerStyleOverride, variant],
  );

  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      variant === "compact" && styles.buttonCompact,
      contentAlignment === "center" && styles.buttonContentCentered,
      isActive && styles.buttonActive,
      Boolean(hovered) && styles.buttonHovered,
    ],
    [contentAlignment, isActive, variant],
  );

  const renderChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered);
      return (
        <>
          <ThemedIcon uniProps={resolveIconColorMapping({ isActive, isHighlighted })} />
          <SidebarHeaderRowLabel
            label={label}
            isActive={isActive}
            isHighlighted={isHighlighted}
            allowWrap={allowLabelWrap}
          />
          {shortcutKeys && Boolean(state.hovered) ? (
            <Shortcut chord={shortcutKeys} style={styles.shortcut} />
          ) : null}
        </>
      );
    },
    [ThemedIcon, allowLabelWrap, isActive, label, shortcutKeys],
  );

  return (
    <View style={containerStyle}>
      <Pressable
        onPress={onPress}
        testID={testID}
        nativeID={nativeID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={buttonStyle}
      >
        {renderChildren}
      </Pressable>
    </View>
  );
}

function SidebarHeaderRowLabel({
  label,
  isActive,
  isHighlighted,
  allowWrap,
}: {
  label: string;
  isActive: boolean;
  isHighlighted: boolean;
  allowWrap: boolean;
}) {
  const labelStyle = useMemo(
    () => [styles.label, isHighlighted && styles.labelHighlighted, isActive && styles.labelActive],
    [isActive, isHighlighted],
  );
  return (
    <Text style={labelStyle} numberOfLines={allowWrap ? undefined : 1} ellipsizeMode="tail">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    userSelect: "none",
  },
  containerCompact: {
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    // Match the sidebar workspace-row shape (height, padding, radius) so the
    // compact header entries sit tight against the workspace list below.
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    // Match the item rows' inner padding (list wrapper + item both spacing[2])
    // so the icon aligns on one vertical edge with the rows below it.
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  // Compact header entries (New workspace / History) sit tighter than the
  // workspace-row shape the base button mirrors.
  buttonCompact: {
    minHeight: 32,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
  },
  buttonContentCentered: {
    justifyContent: "center",
  },
  buttonActive: {
    backgroundColor: theme.colors.surfaceInteractiveSelected,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  label: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  labelHighlighted: {
    color: theme.colors.foreground,
  },
  labelActive: {
    color: theme.colors.accent,
  },
  shortcut: {
    marginLeft: "auto",
  },
}));
