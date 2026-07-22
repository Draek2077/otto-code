import { useCallback, useMemo, type PropsWithChildren, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Archive,
  BookOpen,
  CircleCheck,
  Copy,
  FolderOpen,
  MoreVertical,
  Pencil,
} from "@/components/icons/material-icons";
import { isNative, isWeb } from "@/constants/platform";
import { openContextManagementTab } from "@/context-management/open-context-management-tab";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedCopy = withUnistyles(Copy);
const ThemedArchive = withUnistyles(Archive);
const ThemedBookOpen = withUnistyles(BookOpen);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCircleCheck = withUnistyles(CircleCheck);

const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const markAsReadLeadingIcon = (
  <ThemedCircleCheck size={14} uniProps={foregroundMutedColorMapping} />
);
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const contextLeadingIcon = <ThemedBookOpen size={14} uniProps={foregroundMutedColorMapping} />;
const openBaseCheckoutLeadingIcon = (
  <ThemedFolderOpen size={14} uniProps={foregroundMutedColorMapping} />
);

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

interface SidebarWorkspaceMenuProps {
  workspaceKey: string;
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onOpenBaseCheckout?: () => void;
  serverId?: string;
  workspaceId?: string;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}

/** Common shape shared by `DropdownMenuItem` and `ContextMenuItem` — lets the
 * kebab dropdown and the right-click context menu render identical items from
 * one source instead of maintaining two copies that can drift apart. */
export type WorkspaceMenuItemComponent = (
  props: PropsWithChildren<{
    testID?: string;
    leading?: ReactElement | null;
    trailing?: ReactElement | null;
    onSelect?: () => void;
    status?: "idle" | "pending" | "success";
    pendingLabel?: string;
  }>,
) => ReactElement;

export interface WorkspaceMenuItemsProps {
  ItemComponent: WorkspaceMenuItemComponent;
  workspaceKey: string;
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onOpenBaseCheckout?: () => void;
  serverId?: string;
  workspaceId?: string;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}

export function WorkspaceMenuItems({
  ItemComponent: Item,
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onOpenBaseCheckout,
  serverId,
  workspaceId,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
}: WorkspaceMenuItemsProps) {
  const { t } = useTranslation();
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys && !isNative ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  // Owned here rather than passed in: this menu has five render sites, and a
  // per-site callback meant every one of them had to remember to wire it. The
  // row already knows its ids, so handing those over is enough.
  const handleManageContext = useCallback(() => {
    if (!serverId || !workspaceId) return;
    openContextManagementTab({ serverId, workspaceId, navigate: true });
  }, [serverId, workspaceId]);
  return (
    <>
      {onCopyPath ? (
        <Item
          testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyPath}
        >
          {t("sidebar.workspace.actions.copyPath")}
        </Item>
      ) : null}
      {onCopyBranchName ? (
        <Item
          testID={`sidebar-workspace-menu-copy-branch-name-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyBranchName}
        >
          {t("sidebar.workspace.actions.copyBranchName")}
        </Item>
      ) : null}
      {onRename ? (
        <Item
          testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
          leading={renameLeadingIcon}
          onSelect={onRename}
        >
          {t("sidebar.workspace.actions.rename")}
        </Item>
      ) : null}
      {onMarkAsRead ? (
        <Item
          testID={`sidebar-workspace-menu-mark-as-read-${workspaceKey}`}
          leading={markAsReadLeadingIcon}
          onSelect={onMarkAsRead}
        >
          Mark as read
        </Item>
      ) : null}
      {serverId && workspaceId ? (
        <Item
          testID={`sidebar-workspace-menu-context-management-${workspaceKey}`}
          leading={contextLeadingIcon}
          onSelect={handleManageContext}
        >
          {t("workspace.contextManagement.openAction")}
        </Item>
      ) : null}
      {onOpenBaseCheckout ? (
        <Item
          testID={`sidebar-workspace-menu-open-base-checkout-${workspaceKey}`}
          leading={openBaseCheckoutLeadingIcon}
          onSelect={onOpenBaseCheckout}
        >
          {t("sidebar.workspace.actions.openBaseCheckout")}
        </Item>
      ) : null}
      <Item
        testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
        leading={archiveLeadingIcon}
        trailing={archiveTrailing}
        status={archiveStatus}
        pendingLabel={archivePendingLabel}
        onSelect={onArchive}
      >
        {archiveLabel ?? t("sidebar.workspace.actions.archive")}
      </Item>
    </>
  );
}

export function SidebarWorkspaceMenu({
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onOpenBaseCheckout,
  serverId,
  workspaceId,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260}>
        <WorkspaceMenuItems
          ItemComponent={DropdownMenuItem}
          workspaceKey={workspaceKey}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onMarkAsRead={onMarkAsRead}
          onOpenBaseCheckout={onOpenBaseCheckout}
          serverId={serverId}
          workspaceId={workspaceId}
          onArchive={onArchive}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
