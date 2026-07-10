import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, Info, MoreVertical } from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useToast } from "@/contexts/toast-context";
import type { GitAction, GitActions } from "@/git/policy";

interface GitActionsSplitButtonProps {
  gitActions: GitActions;
  hideLabels?: boolean;
  // Stretch to fill the available width (content stays centered).
  fill?: boolean;
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
      action.id === "archive-worktree" && archiveShortcutKeys ? (
        <Shortcut chord={archiveShortcutKeys} />
      ) : undefined,
    [action.id, archiveShortcutKeys],
  );
  return (
    <View>
      {needsSeparator && showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        testID={
          action.id === "archive-worktree"
            ? "workspace-archive-action"
            : `changes-menu-${action.id}`
        }
        leading={action.icon}
        trailing={trailing}
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
}: GitActionsSplitButtonProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const toast = useToast();
  const archiveShortcutKeys = useShortcutKeys("archive-worktree");

  const getActionDisplayLabel = useCallback((action: GitAction): string => {
    if (action.status === "pending") return action.pendingLabel;
    if (action.status === "success") return action.successLabel;
    return action.label;
  }, []);

  const handleActionSelect = useCallback(
    (action: GitAction) => {
      if (action.unavailableMessage) {
        toast.show(action.unavailableMessage, {
          durationMs: 3200,
          icon: <Info size={16} color={theme.colors.foreground} />,
        });
        return;
      }
      action.handler();
    },
    [theme.colors.foreground, toast],
  );

  const handlePrimaryPress = useCallback(() => {
    if (!gitActions.primary) {
      return;
    }
    handleActionSelect(gitActions.primary);
  }, [gitActions.primary, handleActionSelect]);

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
  const splitButtonStyle = useMemo(
    () => [styles.splitButton, Boolean(fill) && styles.fillItem],
    [fill],
  );

  const primaryDisabled = gitActions.primary?.disabled;
  const primaryPressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.splitButtonPrimary,
      Boolean(fill) && styles.fillItem,
      (Boolean(hovered) || pressed) &&
        inlineUnistylesStyle({ backgroundColor: theme.colors.surfaceHover }),
      primaryDisabled && styles.splitButtonPrimaryDisabled,
    ],
    [fill, primaryDisabled, theme.colors.surfaceHover],
  );

  const caretTriggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.splitButtonCaret,
      (hovered || pressed || open) &&
        inlineUnistylesStyle({ backgroundColor: theme.colors.surfaceHover }),
    ],
    [theme.colors.surfaceHover],
  );

  return (
    <View style={rowStyle}>
      {gitActions.primary ? (
        <View style={splitButtonStyle}>
          <Pressable
            testID="changes-primary-cta"
            style={primaryPressableStyle}
            onPress={handlePrimaryPress}
            disabled={gitActions.primary.disabled}
            accessibilityRole="button"
            accessibilityLabel={gitActions.primary.label}
          >
            {gitActions.primary.status === "pending" ? (
              <ActivityIndicator
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
          </Pressable>
          {gitActions.secondary.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                testID="changes-primary-cta-caret"
                style={caretTriggerStyle}
                accessibilityRole="button"
                accessibilityLabel={t("workspace.git.actions.moreOptions")}
              >
                <ChevronDown size={16} color={theme.colors.foregroundMuted} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" testID="changes-primary-cta-menu">
                {gitActions.secondary.map((action, index) => (
                  <GitActionMenuItem
                    key={action.id}
                    action={action}
                    onSelect={handleActionSelect}
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
        </View>
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
            <MoreVertical size={16} color={theme.colors.foregroundMuted} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={220} testID="changes-overflow-content">
            {gitActions.menu.map((action) => (
              <GitActionMenuItem
                key={action.id}
                action={action}
                onSelect={handleActionSelect}
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
  splitButton: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
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
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  splitButtonSpinnerOnly: {
    transform: [{ scale: 0.8 }],
  },
  splitButtonCaret: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.borderAccent,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  overflowMenuButton: {
    marginRight: -theme.spacing[2],
  },
}));
