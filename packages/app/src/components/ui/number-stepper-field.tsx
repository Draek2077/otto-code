import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Minus, Plus, type IconComponent } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  createControlGeometry,
  resolveControlInteractionStyles,
  type FieldControlSize,
} from "@/components/ui/control-geometry";
import { isWeb } from "@/constants/platform";

// Press-and-hold acceleration. A single tap steps by ±1. Holding a button dwells
// briefly (so a slightly-long press is still one step), then auto-repeats on a
// fixed cadence with an exponentially growing step size — starting at 1 so you
// keep fine control, ramping up to STEP_CAP so you can cover the whole range in
// a couple of seconds. Repeats stop the instant a bound is hit.
const HOLD_START_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 60;
const RAMP_DURATION_MS = 1600;
const STEP_CAP = 200;

// stepForHeldTime maps how long the auto-repeat has been running to a step size.
// `STEP_CAP ** progress` is 1 at progress 0 and STEP_CAP at progress 1, with a
// smooth exponential curve between — the "starts slow, accelerates" feel.
function stepForHeldTime(repeatingMs: number): number {
  const progress = Math.min(1, Math.max(0, repeatingMs / RAMP_DURATION_MS));
  return Math.max(1, Math.round(STEP_CAP ** progress));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Parse the field's text into a number. Empty (and any non-digit noise) reads as
// the minimum, which — with unlimitedAtMin — is the "unlimited" sentinel.
function parseValue(text: string, min: number, max: number): number {
  const digits = text.replace(/[^0-9]/g, "");
  if (digits === "") {
    return min;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : min;
}

// Sanitize freely-typed text to digits within range, stripping leading zeros
// ("007" → "7") but preserving a lone "0". Empty stays empty.
function sanitizeTyped(raw: string, max: number): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits === "") {
    return "";
  }
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return String(Math.min(parsed, max));
}

export interface NumberStepperFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  size?: FieldControlSize;
  min?: number;
  max?: number;
  /** When true, reaching `min` is the "unlimited" state and rests as empty text. */
  unlimitedAtMin?: boolean;
  placeholder?: string;
  accessibilityLabel?: string;
  decrementLabel?: string;
  incrementLabel?: string;
  testID?: string;
}

export function NumberStepperField({
  value,
  onChangeText,
  size = "md",
  min = 0,
  max = 9999,
  unlimitedAtMin = false,
  placeholder,
  accessibilityLabel,
  decrementLabel = "Decrease",
  incrementLabel = "Increase",
  testID,
}: NumberStepperFieldProps): ReactElement {
  const [focused, setFocused] = useState(false);
  // The repeating hold closure needs the latest text without re-subscribing;
  // keep a ref mirror updated every render and optimistically on each step.
  const valueRef = useRef(value);
  valueRef.current = value;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatStartRef = useRef(0);

  const current = parseValue(value, min, max);
  const atMin = current <= min;
  const atMax = current >= max;

  // AdaptiveTextInput is uncontrolled (native owns the text; `value` is dropped),
  // so programmatic changes from the buttons can't be pushed through `value`.
  // Its supported escape hatch is `resetKey` — bumping it remounts the input and
  // re-seeds it from `initialValue`. We only bump on programmatic changes (steps,
  // blur reconcile), never while the user types, so typing keeps native ownership
  // and never cursor-jumps.
  const [displayEpoch, setDisplayEpoch] = useState(0);
  const bumpDisplay = useCallback(() => setDisplayEpoch((epoch) => epoch + 1), []);

  // Apply one step of `magnitude` in `direction`. Returns whether the value
  // actually moved (false at a bound), which the hold loop uses to stop.
  const applyStep = useCallback(
    (direction: 1 | -1, magnitude: number): boolean => {
      const now = parseValue(valueRef.current, min, max);
      const next = clamp(now + direction * magnitude, min, max);
      if (next === now) {
        return false;
      }
      const nextText = next === min && unlimitedAtMin ? "" : String(next);
      valueRef.current = nextText;
      onChangeText(nextText);
      bumpDisplay();
      return true;
    },
    [bumpDisplay, max, min, onChangeText, unlimitedAtMin],
  );

  const stopHold = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startHold = useCallback(
    (direction: 1 | -1) => {
      stopHold();
      // Immediate single step: a plain tap changes the value by exactly one.
      const moved = applyStep(direction, 1);
      if (!moved) {
        return;
      }
      const beginRepeat = () => {
        repeatStartRef.current = Date.now();
        const tick = () => {
          const step = stepForHeldTime(Date.now() - repeatStartRef.current);
          if (!applyStep(direction, step)) {
            stopHold();
            return;
          }
          timerRef.current = setTimeout(tick, REPEAT_INTERVAL_MS);
        };
        tick();
      };
      timerRef.current = setTimeout(beginRepeat, HOLD_START_DELAY_MS);
    },
    [applyStep, stopHold],
  );

  useEffect(() => stopHold, [stopHold]);

  const handleChangeText = useCallback(
    (raw: string) => {
      // Sanitize the stored value, but leave the native text as typed — the
      // input owns its own text while focused, and blur reconciles the display.
      onChangeText(sanitizeTyped(raw, max));
    },
    [max, onChangeText],
  );

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => {
    setFocused(false);
    // Rest an at-minimum value as the canonical empty "unlimited" so the
    // placeholder shows instead of a bare "0".
    if (
      unlimitedAtMin &&
      parseValue(valueRef.current, min, max) === min &&
      valueRef.current !== ""
    ) {
      onChangeText("");
    }
    // Reconcile the visible text with the sanitized value (e.g. an over-max
    // entry the input kept showing while focused).
    bumpDisplay();
  }, [bumpDisplay, max, min, onChangeText, unlimitedAtMin]);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (!isWeb) {
        return;
      }
      const key = event.nativeEvent.key;
      if (key === "ArrowUp") {
        applyStep(1, 1);
      } else if (key === "ArrowDown") {
        applyStep(-1, 1);
      }
    },
    [applyStep],
  );

  const iconSize = size === "sm" ? 16 : 18;

  const containerStyle = useMemo(
    () => [
      styles.container,
      size === "sm" ? styles.containerSm : styles.containerMd,
      resolveControlInteractionStyles(
        {
          controlRest: styles.controlRest,
          controlHover: styles.controlHover,
          controlActive: styles.controlActive,
        },
        { focused },
      ),
    ],
    [size, focused],
  );
  const leftButtonStyle = useMemo(
    () => [size === "sm" ? styles.buttonSm : styles.buttonMd, styles.buttonLeft],
    [size],
  );
  const rightButtonStyle = useMemo(
    () => [size === "sm" ? styles.buttonSm : styles.buttonMd, styles.buttonRight],
    [size],
  );
  const inputStyle = useMemo(
    () => [styles.input, size === "sm" ? styles.inputSm : styles.inputMd],
    [size],
  );
  const handleDecrementPressIn = useCallback(() => startHold(-1), [startHold]);
  const handleIncrementPressIn = useCallback(() => startHold(1), [startHold]);

  return (
    <View style={containerStyle} testID={testID}>
      <StepperButton
        icon={Minus}
        iconSize={iconSize}
        label={decrementLabel}
        disabled={atMin}
        sizeStyle={leftButtonStyle}
        onPressIn={handleDecrementPressIn}
        onPressOut={stopHold}
        testID={testID ? `${testID}-decrement` : undefined}
      />
      <AdaptiveTextInput
        initialValue={value}
        resetKey={displayEpoch}
        onChangeText={handleChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyPress={handleKeyPress}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel}
        keyboardType="number-pad"
        inputMode="numeric"
        style={inputStyle}
        testID={testID ? `${testID}-input` : undefined}
      />
      <StepperButton
        icon={Plus}
        iconSize={iconSize}
        label={incrementLabel}
        disabled={atMax}
        sizeStyle={rightButtonStyle}
        onPressIn={handleIncrementPressIn}
        onPressOut={stopHold}
        testID={testID ? `${testID}-increment` : undefined}
      />
    </View>
  );
}

