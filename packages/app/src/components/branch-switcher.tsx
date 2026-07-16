import { useCallback, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, GitBranch } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIconSize, type Theme } from "@/styles/theme";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher } from "@/hooks/use-branch-switcher";

interface BranchSwitcherProps {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  testID?: string;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

export function BranchSwitcher({
  currentBranchName,
  serverId,
  workspaceId,
  workspaceDirectory,
  isGitCheckout,
  testID = "workspace-header-branch-switcher",
}: BranchSwitcherProps) {
  const { t } = useTranslation();
  const iconSize = useIconSize();
  const anchorRef = useRef<View>(null);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();

  const { branchOptions, isOpen, setIsOpen, handleBranchSelect, isSwitching } = useBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory,
    currentBranchName,
    isGitCheckout,
    isConnected,
    toast,
    queryClient,
  });

  const handleOpen = useCallback(() => setIsOpen(true), [setIsOpen]);

  const triggerStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      !isSwitching && (Boolean(hovered) || pressed) && styles.triggerHovered,
      isSwitching && styles.triggerDisabled,
    ],
    [isSwitching],
  );

  const branchLeadingSlot = useMemo(
    () => <ThemedGitBranch size={iconSize.sm} uniProps={foregroundMutedIconColorMapping} />,
    [iconSize.sm],
  );

  const renderBranchOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        description={option.description}
        selected={selected}
        active={active}
        disabled={option.disabled}
        onPress={onPress}
        leadingSlot={branchLeadingSlot}
      />
    ),
    [branchLeadingSlot],
  );

  if (!currentBranchName) {
    return null;
  }

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Pressable
        testID={testID}
        onPress={handleOpen}
        disabled={isSwitching}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={
          isSwitching
            ? t("branchSwitcher.switchInProgress")
            : t("branchSwitcher.currentBranch", { branchName: currentBranchName })
        }
      >
        <ThemedGitBranch size={iconSize.sm} uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.branchLabel} numberOfLines={1}>
          {currentBranchName}
        </Text>
        {isSwitching ? (
          <ThemedActivityIndicator size="small" uniProps={foregroundMutedIconColorMapping} />
        ) : (
          <ThemedChevronDown size={iconSize.xs} uniProps={foregroundMutedIconColorMapping} />
        )}
      </Pressable>
      <Combobox
        options={branchOptions}
        value={currentBranchName}
        onSelect={handleBranchSelect}
        searchable
        placeholder={t("branchSwitcher.placeholder")}
        searchPlaceholder={t("branchSwitcher.searchPlaceholder")}
        emptyText={t("branchSwitcher.empty")}
        title={t("branchSwitcher.title")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={280}
        renderOption={renderBranchOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    flexShrink: 1,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  triggerDisabled: {
    opacity: 0.6,
  },
  branchLabel: {
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    // Explicit line height so the label's box never rides platform font
    // metrics (Linux ascenders / ALL-CAPS branch names rendered taller).
    // Mirrors GitActionsSplitButton's splitButtonText, which sits beside
    // this in the Changes header on compact.
    lineHeight: {
      xs: (theme.fontSize.sm + 2) * 1.5,
      md: theme.fontSize.sm * 1.5,
    },
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
}));
