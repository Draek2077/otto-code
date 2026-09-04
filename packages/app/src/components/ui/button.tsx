import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  default as React,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, Text, View } from "react-native";
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  buttonIconSize,
  createControlGeometry,
  type ButtonControlSize,
} from "@/components/ui/control-geometry";
import { useControlStatePreview } from "@/components/ui/control-state-preview";
import { compactUp } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import type { IconSizeProp } from "@/components/icons/icon-size";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = ButtonControlSize;

type LeftIcon =
  | ReactElement
  | ComponentType<{ color?: string; size?: IconSizeProp }>
  | { render: (color: string) => ReactElement }
  | null;

interface ButtonIconProps {
  loading: boolean;
  leftIcon?: LeftIcon;
  iconSize: IconSizeProp;
  iconColor: string;
}

function ButtonIcon({ loading, leftIcon, iconSize, iconColor }: ButtonIconProps) {
  if (loading) {
    return (
      <View>
        <LoadingSpinner size="small" color={iconColor} />
      </View>
    );
  }

  if (!leftIcon) return null;

  if (typeof leftIcon === "object" && "type" in leftIcon) {
    return <View>{leftIcon}</View>;
  }

  if (typeof leftIcon === "object" && "render" in leftIcon) {
    return <View>{leftIcon.render(iconColor)}</View>;
  }

  const Icon = leftIcon as ComponentType<{ color: string; size: IconSizeProp }>;
  return (
    <View>
      <Icon color={iconColor} size={iconSize} />
    </View>
  );
}

const ThemedButtonIcon = withUnistyles(ButtonIcon);

const foregroundIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foreground });
const foregroundMutedIconMapping = (theme: Theme) => ({
  iconColor: theme.colors.foregroundMuted,
});
const accentForegroundIconMapping = (theme: Theme) => ({
  iconColor: theme.colors.accentForeground,
});
const destructiveForegroundIconMapping = (theme: Theme) => ({
  iconColor: theme.colors.destructiveForeground,
});

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    base: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: compactUp(theme.spacing[2]),
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: "transparent",
      overflow: "hidden",
    },
    // Sizes come from the shared control geometry; the compactUp overrides
    // double touch targets on compact form factors (phones).
    md: {
      ...geometry.buttonMd,
      minHeight: compactUp(geometry.buttonMd.minHeight),
      paddingHorizontal: compactUp(geometry.buttonMd.paddingHorizontal),
    },
    xs: {
      ...geometry.buttonXs,
      // 1.5x (not the default 2x) keeps these small buttons at a 48px compact
      // touch target instead of an oversized 64px one.
      minHeight: compactUp(geometry.buttonXs.minHeight, 1.5),
      paddingHorizontal: compactUp(geometry.buttonXs.paddingHorizontal),
    },
    sm: {
      ...geometry.buttonSm,
      // 1.5x (not the default 2x) keeps these small buttons at a 48px compact
      // touch target instead of an oversized 64px one.
      minHeight: compactUp(geometry.buttonSm.minHeight, 1.5),
      paddingHorizontal: compactUp(geometry.buttonSm.paddingHorizontal),
    },
    lg: {
      ...geometry.buttonLg,
      minHeight: compactUp(geometry.buttonLg.minHeight),
      paddingHorizontal: compactUp(geometry.buttonLg.paddingHorizontal),
    },
    default: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    secondary: {
      backgroundColor: theme.colors.surface3,
      borderColor: theme.colors.surface3,
    },
    outline: {
      backgroundColor: "transparent",
      borderColor: theme.colors.borderAccent,
    },
    ghost: {
      backgroundColor: "transparent",
      borderColor: "transparent",
    },
    destructive: {
      backgroundColor: theme.colors.destructive,
      borderColor: theme.colors.destructive,
    },
    pressed: {
      opacity: 0.85,
    },
    stateLayer: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    stateLayerHovered: {
      backgroundColor: theme.colors.surfaceInteractiveHover,
    },
    stateLayerPressed: {
      backgroundColor: theme.colors.surfaceInteractivePressed,
    },
    outlineHovered: {
      borderColor: theme.colors.borderInteractiveHover,
    },
    outlinePressed: {
      borderColor: theme.colors.accent,
    },
    disabled: {
      opacity: theme.opacity[50],
    },
    previewFocused: {
      borderColor: theme.colors.accent,
    },
    text: {
      color: theme.colors.foreground,
      ...geometry.buttonText,
      fontWeight: theme.fontWeight.normal,
    },
    textXs: {
      ...geometry.buttonTextXs,
    },
    textDefault: {
      color: theme.colors.accentForeground,
    },
    textDestructive: {
      color: theme.colors.destructiveForeground,
    },
    textGhost: {
      color: theme.colors.foregroundMuted,
    },
    textGhostHovered: {
      color: theme.colors.foreground,
    },
  };
});

