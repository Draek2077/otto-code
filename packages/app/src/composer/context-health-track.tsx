import { useCallback, useEffect, useMemo, useReducer, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { TriangleAlert, X } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import {
  formatPercent,
  formatTokens,
  isCriticalSeverity,
  reportSharePercent,
  shouldRaiseContextWarning,
} from "@/context-management/format";
import { openContextManagementTab } from "@/context-management/open-context-management-tab";
import { isContextWarningMuted, useContextManagementStore } from "@/context-management/store";
import { useWorkspaceContextReport } from "@/context-management/use-context-report";

// Icon colors must come through a theme-reactive prop, and `useUnistyles()` is
// banned — wrapping the leaf icons is the sanctioned route (docs/unistyles.md).
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedX = withUnistyles(X);

interface ContextHealthTrackProps {
  serverId: string;
  agentId: string;
}

/**
 * The fixed weight this workspace carries into every request, surfaced as the
 * topmost fly-out above the composer — mounted BEFORE RateLimitWarningTrack so
 * it sits highest in the fanned stack while painting furthest back, behind the
 * usage warning and the message box.
 *
 * This chip is a doorbell, not a fixer. Its one action opens the Context
 * Management tab; naming a single "worst file" here would be ambiguous (a user
 * can have three files called CLAUDE.md) and offering a rewrite from a one-line
 * strip would be alarming. All real work happens in the tab.
 */
export function ContextHealthTrack({
  serverId,
  agentId,
}: ContextHealthTrackProps): ReactElement | null {
  const { t } = useTranslation();
  const { settings } = useAppSettings();

  // Context health belongs to the workspace, not the chat: every tab in a
  // project shares one report and one dismissal.
  const workspaceId = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.workspaceId ?? null,
  );
  const report = useWorkspaceContextReport(serverId, workspaceId);
  const dismissal = useContextManagementStore((state) =>
    workspaceId ? state.dismissals[`${serverId}:${workspaceId}`] : undefined,
  );
  const dismiss = useContextManagementStore((state) => state.dismiss);

  const handleDismiss = useCallback(() => {
    if (!workspaceId || !report) return;
    dismiss(serverId, workspaceId, report);
  }, [dismiss, report, serverId, workspaceId]);

  const handleManage = useCallback(() => {
    if (!workspaceId) return;
    openContextManagementTab({ serverId, workspaceId });
  }, [serverId, workspaceId]);

  // Nothing else re-renders us when the mute lapses, so schedule a tick.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const mutedUntil = dismissal?.mutedUntil;
  useEffect(() => {
    if (mutedUntil == null) return;
    const remaining = mutedUntil - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(tick, remaining);
    return () => clearTimeout(timer);
  }, [mutedUntil]);

  const message = useMemo(() => {
    if (!settings.contextWarningsEnabled) return null;
    if (!shouldRaiseContextWarning(report)) return null;
    return t("composer.contextHealth.summary", {
      tokens: formatTokens(report.fixedTotal),
      percent: formatPercent(reportSharePercent(report)),
      room: formatTokens(report.workingRoom),
    });
  }, [settings.contextWarningsEnabled, report, t]);

  // Recomputed each render (not memoized) so the scheduled tick re-evaluates
  // the Date.now() comparison and the warning pops back.
  const muted = isContextWarningMuted(dismissal, report);

  if (!message || !report || muted) return null;

  const critical = isCriticalSeverity(report.aggregateSeverity);
  const surfaceStyle = critical ? styles.surfaceCritical : styles.surface;
  const textStyle = critical ? styles.messageCritical : styles.message;
  const dismissLabel = t("composer.contextHealth.dismiss");
  const manageLabel = t("composer.contextHealth.manage");

  return (
    <View style={styles.outer} testID="composer-context-health-track">
      <ChatWidthBounds style={styles.track}>
        <View style={surfaceStyle}>
          <ThemedTriangleAlert size={14} style={critical ? styles.iconCritical : styles.icon} />
          <Text style={textStyle} numberOfLines={2} testID="composer-context-health-warning">
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={manageLabel}
            testID="composer-context-health-manage"
            onPress={handleManage}
            style={critical ? styles.manageButtonCritical : styles.manageButton}
            hitSlop={6}
          >
            <Text style={textStyle}>{manageLabel}</Text>
          </Pressable>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dismissLabel}
                testID="composer-context-health-dismiss"
                onPress={handleDismiss}
                style={styles.dismissButton}
                hitSlop={8}
              >
                <ThemedX size={14} style={critical ? styles.iconCritical : styles.icon} />
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>{dismissLabel}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      </ChatWidthBounds>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  // Amber over a faint amber wash, matching the Auto mode chip and the
  // rate-limit track. Critical escalates the same shape to red — reserved for
  // "this cannot fit", not merely "this is expensive".
  const surfaceBase = {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    // The card tucks -spacing[4] into the composer; pad the bottom so the text
    // clears the overlap.
    paddingBottom: theme.spacing[6],
  } as const;
  const messageBase = {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
  } as const;
  const manageBase = {
    flexShrink: 0,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  } as const;
  return {
    outer: {
      width: "100%",
      alignItems: "center",
      paddingHorizontal: theme.spacing[4],
    },
    track: {
      width: "100%",
      marginBottom: -theme.spacing[4],
    },
    surface: {
      ...surfaceBase,
      backgroundColor: theme.colors.statusWarningSurface,
      borderColor: theme.colors.statusWarning,
    },
    surfaceCritical: {
      ...surfaceBase,
      backgroundColor: theme.colors.statusDangerSurface,
      borderColor: theme.colors.statusDanger,
    },
    // Theme tokens rather than hardcoded hex, so the icon cannot drift from the
    // text between light and dark.
    icon: {
      flexShrink: 0,
      color: theme.colors.statusWarning,
    },
    iconCritical: {
      flexShrink: 0,
      color: theme.colors.statusDanger,
    },
    message: {
      ...messageBase,
      color: theme.colors.statusWarning,
    },
    messageCritical: {
      ...messageBase,
      color: theme.colors.statusDanger,
    },
    manageButton: {
      ...manageBase,
      borderColor: theme.colors.statusWarning,
    },
    manageButtonCritical: {
      ...manageBase,
      borderColor: theme.colors.statusDanger,
    },
    dismissButton: {
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    tooltipText: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.xs,
    },
  };
});
