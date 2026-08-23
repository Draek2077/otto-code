import { memo, useMemo, useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import {
  WorkspaceMetaRow,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  hasSidebarWorkspaceTrailing,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import { useAppSettings } from "@/hooks/use-settings";
import { compactUp } from "@/styles/theme";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";
import { StatusRing } from "@/components/status-ring";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    contextMenuOpen: boolean;
    onContextMenuOpenChange: (open: boolean) => void;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => {
    if (!contextMenuOpen) setIsHovered(true);
  }, [contextMenuOpen]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    setContextMenuOpen(open);
    if (open) setIsHovered(false);
  }, []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard
      workspace={workspace}
      prHint={workspace.prHint}
      isDragging={isDragging}
      disabled={contextMenuOpen}
    >
      {children({
        isHovered: isHovered && !contextMenuOpen,
        contextMenuOpen,
        onContextMenuOpenChange: handleContextMenuOpenChange,
        hoverHandlers,
      })}
    </WorkspaceHoverCard>
  );
}

export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  hostBadge,
  leadingProjectName = null,
  leadingProjectIconDataUri = null,
  serviceSummary = null,
  backdrop,
  isHovered,
  isSelected = false,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  reserveIdleStatusIndicatorSpace = true,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  /** Hoisted rows use their project icon as the leading visual because no project row contains them. */
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  serviceSummary?: WorkspaceServiceSummary | null;
  /** The row's current background, so the project status badge can knock out of it. */
  backdrop: SidebarSurfaceBackdrop;
  isHovered: boolean;
  /** The row is the active workspace, so its title takes the accent the selected explorer tab uses. */
  isSelected?: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  /** Keep the empty leading slot when the workspace has no active status. */
  reserveIdleStatusIndicatorSpace?: boolean;
  children?: ReactNode;
}) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
      isSelected && styles.workspaceBranchTextSelected,
    ],
    [isHovered, isCreating, isSelected],
  );

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        {leadingProjectName ? (
          <ProjectStatusIndicator
            iconDataUri={leadingProjectIconDataUri}
            displayName={leadingProjectName}
            projectViewKey={workspace.projectViewKey}
            statusBucket={workspace.statusBucket}
            backdrop={backdrop}
            hasActiveChat={workspace.hasActiveChat}
            testID={`sidebar-row-project-icon-${workspace.workspaceKey}`}
          />
        ) : (
          <WorkspaceStatusIndicator
            bucket={workspace.statusBucket}
            hasActiveChat={workspace.hasActiveChat}
            reserveIdleSpace={reserveIdleStatusIndicatorSpace}
          />
        )}
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <Text style={workspaceBranchTextStyle} numberOfLines={1}>
              {workspaceLabel}
            </Text>
          </View>
          <WorkspaceMetaRow
            hostBadge={hostBadge ?? null}
            prHint={workspace.prHint}
            serviceSummary={serviceSummary}
          />
        </View>
        <View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View>
      </View>
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

function WorkspaceStatusIndicator({
  bucket,
  hasActiveChat = false,
  reserveIdleSpace = true,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  hasActiveChat?: boolean;
  reserveIdleSpace?: boolean;
}) {
  // A running root chat adds motion around the semantic status dot rather than replacing it.
  if (hasActiveChat) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
        <StatusRing centerStyle={getWorkspaceStatusDotColor(bucket)} />
      </View>
    );
  }

  if (bucket === "done") {
    // An idle row still gets a dot rather than an empty slot. Nested rows are marked as
    // workspaces by indentation alone, and with nothing in the leading slot the rail has no
    // edge to read against — a workspace carrying its own glyph starts looking like a project
    // header. The dot is muted to half opacity so it holds the rail without reporting status.
    return reserveIdleSpace ? (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-done">
        <WorkspaceStatusDot bucket={bucket} />
      </View>
    ) : null;
  }

  return (
    <View style={styles.workspaceStatusDot} testID={`workspace-status-indicator-${bucket}`}>
      <WorkspaceStatusDot bucket={bucket} />
    </View>
  );
}

function WorkspaceStatusDot({ bucket }: { bucket: SidebarWorkspaceEntry["statusBucket"] }) {
  return <View style={[styles.statusDot, getWorkspaceStatusDotColor(bucket)]} />;
}

function getWorkspaceStatusDotColor(bucket: SidebarWorkspaceEntry["statusBucket"]) {
  switch (bucket) {
    case "needs_input":
      return styles.statusDotNeedsInput;
    case "failed":
      return styles.statusDotFailed;
    case "running":
      return styles.statusDotRunning;
    case "attention":
      return styles.statusDotAttention;
    case "done":
      return styles.statusDotDone;
  }
}

/**
 * The kebab's touch target. Shared with the trigger box in `sidebar-workspace-menu.tsx` so the
 * slot that has to hold the control cannot drift from the control itself. `compactUp` doubles it
 * on compact form factors, which is the whole reason the slot has to reserve room for it.
 */
export const SIDEBAR_ROW_ACTION_SIZE = 24;

