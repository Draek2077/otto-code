import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { forgeToHostingProvider } from "@/git/forge";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Globe, SquareTerminal } from "@/components/icons/material-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBucketIcon, isAttentionStatusBucket } from "@/components/status-bucket-icon";
import { GitHostingIcon } from "@/components/icons/git-hosting-icon";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import { ThemedBlobLoader } from "@/components/blob-loader";
import { ShortcutDiscoveryBadge } from "@/components/shortcut-discovery-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative as platformIsNative } from "@/constants/platform";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { usePrefetchWorkspaceCheckoutStatus } from "@/hooks/use-prefetch-workspace-checkout-status";
import { useAppSettings } from "@/hooks/use-settings";
import { compactUp, type Theme, useIconSize } from "@/styles/theme";
import type { PrHint } from "@/git/use-pr-status-query";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { PrBadge } from "@/components/sidebar/pr-badge";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";

const blueColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[500] });
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });

const ThemedGitHostingIcon = withUnistyles(GitHostingIcon);
const ThemedGlobe = withUnistyles(Globe);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);

type SidebarWorkspaceScriptIconKind = "service" | "command";

/**
 * Whether a row's hover-revealed controls may float over its right edge instead
 * of reserving width in the title line.
 *
 * Only where hover exists. On native and in compact layouts `onHoverIn` never
 * fires, so those controls are permanently on screen (see the `isHovered ||
 * isNative || isCompact` rule in packages/app/CLAUDE.md) - floating them there
 * would park them on top of the label forever. Reserved layout is correct on
 * those platforms and stays.
 */
export function useFloatingRowActions(): boolean {
  const isCompact = useIsCompactFormFactor();
  return !platformIsNative && !isCompact;
}

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const prefetchCheckoutStatus = usePrefetchWorkspaceCheckoutStatus();
  const { serverId, workspaceDirectory } = workspace;
  const handlePointerEnter = useCallback(() => {
    setIsHovered(true);
    // Hover signals intent to switch: warm the checkout-status query so the
    // workspace header renders without its skeleton on first visit.
    prefetchCheckoutStatus({ serverId, workspaceDirectory });
  }, [prefetchCheckoutStatus, serverId, workspaceDirectory]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard workspace={workspace} prHint={workspace.prHint} isDragging={isDragging}>
      {children({ isHovered, hoverHandlers })}
    </WorkspaceHoverCard>
  );
}

export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  subtitle,
  scriptIconKind = null,
  isHovered,
  isLoading,
  isIndexing = false,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  floatingTrailing = null,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  subtitle?: string | null;
  scriptIconKind?: SidebarWorkspaceScriptIconKind | null;
  isHovered: boolean;
  isLoading: boolean;
  /** A language server for this workspace is starting up or indexing. */
  isIndexing?: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  /**
   * Trailing controls painted over the title row's right edge. Costs the label
   * no width, so pass hover-revealed controls here rather than as `children`.
   */
  floatingTrailing?: ReactNode;
  /** Trailing content that reserves width in the title row. */
  children?: ReactNode;
}) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      scriptIconKind ? styles.workspaceBranchTextWithAccessory : styles.workspaceBranchTextFlexible,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [scriptIconKind, isHovered, isCreating],
  );

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        <View style={styles.workspaceLeadingVisualSlot}>
          <WorkspaceStatusIndicator
            bucket={workspace.statusBucket}
            loading={isLoading}
            indexing={isIndexing}
          />
        </View>
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <View style={styles.workspaceTitleLeft}>
              <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                {workspaceLabel}
              </Text>
              {scriptIconKind ? <WorkspaceScriptIcon kind={scriptIconKind} /> : null}
            </View>
          </View>
          {subtitle ? (
            <Text style={styles.workspaceSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {workspace.prHint ? (
            <View style={styles.workspacePrBadgeRow}>
              <PrBadge hint={workspace.prHint} />
              <ChecksBadge checks={workspace.prHint.checks} forge={workspace.prHint.forge} />
            </View>
          ) : null}
        </View>
        {children ? <View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View> : null}
      </View>
      {floatingTrailing ? (
        <View style={sidebarWorkspaceRowStyles.floatingTrailingOverlay}>{floatingTrailing}</View>
      ) : null}
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

function WorkspaceScriptIcon({ kind }: { kind: SidebarWorkspaceScriptIconKind }) {
  return (
    <View
      style={styles.workspaceTitleAccessory}
      accessibilityLabel="Scripts available"
      testID={kind === "service" ? "workspace-globe-icon" : "workspace-terminal-icon"}
    >
      {kind === "service" ? (
        <ThemedGlobe size={12} uniProps={blueColorMapping} />
      ) : (
        <ThemedSquareTerminal size={12} uniProps={blueColorMapping} />
      )}
    </View>
  );
}

function WorkspaceStatusIndicator({
  bucket,
  loading = false,
  indexing = false,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  loading?: boolean;
  /**
   * Language-server startup/indexing. Deliberately the *lowest* priority branch below:
   * it fills a slot that would otherwise draw nothing, and never masks an attention
   * badge - a workspace that needs review must keep saying so while a server warms up.
   */
  indexing?: boolean;
}) {
  const iconSize = useIconSize();
  const spinnerSize = iconSize.sm;
  const shouldShowSyncedLoader = shouldRenderSyncedStatusLoader({ bucket });

  if (loading) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-loading">
        <LoadingSpinner size={spinnerSize} />
      </View>
    );
  }

  if (shouldShowSyncedLoader) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
        <ThemedBlobLoader size={spinnerSize} />
      </View>
    );
  }

  // Every actionable state renders the shared attention badge (see
  // status-bucket-icon.tsx): a filled circle with a symbol knocked out,
  // color-coded by meaning - the same glyph the workspace tabs show. Running
  // keeps its loader (above) and done/idle reserves the slot but draws
  // nothing (below).
  if (isAttentionStatusBucket(bucket)) {
    return (
      <View style={styles.workspaceStatusDot} testID={`workspace-status-indicator-${bucket}`}>
        <StatusBucketIcon bucket={bucket} size={iconSize.sm} />
      </View>
    );
  }

  if (indexing) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-indexing">
        <LoadingSpinner size={spinnerSize} />
      </View>
    );
  }

  return <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-done" />;
}

