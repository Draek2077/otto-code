import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  createControlGeometry,
  segmentedIconSize,
  type SegmentedControlSize,
} from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useControlStatePreview } from "@/components/ui/control-state-preview";
import type { Theme } from "@/styles/theme";

type SegmentedControlIconRenderer = (props: { color: string; size: number }) => ReactNode;

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: SegmentedControlIconRenderer;
  disabled?: boolean;
  testID?: string;
  /** Marks a segment as wanting attention: same amber the mode chip uses for
   *  its "moderate" tier, so the two read as one language. The tone only
   *  recolors - hover, press, and selection chrome still behave normally, and
   *  the label brightens on selection exactly like an untoned segment. */
  tone?: "warning";
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: SegmentedControlSize;
  hideLabels?: boolean;
  // Let the segments flow onto extra lines instead of overflowing the parent.
  // Segments never shrink (they'd clip their labels), so a control with many
  // options is wider than a phone - wrapping is the only way it fits.
  wrap?: boolean;
  // Fill the parent and split it evenly between the segments. Use when the
  // control *is* the row (a two-tab strip heading a panel) rather than one chip
  // sitting in a toolbar next to other things.
  stretch?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface SegmentIconProps {
  icon: SegmentedControlIconRenderer;
  iconSize: number;
  iconColor: string;
}

function SegmentIcon({ icon, iconSize, iconColor }: SegmentIconProps) {
  return <View style={styles.iconContainer}>{icon({ color: iconColor, size: iconSize })}</View>;
}

const ThemedSegmentIcon = withUnistyles(SegmentIcon);

const selectedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foreground });
const mutedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foregroundMuted });

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  hideLabels = false,
  wrap,
  stretch = false,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const isCompact = useIsCompactFormFactor();
  const shouldWrap = wrap ?? isCompact;
  // Keyed off the size union, and read during render because Unistyles styles
  // must not be dereferenced at module scope. The ternary this replaces had no
  // branch for "xs" and silently rendered it at md, which is what left the file
  // editor's mode bar 44px tall.
  const containerSizeStyle = {
    xs: styles.containerXs,
    sm: styles.containerSm,
    md: styles.containerMd,
  }[size];
  const baseSegmentSizeStyle = { xs: styles.segmentXs, sm: styles.segmentSm, md: styles.segmentMd }[
    size
  ];
  const labelSizeStyle = { xs: styles.labelXs, sm: styles.labelSm, md: styles.labelMd }[size];
  const iconSize = segmentedIconSize[size];

  const containerStyle = useMemo(
    () => [
      styles.container,
      containerSizeStyle,
      shouldWrap && styles.containerWrap,
      stretch && styles.containerStretch,
      style,
    ],
    [containerSizeStyle, shouldWrap, stretch, style],
  );
  const segmentSizeStyle = useMemo(
    () => [baseSegmentSizeStyle, stretch && styles.segmentStretch],
    [baseSegmentSizeStyle, stretch],
  );

  return (
    <View style={containerStyle} testID={testID}>
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <SegmentItem
            key={option.value}
            option={option}
            isSelected={isSelected}
            iconSize={iconSize}
            hideLabels={hideLabels}
            segmentSizeStyle={segmentSizeStyle}
            labelSizeStyle={labelSizeStyle}
            currentValue={value}
            onValueChange={onValueChange}
          />
        );
      })}
    </View>
  );
}