function iconColorFor(disabled: boolean, active: boolean): string {
  if (disabled) {
    return styles.iconDisabled.color;
  }
  return active ? styles.iconActive.color : styles.icon.color;
}

function StepperButton({
  icon: Icon,
  iconSize,
  label,
  disabled,
  sizeStyle,
  onPressIn,
  onPressOut,
  testID,
}: {
  icon: IconComponent;
  iconSize: number;
  label: string;
  disabled: boolean;
  sizeStyle: StyleProp<ViewStyle>;
  onPressIn: () => void;
  onPressOut: () => void;
  testID?: string;
}): ReactElement {
  const renderStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      sizeStyle,
      !disabled && (hovered || pressed) ? styles.buttonActive : null,
      disabled ? styles.buttonDisabled : null,
    ],
    [disabled, sizeStyle],
  );
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const renderIcon = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => (
      <Icon size={iconSize} color={iconColorFor(disabled, Boolean(hovered) || pressed)} />
    ),
    [Icon, disabled, iconSize],
  );

  return (
    <Tooltip enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={renderStyle}
        testID={testID}
      >
        {renderIcon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    container: {
      flexDirection: "row",
      alignItems: "stretch",
      backgroundColor: theme.colors.surface2,
      overflow: "hidden",
    },
    containerSm: {
      minHeight: geometry.fieldControlSm.minHeight,
      borderRadius: geometry.fieldControlSm.borderRadius,
    },
    containerMd: {
      minHeight: geometry.fieldControlMd.minHeight,
      borderRadius: geometry.fieldControlMd.borderRadius,
    },
    controlRest: {
      ...geometry.controlRest,
    },
    controlHover: {
      ...geometry.controlHover,
    },
    controlActive: {
      ...geometry.controlActive,
    },
    button: {
      alignItems: "center",
      justifyContent: "center",
    },
    buttonSm: {
      width: geometry.fieldControlSm.minHeight,
    },
    buttonMd: {
      width: geometry.fieldControlMd.minHeight,
    },
    buttonLeft: {
      borderRightWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
    },
    buttonRight: {
      borderLeftWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
    },
    buttonActive: {
      backgroundColor: theme.colors.surfaceHover,
    },
    buttonDisabled: {
      opacity: theme.opacity[50],
    },
    icon: {
      color: theme.colors.foregroundMuted,
    },
    iconActive: {
      color: theme.colors.foreground,
    },
    iconDisabled: {
      color: theme.colors.foregroundMuted,
    },
    input: {
      flex: 1,
      minWidth: 0,
      textAlign: "center",
      color: theme.colors.foreground,
      paddingHorizontal: theme.spacing[2],
      paddingVertical: 0,
      outlineWidth: 0,
      outlineColor: "transparent",
    },
    inputSm: {
      ...geometry.fieldTextSm,
    },
    inputMd: {
      ...geometry.fieldTextMd,
    },
    tooltipText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.popoverForeground,
    },
  };
});
