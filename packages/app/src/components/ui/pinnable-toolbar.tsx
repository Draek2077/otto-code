import { Fragment, useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
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
import { useToolbarIconButtonStyle } from "@/components/ui/toolbar-icon-button";
import { isNative } from "@/constants/platform";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";
import type { IconSizeProp } from "@/components/icons/icon-size";

/**
 * The pane-toolbar option strip shared by Changes and project Search: every
 * option lives in the ▾ menu and can be pinned into the strip beside it.
 * Pins are global (device-local), not per-workspace, and each surface persists
 * its own catalog of pinned ids.
 */
export function isToolbarItemPinned<Id extends string>(pinned: readonly Id[], id: Id): boolean {
  return pinned.includes(id);
}

export function togglePinnedToolbarItem<Id extends string>(pinned: readonly Id[], id: Id): Id[] {
  const next = pinned.filter((entry) => entry !== id);
  if (next.length === pinned.length) {
    next.push(id);
  }
  return next;
}

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// Pinned state uses the same gold as a favorited star.
const starColorMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedPin = withUnistyles(Pin);
const ThemedPinFilled = withUnistyles(PinFilled);
const ThemedPinOff = withUnistyles(PinOff);

/**
 * A single toolbar option. `renderIcon` returns the current-state glyph
 * (e.g. Columns2 vs AlignJustify for a split toggle) at the requested size,
 * and `label` is the current-state action ("Wrap long lines" etc.),
 * used as both the tooltip and the menu row label so the menu and strip stay in
 * lockstep.
 */
export interface PinnableToolbarItem<Id extends string = string> {
  id: Id;
  label: string;
  renderIcon: (size: IconSizeProp) => ReactElement;
  onPress: () => void;
  disabled?: boolean;
  /** Draw a menu separator above this item (used before Refresh). */
  separatorBefore?: boolean;
  testID?: string;
}

function PinnableToolbarButton({
  item,
  size,
  testIDPrefix,
}: {
  item: PinnableToolbarItem;
  size: number;
  testIDPrefix: string;
}): ReactElement {
  const buttonStyle = useToolbarIconButtonStyle({ disabled: item.disabled, style: styles.button });
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={item.label}
        testID={item.testID ? `${item.testID}-pinned` : `${testIDPrefix}-${item.id}`}
        disabled={item.disabled}
        onPress={item.onPress}
        style={buttonStyle}
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
function PinnableToolbarMenuItem({
  item,
  isPinned,
  testIDPrefix,
  onTogglePin,
}: {
  item: PinnableToolbarItem;
  isPinned: boolean;
  testIDPrefix: string;
  onTogglePin: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
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

  let pinIcon = <ThemedPin size="sm" uniProps={mutedColorMapping} />;
  if (isPinned) {
    pinIcon = isHovered ? (
      <ThemedPinOff size="sm" uniProps={mutedColorMapping} />
    ) : (
      <ThemedPinFilled size="sm" uniProps={starColorMapping} />
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
        leading={item.renderIcon("sm")}
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
          testID={`${testIDPrefix}-pin-toggle-${item.id}`}
        >
          {pinIcon}
        </Pressable>
      </View>
    </View>
  );
}

export interface PinnableToolbarProps<Id extends string> {
  items: PinnableToolbarItem<Id>[];
  pinnedItems: readonly Id[];
  onTogglePin: (id: Id) => void;
  /** True while the pointer is over the toolbar row (web). */
  hovered: boolean;
  isMobile: boolean;
  /**
   * When true, the pinned strip stays hidden (opacity-gated) until the row is
   * hovered. When false (the default behavior), pinned options are always
   * visible. Project Search keeps its pinned options visible.
   */
  hideUntilHover: boolean;
  optionsLabel: string;
  /**
   * Prefixes every generated testID: `<prefix>-options-menu` for the ▾ trigger,
   * `<prefix>-options-menu-content` for its list, `<prefix>-pin-toggle-<itemId>`
   * for a pin, and `<prefix>-<itemId>` for a pinned button that brought no
   * testID of its own. Keeps two surfaces carrying this toolbar addressable
   * apart ("changes" and "project-search" today).
   */
  testIDPrefix: string;
}

/**
 * The toolbar: pinned options render as an icon strip that is invisible
 * (opacity-gated, geometry preserved) until the row is hovered - matching the
 * tab bar (docs/hover.md) - followed by an always-visible ▾ menu listing every
 * option with a pin toggle. On native/compact everything is always visible.
 */
export function PinnableToolbar<Id extends string>({
  items,
  pinnedItems,
  onTogglePin,
  hovered,
  isMobile,
  hideUntilHover,
  optionsLabel,
  testIDPrefix,
}: PinnableToolbarProps<Id>): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const optionsButtonStyle = useToolbarIconButtonStyle({
    selected: menuOpen,
    style: styles.button,
  });

  // Keep the strip revealed while the menu is open - the pointer is inside the
  // portaled menu then, which reads as "left the row" to the hover tracker.
  // With hide-until-hover off (the default), the strip is always revealed.
  const revealed = !hideUntilHover || hovered || isNative || isMobile || menuOpen;
  // Doubled on compact via the icon-size tokens (14 desktop / 28 mobile).
  const barIconSize = useIconSize().sm;

  const pinnedButtons = useMemo(
    () => items.filter((item) => isToolbarItemPinned(pinnedItems, item.id)),
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
          <PinnableToolbarButton
            key={item.id}
            item={item}
            size={barIconSize}
            testIDPrefix={testIDPrefix}
          />
        ))}
      </View>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              accessibilityRole="button"
              accessibilityLabel={optionsLabel}
              testID={`${testIDPrefix}-options-menu`}
              style={optionsButtonStyle}
            >
              <ThemedChevronDown size={barIconSize} uniProps={mutedColorMapping} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Text style={styles.tooltipText}>{optionsLabel}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          width={240}
          testID={`${testIDPrefix}-options-menu-content`}
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separatorBefore ? <DropdownMenuSeparator /> : null}
              <PinnableToolbarMenuItem
                item={item}
                isPinned={isToolbarItemPinned(pinnedItems, item.id)}
                testIDPrefix={testIDPrefix}
                onTogglePin={onTogglePin as (id: string) => void}
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
