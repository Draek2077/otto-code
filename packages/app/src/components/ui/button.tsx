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
import { ActivityIndicator, Pressable, Text, View } from "react-native";
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
import { compactUp } from "@/styles/theme";
import type { Theme } from "@/styles/theme";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = ButtonControlSize;

type LeftIcon =
  | ReactElement
  | ComponentType<{ color: string; size: number }>
  | { render: (color: string) => ReactElement }
  | null;

interface ButtonIconProps {
  loading: boolean;
  leftIcon?: LeftIcon;
  iconSize: number;
  iconColor: string;
}

function ButtonIcon({ loading, leftIcon, iconSize, iconColor }: ButtonIconProps) {
  if (loading) {
    return (
      <View>
        <ActivityIndicator size="small" color={iconColor} />
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

  const Icon = leftIcon as ComponentType<{ color: string; size: number }>;
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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: compactUp(theme.spacing[2]),
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: "transparent",
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
    disabled: {
      opacity: theme.opacity[50],
    },
    text: {
      color: theme.colors.foreground,
      ...geometry.buttonText,
      // Explicit compact bump (not left to the ambient theme-patch scale).
      fontSize: {
        xs: geometry.buttonText.fontSize + 2,
        md: geometry.buttonText.fontSize,
      },
      fontWeight: theme.fontWeight.normal,
    },
    textXs: {
      ...geometry.buttonTextXs,
      fontSize: {
        xs: geometry.buttonTextXs.fontSize + 2,
        md: geometry.buttonTextXs.fontSize,
      },
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
    iconSize?: number;
    trailing?: ReactNode;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    loading?: boolean;
  }
>) {
  const [hovered, setHovered] = useState(false);
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

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
      styles.base,
      sizeStyle,
      variantStyle,
      pressed ? styles.pressed : null,
      isDisabled ? styles.disabled : null,
      style,
    ],
    [sizeStyle, variantStyle, isDisabled, style],
  );

  const resolvedTextStyle = useMemo(
    () => [
      styles.text,
      size === "xs" ? styles.textXs : null,
      variant === "default" ? styles.textDefault : null,
      variant === "destructive" ? styles.textDestructive : null,
      variant === "ghost" ? styles.textGhost : null,
      textStyle,
      isGhostHovered ? styles.textGhostHovered : null,
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
      <ThemedButtonIcon
        loading={loading}
        leftIcon={leftIcon}
        iconSize={iconSize ?? buttonIconSize[size]}
        uniProps={resolveIconMapping()}
      />
      {children != null ? <Text style={resolvedTextStyle}>{children}</Text> : null}
      {trailing}
    </Pressable>
  );
}