function ChecksBadge({ checks, forge }: { checks: PrHint["checks"]; forge: PrHint["forge"] }) {
  if (!checks || checks.length === 0) return null;
  const failed = checks.filter((check) => check.status === "failure").length;
  if (failed === 0) return null;
  return (
    <View style={checksBadgeStyles.badge}>
      <ThemedGitHostingIcon
        provider={forgeToHostingProvider(forge)}
        size={10}
        uniProps={redColorMapping}
      />
      <Text style={checksBadgeStyles.text}>{failed} failed</Text>
    </View>
  );
}

const checksBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.palette.red[500],
  },
}));

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  hidden: { opacity: 0 },
  /**
   * Hover-revealed controls painted over the workspace row's right edge. They
   * span the full content stack so their center follows the row as a subtitle,
   * PR badge, or host metadata appears. Reserves no width, so the label is
   * full-width at rest and the row never reflows when the pointer arrives.
   *
   * Opaque because it covers real content - the tail of a truncated label, and
   * the diff stat in the status grouping. `surfaceSidebarHover` is the row's own
   * hovered/selected background, and this only renders while hovered, so it
   * reads as part of the row. The one mismatch is the pressed state
   * (`surface2`), a flash on the way to navigating away.
   */
  floatingTrailingOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: theme.spacing[2],
    backgroundColor: theme.colors.surfaceSidebarHover,
    borderRadius: theme.borderRadius.md,
  },
  trailingActionSlot: {
    position: "relative",
    // This is the same responsive square as the project kebab trigger. It
    // reserves the full touch target, not just the three-dot glyph.
    minWidth: compactUp(24),
    minHeight: compactUp(24),
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  trailingActionOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    justifyContent: "center",
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return <ShortcutDiscoveryBadge label={String(number)} />;
}

export function SidebarWorkspaceTrailingActionSlot({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const slotStyle = useMemo(() => [sidebarWorkspaceRowStyles.trailingActionSlot, style], [style]);
  return <View style={slotStyle}>{children}</View>;
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
    // Status and actions are affordances for the workspace as a whole. Center
    // them against the complete content stack as subtitles, PR badges, and
    // host metadata appear or disappear.
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
  workspaceTitleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  shortcutBadgeOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    justifyContent: "center",
  },
  workspaceStatusDot: {
    position: "relative",
    // The compact 28px status glyph needs a 32px square. Unlike the trailing
    // kebab, this is a visual indicator rather than a touch target.
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // Match the project row's leading column. The status visual remains a 32px
  // indicator inside it, while its label starts on the same x-coordinate as a
  // project label beside a 40px project icon.
  workspaceLeadingVisualSlot: {
    width: theme.iconSize.lg,
    height: theme.iconSize.md,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  workspaceBranchText: {
    color: theme.colors.foreground,
    // Explicit compact bump (not left to the ambient theme-patch scale).
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    minWidth: 0,
  },
  workspaceBranchTextFlexible: {
    flex: 1,
  },
  workspaceBranchTextWithAccessory: {
    flexShrink: 1,
  },
  workspaceTitleAccessory: {
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  workspaceSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 14,
  },
  workspacePrBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
}));