// What the trailing slot reserves for the action. Desktop keeps the 20px title-line box: a 24px
// control overhangs it by 2px per side and still lands inside the row's padding. Compact doubles
// the control to a 48px touch target, which cannot overhang anything without painting outside the
// row entirely - on a single-line row it used to spill onto the row below - so there the slot
// reserves the target's full size and the row grows to hold it.
const trailingActionSlotMinHeight = {
  ...compactUp(SIDEBAR_ROW_ACTION_SIZE),
  md: 20,
  lg: 20,
  xl: 20,
};
// The width the slot holds while the action is painted. The kebab is drawn as an overlay so it
// cannot push the title itself, and a slot narrower than the control lets it paint over the
// title's truncation ellipsis. Held only while the action is actually visible: with the action
// away the title is free to use the whole row, and reserving a rail for something that is not
// there reads as a ragged right edge.
const trailingActionSlotMinWidth = compactUp(SIDEBAR_ROW_ACTION_SIZE);

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
  // How far a workspace row sits inside the group header above it — a project row or a
  // status group header. Both groupings share this one indent, so every grouped workspace row
  // in the sidebar sits on the same rail regardless of how the list is grouped. Pinned rows
  // are not grouped and stay flush.
  //
  // It is row padding rather than a margin on the list, because the row's hover and selected
  // backgrounds have to keep spanning the group's full width. Indenting the container instead
  // pulls the highlight in with the content and the row stops lining up with its header.
  rowIndented: {
    paddingLeft: theme.spacing[2] + theme.spacing[2],
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  hidden: { opacity: 0 },
  // Stays position:relative so the absolutely-positioned kebab anchors to the same right edge
  // whether or not the slot currently holds trailing content. Height is held unconditionally -
  // it is what centres the action on the row - but width is not, so an idle row spends none of
  // it on an action that is not painted.
  trailingActionSlot: {
    position: "relative",
    minHeight: trailingActionSlotMinHeight,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  // While the action is painted the slot holds its full box, so the title truncates beside the
  // control rather than underneath it.
  trailingActionSlotReserved: {
    position: "relative",
    minWidth: trailingActionSlotMinWidth,
    minHeight: trailingActionSlotMinHeight,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    // The action target is taller than the title glyph, so it centers on the slot rather than
    // hanging off its top edge - stretching to both edges and centering keeps a 24px control
    // optically on the desktop title line and keeps the 48px compact target inside the row.
    // The trailing diff or timestamp stays on the title line and must not ride along with it.
    justifyContent: "center",
    zIndex: 1,
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
}

/**
 * What the trailing slot shows for a row. Derived in one place because three row renderers
 * share it: the two project-mode rows and the status-mode row. The rule used to be copied
 * into each of them and immediately drifted — one call site kept hiding the diff after the
 * others stopped.
 *
 * Hover actions own the trailing slot. When the kebab appears, the diff or timestamp disappears
 * so the action remains readable and never competes with the row metadata.
 */
export function resolveTrailingActionVisibility({
  workspace,
  trailing,
  hasArchiveAction,
  isHovered,
  isTouchPlatform,
  isCompact,
  showShortcut,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  hasArchiveAction: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  /**
   * Compact layouts show the action outright. Hover is the desktop reveal, and it either never
   * fires (touch) or is a pointer the layout is not designed around, so gating on it there
   * leaves the row with no visible way into its own menu.
   */
  isCompact: boolean;
  showShortcut: boolean;
}): {
  showTrailing: boolean;
  showKebab: boolean;
  renderSlot: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  const showKebab =
    Boolean(hasArchiveAction && (isHovered || isTouchPlatform || isCompact)) && !showShortcut;
  const showTrailing = hasTrailing && !showShortcut && !showKebab;
  return {
    showTrailing,
    showKebab,
    renderSlot: hasArchiveAction || hasTrailing,
  };
}

export function SidebarWorkspaceTrailingActionSlot({
  reserveWidth,
  children,
}: {
  /**
   * Whether the action is on screen right now - pass the painted state, not whether the row
   * *has* an action. The title gets the width back whenever the action is away.
   */
  reserveWidth: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={
        reserveWidth
          ? sidebarWorkspaceRowStyles.trailingActionSlotReserved
          : sidebarWorkspaceRowStyles.trailingActionSlot
      }
    >
      {children}
    </View>
  );
}

export function SidebarWorkspaceTrailingActionBase({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  if (!children) return null;
  return <View style={visible ? undefined : sidebarWorkspaceRowStyles.hidden}>{children}</View>;
}

export function SidebarWorkspaceTrailingActionOverlay({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  if (!visible || !children) return null;
  return <View style={sidebarWorkspaceRowStyles.trailingActionOverlay}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  workspaceRowContent: {
    position: "relative",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceContentColumn: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  shortcutBadgeOverlay: {
    position: "absolute",
    top: 1,
    right: 0,
  },
  workspaceStatusDot: {
    position: "relative",
    width: theme.iconSize.md,
    // Tall enough for the doubled running ring on compact; the desktop value is
    // the title's line box, which is what centres the dot on the workspace name.
    height: { xs: 28, md: 20 },
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // Doubled on compact with everything else in the leading column. A 6pt dot is
  // a legible mark beside a pointer and barely a mark at all on a phone.
  statusDot: {
    width: compactUp(STATUS_INDICATOR_FILLED_DOT_SIZE),
    height: compactUp(STATUS_INDICATOR_FILLED_DOT_SIZE),
    borderRadius: theme.borderRadius.full,
  },
  statusDotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  statusDotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
  },
  statusDotNeedsInput: {
    backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
    transform: [{ translateX: 0.5 }],
  },
  statusDotRunning: {
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
  },
  statusDotDone: {
    backgroundColor: theme.colors.foregroundExtraMuted,
    opacity: 0.3,
  },
  // The title owns the first line outright now that the host, change request and CI moved
  // to the meta row, so it takes the full width the trailing slot leaves behind.
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  // The active workspace names itself in the accent, matching the selected
  // explorer tab. The leading status visual keeps its own semantic color.
  workspaceBranchTextSelected: {
    color: theme.colors.accent,
    opacity: 1,
  },
}));