export function Button({
  children,
  variant = "secondary",
  size = "md",
  leftIcon,
  iconSize,
  trailing,
  style,
  textStyle,
  disabled,
  loading = false,
  accessibilityRole,
  accessibilityState: accessibilityStateProp,
  ...props
}: PropsWithChildren<
  Omit<PressableProps, "style"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: LeftIcon;
    /** Override the icon size derived from `size` (e.g. a compact 2x bump). */
    iconSize?: IconSizeProp;
    trailing?: ReactNode;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    loading?: boolean;
  }
>) {
  const [eventHovered, setEventHovered] = useState(false);
  const preview = useControlStatePreview();
  const hovered = preview?.hovered ?? eventHovered;
  const isDisabled = disabled || loading;

  let variantStyle: ViewStyle;
  if (variant === "default") {
    variantStyle = styles.default;
  } else if (variant === "secondary") {
    variantStyle = styles.secondary;
  } else if (variant === "outline") {
    variantStyle = styles.outline;
  } else if (variant === "ghost") {
    variantStyle = styles.ghost;
  } else {
    variantStyle = styles.destructive;
  }

  let sizeStyle: ViewStyle;
  if (size === "xs") {
    sizeStyle = styles.xs;
  } else if (size === "sm") {
    sizeStyle = styles.sm;
  } else if (size === "lg") {
    sizeStyle = styles.lg;
  } else {
    sizeStyle = styles.md;
  }
  const isGhostHovered = hovered && variant === "ghost";
  const usesSurfaceStateLayer =
    variant === "secondary" || variant === "outline" || variant === "ghost";

  const handleHoverIn = useCallback(() => setEventHovered(true), []);
  const handleHoverOut = useCallback(() => setEventHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed: eventPressed }: PressableStateCallbackType): StyleProp<ViewStyle> => {
      const pressed = preview?.pressed ?? eventPressed;
      return [
        styles.base,
        sizeStyle,
        variantStyle,
        hovered && variant === "outline" && !pressed ? styles.outlineHovered : null,
        pressed && variant === "outline" ? styles.outlinePressed : null,
        pressed && !usesSurfaceStateLayer ? styles.pressed : null,
        preview?.focused ? styles.previewFocused : null,
        isDisabled ? styles.disabled : null,
        style,
      ];
    },
    [hovered, sizeStyle, variant, variantStyle, usesSurfaceStateLayer, preview, isDisabled, style],
  );

  const resolvedTextStyle = useMemo(
    () => [
      styles.text,
      size === "xs" ? styles.textXs : null,
      variant === "default" ? styles.textDefault : null,
      variant === "destructive" ? styles.textDestructive : null,
      variant === "ghost" ? styles.textGhost : null,
      isGhostHovered ? styles.textGhostHovered : null,
      textStyle,
    ],
    [size, variant, textStyle, isGhostHovered],
  );

  const accessibilityState = useMemo(
    () => ({ ...accessibilityStateProp, disabled: isDisabled, busy: loading }),
    [accessibilityStateProp, isDisabled, loading],
  );

  function resolveIconMapping() {
    if (variant === "default") {
      return accentForegroundIconMapping;
    }
    if (variant === "destructive") {
      return destructiveForegroundIconMapping;
    }
    if (variant === "ghost") {
      return isGhostHovered ? foregroundIconMapping : foregroundMutedIconMapping;
    }
    return foregroundIconMapping;
  }

  return (
    <Pressable
      {...props}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityState={accessibilityState}
      disabled={isDisabled}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableStyle}
    >
      {({ pressed: eventPressed }) => {
        const pressed = preview?.pressed ?? eventPressed;
        return (
          <>
            {usesSurfaceStateLayer ? (
              <View
                pointerEvents="none"
                style={[
                  styles.stateLayer,
                  hovered && !pressed ? styles.stateLayerHovered : null,
                  pressed ? styles.stateLayerPressed : null,
                ]}
              />
            ) : null}
            <ThemedButtonIcon
              loading={loading}
              leftIcon={leftIcon}
              iconSize={iconSize ?? buttonIconSize[size]}
              uniProps={resolveIconMapping()}
            />
            {children != null ? <Text style={resolvedTextStyle}>{children}</Text> : null}
            {trailing}
          </>
        );
      }}
    </Pressable>
  );
}