function SegmentItem<T extends string>({
  option,
  isSelected,
  iconSize,
  hideLabels,
  segmentSizeStyle,
  labelSizeStyle,
  currentValue,
  onValueChange,
}: {
  option: SegmentedControlOption<T>;
  isSelected: boolean;
  iconSize: number;
  hideLabels: boolean;
  segmentSizeStyle: StyleProp<ViewStyle>;
  labelSizeStyle: StyleProp<TextStyle>;
  currentValue: T;
  onValueChange: (value: T) => void;
}) {
  const preview = useControlStatePreview();
  const previewMatchesTarget = !preview?.targetId || preview.targetId === option.value;
  // Tone recolors, selection brightens. An unselected toned segment is a dimmed
  // amber - same relationship muted→foreground has on an untoned one - so
  // "which tab am I on" stays readable independently of "which tab has news".
  const labelStyle = useMemo(
    () => [
      styles.label,
      labelSizeStyle,
      isSelected && styles.labelSelected,
      option.tone === "warning" && (isSelected ? styles.labelWarningSelected : styles.labelWarning),
    ],
    [labelSizeStyle, isSelected, option.tone],
  );
  const handlePress = useCallback(() => {
    if (!option.disabled && option.value !== currentValue) {
      onValueChange(option.value);
    }
  }, [option.disabled, option.value, currentValue, onValueChange]);
  const pressableStyle = useCallback(
    ({
      hovered: eventHovered,
      pressed: eventPressed,
    }: PressableStateCallbackType & {
      hovered?: boolean;
    }) => {
      const hovered = previewMatchesTarget ? (preview?.hovered ?? Boolean(eventHovered)) : false;
      const pressed = previewMatchesTarget ? (preview?.pressed ?? eventPressed) : false;
      return [
        styles.segment,
        segmentSizeStyle,
        // A toned segment runs the same three states as an untoned one - bare at
        // rest, boxed on hover, boxed harder when selected - just in amber
        // instead of surface greys. The two ladders never layer; at rest NEITHER
        // paints a background, which is what makes hover legible at all.
        isSelected &&
          (option.tone === "warning" ? styles.segmentWarningSelected : styles.segmentSelected),
        hovered &&
          !isSelected &&
          (option.tone === "warning" ? styles.segmentWarningHover : styles.segmentHover),
        pressed &&
          !isSelected &&
          (option.tone === "warning" ? styles.segmentWarningHover : styles.segmentPressed),
        option.disabled && styles.segmentDisabled,
      ];
    },
    [isSelected, option.disabled, option.tone, preview, previewMatchesTarget, segmentSizeStyle],
  );
  const accessibilityState = useMemo(
    () => ({ selected: isSelected, disabled: option.disabled }),
    [isSelected, option.disabled],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      aria-selected={isSelected}
      disabled={option.disabled}
      testID={option.testID}
      onPress={handlePress}
      style={pressableStyle}
    >
      {option.icon ? (
        <ThemedSegmentIcon
          icon={option.icon}
          iconSize={iconSize}
          uniProps={isSelected ? selectedIconMapping : mutedIconMapping}
        />
      ) : null}
      {hideLabels ? null : (
        <Text style={labelStyle} numberOfLines={1}>
          {option.label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    container: {
      flexDirection: "row",
      alignItems: "stretch",
      // The well the thumbs sit in. `surfaceControlTrack`, not `surface2`: the
      // fill has to read as a recess in BOTH ramps, and light's is compressed
      // enough at the top that surface2 paints white-on-white. See the token's
      // note in `theme.ts`.
      backgroundColor: theme.colors.surfaceControlTrack,
      gap: 2,
    },
    containerXs: {
      ...geometry.segmentedContainerXs,
    },
    containerSm: {
      ...geometry.segmentedContainerSm,
    },
    containerMd: {
      ...geometry.segmentedContainerMd,
    },
    // Wrapped mode: rows of segments, centered, with the same 2px gutter between
    // lines as between segments. `flexShrink: 1` + `minWidth: 0` are load-bearing:
    // segments never shrink (flexShrink: 0), so unless the container itself is
    // allowed to shrink below its single-line content width, flexWrap never
    // engages - the control just overflows and squeezes a neighboring label into
    // a vertical sliver. Shrinking the container is what forces segments onto new
    // lines when the row is too narrow.
    containerWrap: {
      flexWrap: "wrap",
      justifyContent: "center",
      rowGap: 2,
      flexShrink: 1,
      minWidth: 0,
    },
    containerStretch: {
      alignSelf: "stretch",
    },
    segment: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      gap: theme.spacing[1],
    },
    segmentXs: {
      ...geometry.segmentedSegmentXs,
    },
    segmentSm: {
      ...geometry.segmentedSegmentSm,
    },
    segmentMd: {
      ...geometry.segmentedSegmentMd,
    },
    // Equal shares of the container. Overrides the default flexShrink: 0 - in
    // stretch mode the segments are meant to resize with the parent.
    segmentStretch: {
      flex: 1,
      flexBasis: 0,
      minWidth: 0,
    },
    // Selection, hover, and press use the same theme-accent state ladder as
    // buttons, tabs, rows, and menu items. The shadow still makes the selected
    // thumb persistent while the stronger hover wash remains easy to spot.
    segmentSelected: {
      backgroundColor: theme.colors.surfaceInteractiveSelected,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    segmentHover: {
      backgroundColor: theme.colors.surfaceInteractiveHover,
    },
    segmentPressed: {
      backgroundColor: theme.colors.surfaceInteractivePressed,
    },
    // The amber ladder. It mirrors the grey one STATE FOR STATE: no box at
    // rest, a box on hover, a stronger box when selected. The fills are theme
    // tokens rather than an alpha computed here - light and dark need different
    // weights, and one hardcoded pair can only be right on one of them.
    segmentWarningHover: {
      backgroundColor: theme.colors.statusWarningSurface,
    },
    segmentWarningSelected: {
      backgroundColor: theme.colors.statusWarningSurfaceStrong,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    segmentDisabled: {
      opacity: theme.opacity[50],
    },
    iconContainer: {
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      color: theme.colors.foregroundMuted,
      fontWeight: theme.fontWeight.normal,
    },
    labelXs: {
      ...geometry.segmentedLabelXs,
      fontSize: {
        xs: geometry.segmentedLabelXs.fontSize + 2,
        md: geometry.segmentedLabelXs.fontSize,
      },
    },
    labelSm: {
      ...geometry.segmentedLabelSm,
      // Explicit compact bump (not left to the ambient theme-patch scale).
      fontSize: {
        xs: geometry.segmentedLabelSm.fontSize + 2,
        md: geometry.segmentedLabelSm.fontSize,
      },
    },
    labelMd: {
      ...geometry.segmentedLabelMd,
      fontSize: {
        xs: geometry.segmentedLabelMd.fontSize + 2,
        md: geometry.segmentedLabelMd.fontSize,
      },
    },
    labelSelected: {
      color: theme.colors.foreground,
    },
    // Two real amber shades, not one amber at two alphas: alpha over a dark
    // surface composites to brown and reads as black. The pair holds the same
    // contrast relationship muted→foreground holds on an untoned segment, in
    // whichever direction the active scheme's background demands.
    labelWarning: {
      color: theme.colors.statusWarningMuted,
    },
    labelWarningSelected: {
      color: theme.colors.statusWarningStrong,
    },
  };
});
