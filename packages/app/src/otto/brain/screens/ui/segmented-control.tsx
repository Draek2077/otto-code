import { useCallback, useMemo } from "react";
import {
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { createBrainStyles } from "../theme";

interface BrainSegmentOption<Value extends string> {
  value: Value;
  label: string;
  disabled?: boolean;
  testID?: string;
}

interface BrainSegmentedControlProps<Value extends string> {
  options: BrainSegmentOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  size?: "xs" | "sm" | "md";
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The original Brain controls need a recessed, wrapping track on narrow screens. */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  wrap,
  style,
  testID,
}: BrainSegmentedControlProps<Value>) {
  const styles = useStyles();
  const compact = useIsCompactFormFactor();
  const shouldWrap = wrap ?? compact;
  const containerSizeStyle = {
    xs: styles.containerXs,
    sm: styles.containerSm,
    md: styles.containerMd,
  }[size];
  const segmentSizeStyle = { xs: styles.segmentXs, sm: styles.segmentSm, md: styles.segmentMd }[
    size
  ];
  const labelSizeStyle = { xs: styles.labelXs, sm: styles.labelSm, md: styles.labelMd }[size];
  const containerStyle = useMemo(
    () => [styles.container, containerSizeStyle, shouldWrap && styles.containerWrap, style],
    [styles, containerSizeStyle, shouldWrap, style],
  );
  return (
    <View style={containerStyle} testID={testID}>
      {options.map((option) => (
        <BrainSegment
          key={option.value}
          option={option}
          value={value}
          onValueChange={onValueChange}
          segmentSizeStyle={segmentSizeStyle}
          labelSizeStyle={labelSizeStyle}
        />
      ))}
    </View>
  );
}

interface BrainSegmentProps<Value extends string> {
  option: BrainSegmentOption<Value>;
  value: Value;
  onValueChange: (value: Value) => void;
  segmentSizeStyle: StyleProp<ViewStyle>;
  labelSizeStyle: StyleProp<TextStyle>;
}

function BrainSegment<Value extends string>({
  option,
  value,
  onValueChange,
  segmentSizeStyle,
  labelSizeStyle,
}: BrainSegmentProps<Value>) {
  const styles = useStyles();
  const selected = option.value === value;
  const onPress = useCallback(() => {
    if (!option.disabled && !selected) onValueChange(option.value);
  }, [onValueChange, option.disabled, option.value, selected]);
  const interactionStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.segment,
      segmentSizeStyle,
      selected && styles.segmentSelected,
      hovered && !selected && styles.segmentHover,
      pressed && !selected && styles.segmentPressed,
      option.disabled && styles.segmentDisabled,
    ],
    [styles, segmentSizeStyle, selected, option.disabled],
  );
  const state = useMemo(
    () => ({ selected, disabled: option.disabled }),
    [selected, option.disabled],
  );
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={state}
      aria-selected={selected}
      disabled={option.disabled}
      testID={option.testID}
      onPress={onPress}
      style={interactionStyle}
    >
      <Text
        style={[styles.label, labelSizeStyle, selected && styles.labelSelected]}
        numberOfLines={1}
      >
        {option.label}
      </Text>
    </PressHighlight>
  );
}

const useStyles = createBrainStyles((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surfaceControlTrack,
    gap: 2,
  },
  containerXs: { minHeight: 28, padding: 2, borderRadius: theme.borderRadius.md },
  containerSm: { minHeight: 32, padding: 2, borderRadius: theme.borderRadius.md },
  containerMd: { minHeight: 44, padding: 3, borderRadius: theme.borderRadius.lg },
  containerWrap: {
    flexWrap: "wrap",
    justifyContent: "center",
    rowGap: 2,
    flexShrink: 1,
    minWidth: 0,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
  },
  segmentXs: {
    minHeight: 24,
    paddingHorizontal: theme.spacing[2],
    borderRadius: Math.max(0, theme.borderRadius.md - 2),
  },
  segmentSm: {
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: Math.max(0, theme.borderRadius.md - 2),
  },
  segmentMd: {
    minHeight: 38,
    paddingHorizontal: theme.spacing[2],
    borderRadius: Math.max(0, theme.borderRadius.lg - 3),
  },
  segmentSelected: {
    backgroundColor: theme.colors.surfaceInteractiveSelected,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentHover: { backgroundColor: theme.colors.surfaceInteractiveHover },
  segmentPressed: { backgroundColor: theme.colors.surfaceInteractivePressed },
  segmentDisabled: { opacity: theme.opacity[50] },
  label: { color: theme.colors.foregroundMuted, fontWeight: theme.fontWeight.normal },
  labelXs: { fontSize: theme.fontSize.xs },
  labelSm: { fontSize: theme.fontSize.sm },
  labelMd: { fontSize: theme.fontSize.base },
  labelSelected: { color: theme.colors.foreground },
}));
