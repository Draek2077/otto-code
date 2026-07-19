import { useCallback, useEffect, useMemo, useReducer, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { StyleSheet } from "react-native-unistyles";
import type { TFunction } from "i18next";
import type { AgentRateLimitInfo } from "@otto-code/protocol/messages";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { TriangleAlert, X } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings } from "@/hooks/use-settings";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { rateLimitDismissKey, useSessionStore } from "@/stores/session-store";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { hexColorWithAlpha } from "./agent-controls/utils";

interface RateLimitWarningTrackProps {
  serverId: string;
  agentId: string;
}

// Provider-reported plan rate-limit status, surfaced as a fly-out that emerges
// from the top of the composer — the same drawer idiom as the subagents track,
// but tinted amber like the Auto mode chip. It mounts FIRST among the composer's
// fly-outs, so it sits at the very top of the fanned stack (highest) while its
// natural back-most paint order tucks it BEHIND every flyout below it and the
// message box (borderBottomWidth:0 + negative marginBottom hide its bottom edge).
// Hidden entirely when allowed or via rateLimitWarningsEnabled.
export function RateLimitWarningTrack({
  serverId,
  agentId,
}: RateLimitWarningTrackProps): ReactElement | null {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const rateLimitInfo = useSessionStore((state) =>
    state.sessions[serverId]?.agentRateLimits.get(agentId),
  );
  // The agent's provider + cwd resolve the friendly provider name shown in the
  // warning — no hardcoded "Claude". A custom endpoint agent shows its configured
  // name (e.g. "LM Studio"); the snapshot label is the same source the model/mode
  // controls use. Falls back to the provider id only when the snapshot is absent.
  const agentProvider = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[serverId]?.agents?.get(agentId);
      return agent ? { provider: agent.provider, cwd: agent.cwd } : null;
    }),
  );
  const { entries: snapshotEntries } = useProvidersSnapshot(serverId, {
    cwd: agentProvider?.cwd,
  });
  const providerLabel = agentProvider
    ? resolveProviderLabel(agentProvider.provider, snapshotEntries)
    : null;
  // The user X'd out this exact warning (status + window): muted, not gone. It
  // re-surfaces after `mutedUntil`; an escalation or new window (different key)
  // breaks through immediately.
  const dismissal = useSessionStore((state) =>
    state.sessions[serverId]?.dismissedRateLimits.get(agentId),
  );
  const dismissAgentRateLimit = useSessionStore((state) => state.dismissAgentRateLimit);
  const handleDismiss = useCallback(
    () => dismissAgentRateLimit(serverId, agentId),
    [dismissAgentRateLimit, serverId, agentId],
  );

  // Per-turn re-emits are deduped, so nothing would re-render the warning back in
  // when the mute lapses — schedule a tick at `mutedUntil` to do it ourselves.
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
    if (!settings.rateLimitWarningsEnabled || !rateLimitInfo || !providerLabel) return null;
    if (rateLimitInfo.status === "allowed") return null;
    return formatRateLimitWarning(t, rateLimitInfo, providerLabel);
  }, [settings.rateLimitWarningsEnabled, rateLimitInfo, providerLabel, t]);

  // Computed each render (not memoized) so the scheduled tick re-evaluates the
  // Date.now() comparison and the warning pops back when the mute lapses.
  const isMuted =
    dismissal != null &&
    rateLimitInfo != null &&
    dismissal.key === rateLimitDismissKey(rateLimitInfo) &&
    Date.now() < dismissal.mutedUntil;

  if (!message || !rateLimitInfo || isMuted) return null;

  const isRejected = rateLimitInfo.status === "rejected";
  const surfaceStyle = isRejected ? styles.surfaceRejected : styles.surface;
  const textStyle = isRejected ? styles.messageRejected : styles.message;
  const accentColor = isRejected ? REJECTED_COLOR : WARNING_COLOR;
  const dismissLabel = t("composer.rateLimit.dismiss");

  return (
    <View style={styles.outer} testID="composer-rate-limit-track">
      <ChatWidthBounds style={styles.track}>
        <View style={surfaceStyle}>
          <TriangleAlert size={14} color={accentColor} style={styles.icon} />
          <Text style={textStyle} testID="composer-rate-limit-warning">
            {message}
          </Text>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dismissLabel}
                testID="composer-rate-limit-dismiss"
                onPress={handleDismiss}
                style={styles.dismissButton}
                hitSlop={8}
              >
                {/* X tints to the warning/rejected foreground, matching the text. */}
                <X size={14} color={accentColor} />
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

// One compact line, segments joined with " · ": headline (provider + window),
// then percent used, reset time, and overage note when reported. `provider` is
// the resolved provider display name — never a hardcoded product name.
function formatRateLimitWarning(t: TFunction, info: AgentRateLimitInfo, provider: string): string {
  let windowLabel = t("composer.rateLimit.windowPlan");
  if (info.limitType === "five_hour") {
    windowLabel = t("composer.rateLimit.windowFiveHour");
  } else if (info.limitType?.startsWith("seven_day")) {
    windowLabel = t("composer.rateLimit.windowSevenDay");
  }
  const parts = [
    info.status === "rejected"
      ? t("composer.rateLimit.reached", { provider, window: windowLabel })
      : t("composer.rateLimit.approaching", { provider, window: windowLabel }),
  ];
  if (typeof info.utilizationPercent === "number") {
    parts.push(t("composer.rateLimit.usedPercent", { percent: info.utilizationPercent }));
  }
  if (info.resetsAt) {
    const resetDate = new Date(info.resetsAt);
    if (!Number.isNaN(resetDate.getTime())) {
      const withinDay = resetDate.getTime() - Date.now() < 24 * 60 * 60 * 1000;
      if (withinDay) {
        // Same-day reset: the time alone is unambiguous, so keep it terse.
        parts.push(
          t("composer.rateLimit.resets", {
            time: resetDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
          }),
        );
      } else {
        // Multi-day windows (e.g. weekly) name the weekday so the date isn't
        // ambiguous: "resets on Saturday, Jul 25, 7:00 AM".
        parts.push(
          t("composer.rateLimit.resetsOn", {
            time: resetDate.toLocaleString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }),
          }),
        );
      }
    }
  }
  if (info.isUsingOverage) {
    parts.push(t("composer.rateLimit.usingOverage"));
  }
  return parts.join(" · ");
}

const WARNING_COLOR = "#f59e0b";
const REJECTED_COLOR = "#ef4444";

const styles = StyleSheet.create((theme) => {
  // Amber chip look, mirroring the Auto mode combo: amber border + text over a
  // faint amber wash. Rejected escalates the same shape to red.
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
    // clears the overlap (matches the subagents track's collapsed header).
    paddingBottom: theme.spacing[6],
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
      backgroundColor: hexColorWithAlpha(theme.colors.statusWarning, 0.12) ?? theme.colors.surface1,
      borderColor: theme.colors.statusWarning,
    },
    surfaceRejected: {
      ...surfaceBase,
      backgroundColor: hexColorWithAlpha(theme.colors.statusDanger, 0.12) ?? theme.colors.surface1,
      borderColor: theme.colors.statusDanger,
    },
    icon: {
      flexShrink: 0,
    },
    message: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.statusWarning,
      fontSize: theme.fontSize.sm,
    },
    messageRejected: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.statusDanger,
      fontSize: theme.fontSize.sm,
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
