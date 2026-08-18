import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  Pressable,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
  type DropdownMenuTriggerState,
} from "@/components/ui/dropdown-menu";

type SplitButtonSegment = "primary" | "menu";

interface SplitButtonContextValue {
  hasMenu: boolean;
  focusedSegment: SplitButtonSegment | null;
  setFocusedSegment: (segment: SplitButtonSegment | null) => void;
}

const SplitButtonContext = createContext<SplitButtonContextValue | null>(null);

function useSplitButtonContext(componentName: string): SplitButtonContextValue {
  const context = useContext(SplitButtonContext);
  if (!context) {
    throw new Error(`${componentName} must be used within <SplitButton />`);
  }
  return context;
}

export function SplitButton({
  children,
  hasMenu = true,
  filled = false,
  style,
  ...props
}: PropsWithChildren<
  Omit<ViewProps, "style"> & {
    /** Set false when the primary action has no secondary menu. */
    hasMenu?: boolean;
    /**
     * Paint the opaque surface2 fill on the frame, with the frame's radius
     * owned by this component (see `filledFrame`). Callers that need a
     * different tint still pass `backgroundColor` through `style`, which
     * merges last.
     */
    filled?: boolean;
    style?: StyleProp<ViewStyle>;
  }
>) {
  const [focusedSegment, setFocusedSegment] = useState<SplitButtonSegment | null>(null);
  const value = useMemo(
    () => ({ hasMenu, focusedSegment, setFocusedSegment }),
    [focusedSegment, hasMenu],
  );

  return (
    <SplitButtonContext.Provider value={value}>
      <View {...props} style={[styles.frame, filled && styles.filledFrame, style]}>
        {children}
      </View>
    </SplitButtonContext.Provider>
  );
}

type PrimaryStyleProp =
  | StyleProp<ViewStyle>
  | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);

export function SplitButtonPrimary({
  style,
  onFocus,
  onBlur,
  ...props
}: Omit<PressableProps, "style"> & { style?: PrimaryStyleProp }) {
  const { hasMenu, focusedSegment, setFocusedSegment } =
    useSplitButtonContext("SplitButtonPrimary");

  const pressableStyle = useCallback(
    (state: PressableStateCallbackType) => [
      hasMenu ? styles.primary : styles.primaryStandalone,
      typeof style === "function" ? style(state) : style,
      focusedSegment === "primary" && styles.focused,
    ],
    [focusedSegment, hasMenu, style],
  );
  const handleFocus = useCallback<NonNullable<PressableProps["onFocus"]>>(
    (event) => {
      setFocusedSegment("primary");
      onFocus?.(event);
    },
    [onFocus, setFocusedSegment],
  );
  const handleBlur = useCallback<NonNullable<PressableProps["onBlur"]>>(
    (event) => {
      setFocusedSegment(null);
      onBlur?.(event);
    },
    [onBlur, setFocusedSegment],
  );

  return <Pressable {...props} onFocus={handleFocus} onBlur={handleBlur} style={pressableStyle} />;
}

type MenuStyleProp =
  | StyleProp<ViewStyle>
  | ((state: DropdownMenuTriggerState) => StyleProp<ViewStyle>);

export function SplitButtonMenuTrigger({
  style,
  onFocus,
  onBlur,
  ...props
}: Omit<DropdownMenuTriggerProps, "style"> & { style?: MenuStyleProp }) {
  const { focusedSegment, setFocusedSegment } = useSplitButtonContext("SplitButtonMenuTrigger");

  const triggerStyle = useCallback(
    (state: DropdownMenuTriggerState) => [
      styles.menu,
      typeof style === "function" ? style(state) : style,
      focusedSegment === "primary" && styles.menuPrimaryFocused,
      focusedSegment === "menu" && styles.focused,
    ],
    [focusedSegment, style],
  );
  const handleFocus = useCallback<NonNullable<DropdownMenuTriggerProps["onFocus"]>>(
    (event) => {
      setFocusedSegment("menu");
      onFocus?.(event);
    },
    [onFocus, setFocusedSegment],
  );
  const handleBlur = useCallback<NonNullable<DropdownMenuTriggerProps["onBlur"]>>(
    (event) => {
      setFocusedSegment(null);
      onBlur?.(event);
    },
    [onBlur, setFocusedSegment],
  );

  return (
    <DropdownMenuTrigger
      {...props}
      suppressFocusOutline
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={triggerStyle}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  filledFrame: {
    // The frame's border and radius live on the segments (each paints its own
    // arc), so a bare frame background is a SQUARE box that pokes out past the
    // segments' border arc at the four corners - dark notches on a rounded
    // button. The fill's radius must therefore be owned here, where the
    // segments' corner radius is known; caller `style` can still override the
    // tint, but not the shape.
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
  },
  primary: {
    borderWidth: theme.borderWidth[1],
    borderRightWidth: 0,
    borderColor: theme.colors.borderAccent,
    borderTopLeftRadius: theme.borderRadius.md,
    borderBottomLeftRadius: theme.borderRadius.md,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    outlineWidth: 0,
  },
  primaryStandalone: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    outlineWidth: 0,
  },
  menu: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderTopRightRadius: theme.borderRadius.md,
    borderBottomRightRadius: theme.borderRadius.md,
  },
  focused: {
    borderColor: theme.colors.accent,
  },
  // The menu trigger owns the shared divider, so it completes the primary
  // segment's focus border when the primary action has keyboard focus.
  menuPrimaryFocused: {
    borderLeftColor: theme.colors.accent,
  },
}));
