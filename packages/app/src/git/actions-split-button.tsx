import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCallback, useEffect, useMemo } from "react";
import { View, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, MoreVertical } from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SplitButton,
  SplitButtonMenuTrigger,
  SplitButtonPrimary,
} from "@/components/ui/split-button";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { compactUp } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { GitAction, GitActions } from "@/git/policy";
import { useGitActionRunner } from "@/git/use-actions";

interface GitActionsSplitButtonProps {
  gitActions: GitActions;
  hideLabels?: boolean;
  // Stretch to fill the available width (content stays centered).
  fill?: boolean;
  /** Reports whether this workspace contributes a visible toolbar control. */
  onAvailabilityChange?: (available: boolean) => void;
  tooltipSide?: "top" | "bottom";
  /** Upstream: compact surfaces render the actions as a menu with no split button. */
  menuOnly?: boolean;
}

interface GitActionMenuItemProps {
  action: GitAction;
  onSelect: (action: GitAction) => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  needsSeparator?: boolean;
  showSeparator?: boolean;
  closeOnSelect?: boolean;
}

function GitActionMenuItem({
  action,
  onSelect,
  archiveShortcutKeys,
  needsSeparator,
  showSeparator,
  closeOnSelect,
}: GitActionMenuItemProps) {
  const handleSelect = useCallback(() => onSelect(action), [onSelect, action]);
  const trailing = useMemo(
    () =>
      action.id === "archive-workspace" && archiveShortcutKeys ? (
        <Shortcut chord={archiveShortcutKeys} />
      ) : undefined,
    [action.id, archiveShortcutKeys],
  );
  return (
    <View>
      {needsSeparator && showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        testID={
          action.id === "archive-workspace"
            ? "workspace-archive-action"
            : `changes-menu-${action.id}`
        }
        leading={action.icon}
        trailing={trailing}
        description={action.description}
        disabled={action.disabled}
        muted={Boolean(action.unavailableMessage)}
        status={action.status}
        pendingLabel={action.pendingLabel}
        successLabel={action.successLabel}
        closeOnSelect={closeOnSelect}
        onSelect={handleSelect}
      >
        {action.label}
      </DropdownMenuItem>
    </View>
  );
}

export function GitActionsSplitButton({
  gitActions,
  hideLabels,
  fill,
  onAvailabilityChange,
  tooltipSide = "bottom",
}: GitActionsSplitButtonProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const runGitAction = useGitActionRunner();
  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const isAvailable = Boolean(gitActions.primary) || gitActions.menu.length > 0;
  useEffect(() => onAvailabilityChange?.(isAvailable), [isAvailable, onAvailabilityChange]);

  const getActionDisplayLabel = useCallback((action: GitAction): string => {
    if (action.status === "pending") return action.pendingLabel;
    if (action.status === "success") return action.successLabel;
    return action.label;
  }, []);

  const handlePrimaryPress = useCallback(() => {
    if (!gitActions.primary) {
      return;
    }
    runGitAction(gitActions.primary);
  }, [gitActions.primary, runGitAction]);

  const overflowMenuButtonStyle = useMemo(
    () => [
      styles.iconButton,
      // The negative header-edge margin would spill into padded containers
      // when the button stretches to fill them.
      !fill && styles.overflowMenuButton,
    ],
    [fill],
  );

  const rowStyle = useMemo(() => [styles.row, Boolean(fill) && styles.fillItem], [fill]);
  const primaryDisabled = gitActions.primary?.disabled;
  const primaryPressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.splitButtonPrimary,
      Boolean(fill) && styles.fillItem,
      // The canonical hover wash matches `headerIconSlotStyle.slotHovered`, so every
      // hoverable thing in the workspace header row lands on one backdrop. The
      // sidebar-tools and mobile diff-toolbar copies of this button inherit it
      // too - same control, same chrome.
      (Boolean(hovered) || pressed) &&
        inlineUnistylesStyle({ backgroundColor: theme.colors.surfaceInteractiveHover }),
      primaryDisabled && styles.splitButtonPrimaryDisabled,
    ],
    [fill, primaryDisabled, theme.colors.surfaceInteractiveHover],
  );

  const caretTriggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.splitButtonCaret,
      (hovered || pressed || open) &&
        inlineUnistylesStyle({ backgroundColor: theme.colors.surfaceInteractiveHover }),
    ],
    [theme.colors.surfaceInteractiveHover],
  );

  // With nothing to show, render nothing rather than an empty row. In the
  // sidebar tools cluster every child carries `fill` (flexGrow: 1), so an empty
  // View would still claim an equal share of the row and push a lone sibling
  // (e.g. the "Open" button) off-center.
  if (!isAvailable) {
    return null;
  }

  return (
    <View style={rowStyle}>
      {gitActions.primary ? (
        <SplitButton
          hasMenu={gitActions.secondary.length > 0}
          style={Boolean(fill) && styles.fillItem}
        >
          <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <SplitButtonPrimary
                testID="changes-primary-cta"
                style={primaryPressableStyle}
                onPress={handlePrimaryPress}
                disabled={gitActions.primary.disabled}
                accessibilityRole="button"
                accessibilityLabel={gitActions.primary.label}
              >
                {gitActions.primary.status === "pending" ? (
                  <LoadingSpinner
                    size="small"
                    color={theme.colors.foreground}
                    style={styles.splitButtonSpinnerOnly}
                  />
                ) : (
                  <View style={styles.splitButtonContent}>
                    {gitActions.primary.icon}
                    {!hideLabels && (
                      <Text style={styles.splitButtonText} numberOfLines={1}>
                        {getActionDisplayLabel(gitActions.primary)}
                      </Text>
                    )}
                  </View>
                )}
              </SplitButtonPrimary>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} align="center" offset={8}>
              <Text style={styles.tooltipText}>{getActionDisplayLabel(gitActions.primary)}</Text>
            </TooltipContent>
          </Tooltip>
          {gitActions.secondary.length > 0 ? (
            <DropdownMenu>
              <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
                <TooltipTrigger asChild>
                  <SplitButtonMenuTrigger
                    testID="changes-primary-cta-caret"
                    style={caretTriggerStyle}
                    accessibilityRole="button"
                    accessibilityLabel={t("workspace.git.actions.moreOptions")}
                  >
                    <ChevronDown size="md" color={theme.colors.foregroundMuted} />
                  </SplitButtonMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side={tooltipSide} align="center" offset={8}>
                  <Text style={styles.tooltipText}>{t("workspace.git.actions.moreOptions")}</Text>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" testID="changes-primary-cta-menu">
                {gitActions.secondary.map((action, index) => (
                  <GitActionMenuItem
                    key={action.id}
                    action={action}
                    onSelect={runGitAction}
                    archiveShortcutKeys={archiveShortcutKeys}
                    needsSeparator={action.startsGroup}
                    showSeparator={index > 0}
                    closeOnSelect={
                      action.status === "idle" &&
                      action.id === "pr" &&
                      action.label === action.pendingLabel &&
                      action.label === action.successLabel
                    }
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </SplitButton>
      ) : null}
      {gitActions.menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            testID="changes-overflow-menu"
            hitSlop={8}
            style={overflowMenuButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.git.actions.moreActions")}
          >
            <MoreVertical size="md" color={theme.colors.foregroundMuted} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={220} testID="changes-overflow-content">
            {gitActions.menu.map((action) => (
              <GitActionMenuItem
                key={action.id}
                action={action}
                onSelect={runGitAction}
                closeOnSelect={false}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  fillItem: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  splitButtonPrimary: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    justifyContent: "center",
    position: "relative",
  },
  splitButtonPrimaryDisabled: {
    opacity: 0.6,
  },
  splitButtonText: {
    // Explicit compact bump matching the branch switcher's label so the two
    // header combos read at the same size on mobile.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    lineHeight: {
      xs: (theme.fontSize.sm + 2) * 1.5,
      md: theme.fontSize.sm * 1.5,
    },
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    // Icon-only content (16px) is shorter than the label's line height - pin
    // the same minimum so all three workspace-tools split buttons match.
    minHeight: {
      xs: (theme.fontSize.sm + 2) * 1.5,
      md: theme.fontSize.sm * 1.5,
    },
  },
  splitButtonSpinnerOnly: {
    transform: [{ scale: 0.8 }],
    minHeight: {
      xs: (theme.fontSize.sm + 2) * 1.5,
      md: theme.fontSize.sm * 1.5,
    },
  },
  splitButtonCaret: {
    // 1.5x on compact to wrap the caret icon's compact upscale.
    width: compactUp(28, 1.5),
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: {
    width: compactUp(32, 1.5),
    height: compactUp(32, 1.5),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  overflowMenuButton: {
    marginRight: -theme.spacing[2],
  },
}));
