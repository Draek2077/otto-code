import { ActivityIndicator, View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "@/components/icons/material-icons";
import { ProjectIconView } from "@/components/project-icon-view";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import {
  getProjectStatusBadgeContent,
  type ProjectStatusBadgeContent,
  type ProjectStatusBadgeDotBucket,
} from "@/utils/project-status-badge-content";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";
import { StatusRing } from "@/components/status-ring";
import { getStatusRingOffset } from "@/components/status-ring/geometry";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";

// Every surfaced status shares one badge shell, so the badge never changes size or position
// between states. Only the thing inside it changes.
const STATUS_BADGE_SIZE = 12;
// How far the badge overhangs the icon's bottom-right corner. Well short of half the badge:
// centered on the corner it reads as hanging off the icon rather than sitting on it, and the
// sidebar row has no padding there to absorb the overhang.
const STATUS_BADGE_OFFSET = -4;
// Both glyphs must be EVEN. A centered glyph of size N sits at a (12 - N) / 2 offset — fractional
// for odd N, which the browser snaps to a device-pixel boundary and renders visibly off-center (an
// odd size measured 1.5 device px right and down at 3x, ~3px of asymmetry between opposite gaps).
// Even sizes divide the shell into whole pixels and land dead center with no correction.
//
// Matches the workspace title's lineHeight (sidebar-workspace-row-content's
// workspaceBranchText) so the icon centers on the title rather than floating above it.
// Compact form factors double it in step with the doubled icon it holds - a 20pt slot
// around a 32pt icon leaves the icon overhanging its own slot and riding above the title.
const LEADING_SLOT_HEIGHT = 20;

// The corner ring is re-centred on the shell it replaces, at each scale: doubling the
// offset would move the ring off the icon's corner, because the correction is the gap
// between two sizes rather than a size of its own.
const STATUS_RING_ANCHOR_OFFSET = {
  xs: getStatusRingOffset(STATUS_BADGE_OFFSET * 2, STATUS_BADGE_SIZE * 2, true),
  md: getStatusRingOffset(STATUS_BADGE_OFFSET, STATUS_BADGE_SIZE),
} as const;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * Leading slot of a sidebar project row: chevron on hover, archive spinner while removing,
 * otherwise the project icon carrying the project's aggregate workspace status.
 */
export function ProjectLeadingVisual({
  displayName,
  iconDataUri,
  statusBucket,
  projectViewKey,
  backdrop,
  chevron = null,
  showChevron = false,
  isArchiving = false,
}: {
  displayName: string;
  iconDataUri: string | null;
  /** Aggregate status of the project's workspaces; null when it shouldn't be surfaced. */
  statusBucket: SidebarStateBucket | null;
  projectViewKey: string;
  /** The row's current background, so the status badge can knock out of it. */
  backdrop: SidebarSurfaceBackdrop;
  chevron?: "expand" | "collapse" | null;
  showChevron?: boolean;
  isArchiving?: boolean;
}) {
  if (showChevron && chevron !== null) {
    return (
      <View style={styles.projectLeadingVisualSlot}>
        <ProjectInlineChevron chevron={chevron} />
      </View>
    );
  }

  if (isArchiving) {
    return (
      <View style={styles.projectLeadingVisualSlot} testID="project-status-indicator-archiving">
        <ProjectArchivingSpinner />
      </View>
    );
  }

  return (
    <ProjectStatusIndicator
      iconDataUri={iconDataUri}
      displayName={displayName}
      projectViewKey={projectViewKey}
      statusBucket={statusBucket}
      backdrop={backdrop}
    />
  );
}

// The project icon (the lettered box) is what marks a row as a *project* rather than a
// workspace, so it always stays and status annotates it instead of replacing it. Every
// surfaced bucket lands in the identical corner badge — a colored disc for actionable states,
// nothing for done — so the badge reads as one fixed shell and only its contents change.
export function ProjectStatusIndicator({
  iconDataUri,
  displayName,
  projectViewKey,
  statusBucket,
  backdrop,
  hasActiveChat = false,
  testID,
}: {
  iconDataUri: string | null;
  displayName: string;
  projectViewKey: string;
  statusBucket: SidebarStateBucket | null;
  /** The row's current background, so the status badge can knock out of it. */
  backdrop: SidebarSurfaceBackdrop;
  hasActiveChat?: boolean;
  testID?: string;
}) {
  const placeholderInitial = projectIconPlaceholderLabelFromDisplayName(displayName)
    .charAt(0)
    .toUpperCase();
  // Status and activity are independent: a workspace can need input while another chat runs.
  const badgeBucket = statusBucket === "done" && hasActiveChat ? "running" : statusBucket;
  const badgeContent = getProjectStatusBadgeContent(badgeBucket);

  return (
    <View
      style={styles.projectLeadingVisualSlot}
      testID={
        testID ??
        (statusBucket && statusBucket !== "done"
          ? `project-status-indicator-${statusBucket}`
          : "project-icon-only")
      }
    >
      <View style={styles.projectIconBox}>
        <ProjectIcon
          iconDataUri={iconDataUri}
          placeholderInitial={placeholderInitial}
          projectViewKey={projectViewKey}
        />
        {badgeContent === null || badgeBucket === null ? null : (
          <ProjectStatusBadge
            content={badgeContent}
            statusBucket={badgeBucket}
            backdrop={backdrop}
            spinning={hasActiveChat}
          />
        )}
      </View>
    </View>
  );
}

function ProjectStatusBadge({
  content,
  statusBucket,
  backdrop,
  spinning,
}: {
  content: ProjectStatusBadgeContent;
  statusBucket: SidebarStateBucket;
  backdrop: SidebarSurfaceBackdrop;
  spinning: boolean;
}) {
  // The ring is wider than the 12pt shell and carries its own knockout, so nesting it inside
  // would clip it against the very thing that was meant to separate it from the icon.
  if (spinning) {
    return (
      <View
        role="status"
        accessibilityLabel={STATUS_BUCKET_LABELS[statusBucket]}
        style={styles.statusRingAnchor}
        testID="project-status-badge"
      >
        <StatusRing backdrop={backdrop} centerStyle={getStatusDotColorStyle(content.bucket)} />
      </View>
    );
  }
  return (
    <View
      role="status"
      accessibilityLabel={STATUS_BUCKET_LABELS[statusBucket]}
      style={[styles.statusBadge, getStatusBadgeBackdropStyle(backdrop)]}
      testID="project-status-badge"
    >
      <ProjectStatusDot bucket={content.bucket} />
    </View>
  );
}

function getStatusBadgeBackdropStyle(backdrop: SidebarSurfaceBackdrop): ViewStyle {
  switch (backdrop) {
    case "surfaceSidebar":
      return styles.statusBadgeOnSidebar;
    case "surfaceSidebarHover":
      return styles.statusBadgeOnSidebarHover;
    case "surfaceSidebarSelected":
      return styles.statusBadgeOnSidebarSelected;
    case "surface2":
      return styles.statusBadgeOnSurface2;
  }
}

function ProjectStatusDot({ bucket }: { bucket: ProjectStatusBadgeDotBucket }) {
  return <View testID="project-status-dot" style={getStatusDotColorStyle(bucket)} />;
}

function ProjectArchivingSpinner() {
  const isCompact = useIsCompactFormFactor();
  return (
    <ThemedActivityIndicator size={isCompact ? 16 : 8} uniProps={foregroundMutedColorMapping} />
  );
}

function ProjectIcon({
  iconDataUri,
  placeholderInitial,
  projectViewKey,
}: {
  iconDataUri: string | null;
  placeholderInitial: string;
  projectViewKey: string;
}) {
  // The size prop is a plain number, so it needs the hook rather than the static token -
  // `ICON_SIZE.md` never sees the compact doubling the surrounding slot already gets.
  const iconSize = useIconSize();
  return (
    <ProjectIconView
      iconDataUri={iconDataUri}
      initial={placeholderInitial}
      projectViewKey={projectViewKey}
      size={iconSize.md}
      textStyle={styles.projectIconFallbackText}
    />
  );
}

function ProjectInlineChevron({ chevron }: { chevron: "expand" | "collapse" | null }) {
  const iconSize = useIconSize();
  if (chevron === null) {
    return null;
  }
  if (chevron === "collapse") {
    return <ChevronDown size={iconSize.sm} color="#9ca3af" />;
  }
  return <ChevronRight size={iconSize.sm} color="#9ca3af" />;
}

function getStatusDotColorStyle(bucket: ProjectStatusBadgeDotBucket): ViewStyle {
  if (bucket === "needs_input") return styles.statusDotNeedsInput;
  if (bucket === "failed") return styles.statusDotFailed;
  if (bucket === "running") return styles.statusDotRunning;
  return styles.statusDotAttention;
}

const styles = StyleSheet.create((theme) => {
  // Dot statuses sit *inside* the shell rather than replacing it, so they carry the same ring
  // the alert does. The geometry is shared here and baked into each colored variant so the
  // style prop stays a single stable object; the colors come from the one bucket-to-color map
  // so this badge can't drift from the status dots everywhere else.
  const statusDot = (bucket: ProjectStatusBadgeDotBucket) =>
    ({
      width: compactUp(STATUS_INDICATOR_FILLED_DOT_SIZE),
      height: compactUp(STATUS_INDICATOR_FILLED_DOT_SIZE),
      borderRadius: theme.borderRadius.full,
      backgroundColor: getStatusDotColor({ theme, bucket }) ?? undefined,
    }) as const;

  return {
    // The slot is as tall as the title's line box, not as tall as the icon, and centers the
    // icon inside it. Rows lay their leading visual out with alignItems:flex-start, so a
    // 16pt slot next to a 20pt line box puts the icon 2pt above the title and the kebab —
    // which is why the workspace status indicator is also 20 tall. Keep the two in step.
    projectLeadingVisualSlot: {
      width: theme.iconSize.md,
      height: compactUp(LEADING_SLOT_HEIGHT),
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    // Anchors the corner badge to the icon rather than to the taller slot.
    projectIconBox: {
      position: "relative",
      width: theme.iconSize.md,
      height: theme.iconSize.md,
    },
    projectIconFallbackText: {
      fontSize: theme.fontSize.xs,
    },
    // The shell the alert and dot statuses share. It straddles the icon's bottom-right corner
    // (half in, half out) so the lettered project box stays readable. The shell is a knockout:
    // it is filled with the colour of the row behind it, which is what makes the ring around the
    // dot read as a gap in the icon rather than as a white halo drawn on top of it.
    statusBadge: {
      position: "absolute",
      right: compactUp(STATUS_BADGE_OFFSET),
      bottom: compactUp(STATUS_BADGE_OFFSET),
      width: compactUp(STATUS_BADGE_SIZE),
      height: compactUp(STATUS_BADGE_SIZE),
      borderRadius: theme.borderRadius.full,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    // Same corner as the shell, re-centred for the wider ring. Both the shell and
    // the ring double on compact, so the correction is computed at each scale
    // rather than doubled - it is a difference between two sizes, not a size.
    statusRingAnchor: {
      position: "absolute",
      right: STATUS_RING_ANCHOR_OFFSET,
      bottom: STATUS_RING_ANCHOR_OFFSET,
    },
    statusBadgeOnSidebar: { backgroundColor: theme.colors.surfaceSidebar },
    statusBadgeOnSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
    statusBadgeOnSidebarSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
    statusBadgeOnSurface2: { backgroundColor: theme.colors.surface2 },
    statusDotRunning: statusDot("running"),
    statusDotNeedsInput: {
      ...statusDot("needs_input"),
      transform: [{ translateX: 0.5 }],
    },
    statusDotFailed: statusDot("failed"),
    statusDotAttention: statusDot("attention"),
  };
});
