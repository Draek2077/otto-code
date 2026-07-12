import { Fragment, useCallback, useMemo, useState, type ReactElement } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, Pin, PinFilled, PinOff } from "@/components/icons/material-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isNative } from "@/constants/platform";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";
import { isChangesToolbarItemPinned, type ChangesToolbarItemId } from "@/git/changes-toolbar/items";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// Pinned state uses the same gold as a favorited star, matching the tab bar's
// pin toggle (see @/workspace-pins/pinnable-menu-item).
const starColorMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedPin = withUnistyles(Pin);
const ThemedPinFilled = withUnistyles(PinFilled);
const ThemedPinOff = withUnistyles(PinOff);

/**
 * A single Changes-toolbar option. `renderIcon` returns the current-state glyph
 * (e.g. Columns2 vs AlignJustify for the split toggle) at the requested size,
 * and `label` is the current-state action ("Switch to side-by-side diff" etc.),
 * used as both the tooltip and the menu row label so the menu and strip stay in
 * lockstep.
 */
export interface ChangesToolbarItem {
  id: ChangesToolbarItemId;
  label: string;
  renderIcon: (size: number) => ReactElement;
  onPress: () => void;
  disabled?: boolean;
  /** Draw a menu separator above this item (used before Refresh). */
  separatorBefore?: boolean;
  testID?: string;
}

type PressableStyleFn = (
  state: PressableStateCallbackType & { hovered?: boolean },
) => StyleProp<ViewStyle>;

const toolbarButtonStyle: PressableStyleFn = ({ hovered, pressed }) => [
  styles.button,
  (Boolean(hovered) || pressed) && styles.buttonHovered,
];

function ChangesToolbarButton({
  item,
  size,
}: {
  item: ChangesToolbarItem;
  size: number;
}): ReactElement {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={item.label}
        testID={item.testID ? `${item.testID}-pinned` : `changes-toolbar-${item.id}`}
        disabled={item.disabled}
        onPress={item.onPress}
        style={toolbarButtonStyle}
      >
        {item.renderIcon(size)}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{item.label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A menu row for one option, carrying a trailing pin toggle. Mirrors the tab
 * bar's PinnableMenuItem: the pin is a sibling overlay (not nested inside
 * DropdownMenuItem's <button>, which would be invalid HTML on web) that shows a
 * gold marker when pinned and a hover-only muted pin otherwise.
 */
function ChangesPinnableMenuItem({
  item,
  isPinned,
  onTogglePin,
}: {
  item: ChangesToolbarItem;
  isPinned: boolean;
  onTogglePin: (id: ChangesToolbarItemId) => void;
}): ReactElement {
  const { t } = useTranslation();
  const iconSize = useIconSize();
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleTogglePin = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onTogglePin(item.id);
    },
    [item.id, onTogglePin],
  );

  const showToggle = isHovered || isNative || isPinned;
  const slotStyle = useMemo(
    () => [styles.pinToggleSlot, showToggle ? styles.pinToggleShown : styles.pinToggleHidden],
    [showToggle],
  );
  const trailingSpacer = useMemo(() => <View style={slotStyle} />, [slotStyle]);

  let pinIcon = <ThemedPin size={iconSize.sm} uniProps={mutedColorMapping} />;
  if (isPinned) {
    pinIcon = isHovered ? (
      <ThemedPinOff size={iconSize.sm} uniProps={mutedColorMapping} />
    ) : (
      <ThemedPinFilled size={iconSize.sm} uniProps={starColorMapping} />
    );
  }

  return (
    <View
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={styles.menuItemContainer}
    >
      <DropdownMenuItem
        testID={item.testID}
        leading={item.renderIcon(iconSize.sm)}
        trailing={trailingSpacer}
        disabled={item.disabled}
        onSelect={item.onPress}
      >
        {item.label}
      </DropdownMenuItem>
      <View style={styles.pinToggleOverlay} pointerEvents={showToggle ? "auto" : "none"}>
        <Pressable
          onPress={handleTogglePin}
          hitSlop={8}
          style={styles.pinToggleButton}
          accessibilityRole="button"
          accessibilityLabel={
            isPinned
              ? t("workspace.tabs.actions.unpinTarget")
              : t("workspace.tabs.actions.pinTarget")
          }
          testID={`changes-toolbar-pin-toggle-${item.id}`}
        >
          {pinIcon}
        </Pressable>
      </View>
    </View>
  );
}

