import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Globe, SquareTerminal } from "@/components/icons/material-icons";
import { StatusBucketIcon, isAttentionStatusBucket } from "@/components/status-bucket-icon";
import { GitHostingIcon } from "@/components/icons/git-hosting-icon";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import { ThemedBlobLoader } from "@/components/blob-loader";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { usePrefetchWorkspaceCheckoutStatus } from "@/hooks/use-prefetch-workspace-checkout-status";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import type { PrHint } from "@/git/use-pr-status-query";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { PrBadge } from "@/components/sidebar/pr-badge";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const blueColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[500] });
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });

const ThemedGitHostingIcon = withUnistyles(GitHostingIcon);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedGlobe = withUnistyles(Globe);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);

type SidebarWorkspaceScriptIconKind = "service" | "command";

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
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  subtitle?: string | null;
  scriptIconKind?: SidebarWorkspaceScriptIconKind | null;
  isHovered: boolean;
  isLoading: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
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
        <WorkspaceStatusIndicator bucket={workspace.statusBucket} loading={isLoading} />
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <View style={styles.workspaceTitleLeft}>
              <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                {workspaceLabel}
              </Text>
              {scriptIconKind ? <WorkspaceScriptIcon kind={scriptIconKind} /> : null}
            </View>
            <View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View>
          </View>
          {subtitle ? (
            <Text style={styles.workspaceSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {workspace.prHint ? (
            <View style={styles.workspacePrBadgeRow}>
              <PrBadge hint={workspace.prHint} />
              <ChecksBadge checks={workspace.prHint.checks} provider={workspace.prHint.provider} />
            </View>
          ) : null}
        </View>
      </View>
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
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  loading?: boolean;
}) {
  const shouldShowSyncedLoader = shouldRenderSyncedStatusLoader({ bucket });

  if (loading) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-loading">
        <ThemedActivityIndicator size={8} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  if (shouldShowSyncedLoader) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
        <ThemedBlobLoader size={11} />
      </View>
    );
  }

  // Every actionable state renders the shared attention badge (see
  // status-bucket-icon.tsx): a filled circle with a symbol knocked out,
  // color-coded by meaning — the same glyph the workspace tabs show. Running
  // keeps its loader (above) and done/idle reserves the slot but draws
  // nothing (below).
  if (isAttentionStatusBucket(bucket)) {
    return (
      <View style={styles.workspaceStatusDot} testID={`workspace-status-indicator-${bucket}`}>
        <StatusBucketIcon bucket={bucket} size={14} />
      </View>
    );
  }

  return <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-done" />;
}

function ChecksBadge({
  checks,
  provider,
}: {
  checks: PrHint["checks"];
  provider: PrHint["provider"];
}) {
  if (!checks || checks.length === 0) return null;
  const failed = checks.filter((check) => check.status === "failure").length;
  if (failed === 0) return null;
  return (
    <View style={checksBadgeStyles.badge}>
      <ThemedGitHostingIcon provider={provider} size={10} uniProps={redColorMapping} />
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
  trailingActionSlot: {
    position: "relative",
    minWidth: 18,
    minHeight: 20,
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
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
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
    alignItems: "flex-start",
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
    top: 1,
    right: 0,
  },
  workspaceStatusDot: {
    position: "relative",
    width: theme.iconSize.md,
    height: 20,
    borderRadius: theme.borderRadius.full,
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
