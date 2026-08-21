import {
  forwardRef,
  useCallback,
  useState,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import {
  Pressable,
  type View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  MenuContextProvider,
  useMenuContext,
  useMenuState,
  type MenuCompactMode,
} from "./menu-context";
import { useControlStatePreview } from "@/components/ui/control-state-preview";

/**
 * Owns one menu's state. Wrap a trigger and a `MenuSurface` in it.
 *
 * The trigger is deliberately not part of this: what opens a menu is the only thing that
 * differs between a dropdown (press) and a context menu (long press or right click), and it is
 * the whole reason those two wrappers still exist.
 */
export function MenuRoot({
  open,
  defaultOpen,
  onOpenChange,
  compactMode,
  children,
}: PropsWithChildren<{
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  compactMode?: MenuCompactMode;
}>): ReactElement {
  const value = useMenuState({ open, defaultOpen, onOpenChange, compactMode });
  return <MenuContextProvider value={value}>{children}</MenuContextProvider>;
}

export interface MenuTriggerState {
  pressed: boolean;
  hovered: boolean;
  open: boolean;
  focused?: boolean;
}

type TriggerStyleProp = StyleProp<ViewStyle> | ((state: MenuTriggerState) => StyleProp<ViewStyle>);

export interface MenuTriggerProps extends Omit<PressableProps, "style" | "children"> {
  style?: TriggerStyleProp;
  children: ReactNode | ((state: MenuTriggerState) => ReactNode);
  /** Ref prop used by wrappers such as TooltipTrigger that cannot target JSX's forwarded ref. */
  triggerRef?: Ref<View | null>;
  /** The parent frame owns the focus treatment, so suppress the trigger's browser outline. */
  suppressFocusOutline?: boolean;
}

const SUPPRESSED_FOCUS_OUTLINE_STYLE = { outlineWidth: 0 } as ViewStyle;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  Object.assign(ref, { current: value });
}

export const MenuTrigger = forwardRef<View, MenuTriggerProps>(function MenuTrigger(
  {
    children,
    disabled,
    style,
    triggerRef,
    suppressFocusOutline = false,
    onFocus,
    onBlur,
    ...props
  },
  forwardedRef,
): ReactElement {
  const ctx = useMenuContext("MenuTrigger");
  const [eventFocused, setEventFocused] = useState(false);
  const preview = useControlStatePreview();
  const focused = preview?.focused ?? eventFocused;

  const handleTriggerRef = useCallback(
    (node: View | null) => {
      assignRef(ctx.triggerRef, node);
      assignRef(forwardedRef, node);
      assignRef(triggerRef, node);
    },
    [ctx.triggerRef, forwardedRef, triggerRef],
  );

  const handlePress = useCallback(() => {
    if (disabled) return;
    ctx.setOpen(!ctx.open);
  }, [disabled, ctx]);

  const pressableStyle = useCallback(
    ({
      pressed: eventPressed,
      hovered: eventHovered = false,
    }: PressableStateCallbackType & { hovered?: boolean }) => {
      const state: MenuTriggerState = {
        pressed: preview?.pressed ?? eventPressed,
        hovered: preview?.hovered ?? eventHovered,
        open: preview?.open ?? ctx.open,
        focused,
      };
      if (typeof style === "function") {
        return [style(state), suppressFocusOutline ? SUPPRESSED_FOCUS_OUTLINE_STYLE : null];
      }
      return [style, suppressFocusOutline ? SUPPRESSED_FOCUS_OUTLINE_STYLE : null];
    },
    [style, ctx.open, focused, preview, suppressFocusOutline],
  );

  const renderChildren = useCallback(
    ({
      pressed: eventPressed,
      hovered: eventHovered = false,
    }: PressableStateCallbackType & { hovered?: boolean }) => {
      const state: MenuTriggerState = {
        pressed: preview?.pressed ?? eventPressed,
        hovered: preview?.hovered ?? eventHovered,
        open: preview?.open ?? ctx.open,
        focused,
      };
      return typeof children === "function" ? children(state) : children;
    },
    [children, ctx.open, focused, preview],
  );

  const handleFocus = useCallback<NonNullable<PressableProps["onFocus"]>>(
    (event) => {
      setEventFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );
  const handleBlur = useCallback<NonNullable<PressableProps["onBlur"]>>(
    (event) => {
      setEventFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  return (
    <Pressable
      {...props}
      ref={handleTriggerRef}
      collapsable={false}
      disabled={disabled}
      onPress={handlePress}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={pressableStyle}
    >
      {renderChildren}
    </Pressable>
  );
});