export interface ChangesToolbarProps {
  items: ChangesToolbarItem[];
  pinnedItems: readonly ChangesToolbarItemId[];
  onTogglePin: (id: ChangesToolbarItemId) => void;
  /** True while the pointer is over the toolbar row (web). */
  hovered: boolean;
  isMobile: boolean;
  /**
   * When true, the pinned strip stays hidden (opacity-gated) until the row is
   * hovered. When false (the default behavior), pinned options are always
   * visible. Driven by the "Hide pinned toolbar options" appearance setting.
   */
  hideUntilHover: boolean;
  optionsLabel: string;
}

/**
 * The Changes toolbar: pinned options render as an icon strip that is invisible
 * (opacity-gated, geometry preserved) until the row is hovered — matching the
 * tab bar (docs/hover.md) — followed by an always-visible ▾ menu listing every
 * option with a pin toggle. On native/compact everything is always visible.
 */
export function ChangesToolbar({
  items,
  pinnedItems,
  onTogglePin,
  hovered,
  isMobile,
  hideUntilHover,
  optionsLabel,
}: ChangesToolbarProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  // Keep the strip revealed while the menu is open — the pointer is inside the
  // portaled menu then, which reads as "left the row" to the hover tracker.
  // With hide-until-hover off (the default), the strip is always revealed.
  const revealed = !hideUntilHover || hovered || isNative || isMobile || menuOpen;
  // Doubled on compact via the icon-size tokens (14 desktop / 28 mobile).
  const barIconSize = useIconSize().sm;

  const pinnedButtons = useMemo(
    () => items.filter((item) => isChangesToolbarItemPinned(pinnedItems, item.id)),
    [items, pinnedItems],
  );

  const pinnedRowStyle = useMemo(
    () => [styles.pinnedRow, revealed ? null : styles.hidden],
    [revealed],
  );

  return (
    <View style={styles.row}>
      <View style={pinnedRowStyle} pointerEvents={revealed ? "auto" : "none"}>
        {pinnedButtons.map((item) => (
          <ChangesToolbarButton key={item.id} item={item} size={barIconSize} />
        ))}
      </View>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              accessibilityRole="button"
              accessibilityLabel={optionsLabel}
              testID="changes-options-menu"
              style={toolbarButtonStyle}
            >
              <ThemedChevronDown size={barIconSize} uniProps={mutedColorMapping} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Text style={styles.tooltipText}>{optionsLabel}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" width={240} testID="changes-options-menu-content">
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separatorBefore ? <DropdownMenuSeparator /> : null}
              <ChangesPinnableMenuItem
                item={item}
                isPinned={isChangesToolbarItemPinned(pinnedItems, item.id)}
                onTogglePin={onTogglePin}
              />
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  pinnedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  hidden: {
    opacity: 0,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    minWidth: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    height: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    paddingHorizontal: {
      xs: theme.spacing[2],
      sm: theme.spacing[2],
      md: theme.spacing[1],
    },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  menuItemContainer: {
    position: "relative",
  },
  pinToggleSlot: {
    // 1.5x on compact to wrap the pin icons' compact upscale.
    width: compactUp(22, 1.5),
    height: compactUp(22, 1.5),
    alignItems: "center",
    justifyContent: "center",
  },
  pinToggleHidden: {
    opacity: 0,
  },
  pinToggleShown: {
    opacity: 1,
  },
  pinToggleOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: theme.spacing[3],
    width: compactUp(22, 1.5),
    alignItems: "center",
    justifyContent: "center",
  },
  pinToggleButton: {
    width: compactUp(22, 1.5),
    height: compactUp(22, 1.5),
    alignItems: "center",
    justifyContent: "center",
  },
}));
