import { useCallback, useEffect, useMemo, useReducer, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { TFunction } from "i18next";
import type { AgentRateLimitInfo } from "@otto-code/protocol/messages";
import { TriangleAlert } from "@/components/icons/material-icons";
import { useAppSettings } from "@/hooks/use-settings";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { rateLimitDismissKey, useSessionStore } from "@/stores/session-store";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { FlyoutBand } from "@/composer/flyout-band";
import type { FlyoutTone } from "@/styles/status-tone";

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

  // Orange while approaching the limit, escalating to red once it is reached.
  const tone: FlyoutTone = rateLimitInfo.status === "rejected" ? "red" : "orange";
  const dismissLabel = t("composer.rateLimit.dismiss");

  return (
    <FlyoutBand
      tone={tone}
      message={message}
      icon={TriangleAlert}
      onDismiss={handleDismiss}
      dismissLabel={dismissLabel}
      testID="composer-rate-limit-track"
      messageTestID="composer-rate-limit-warning"
      dismissTestID="composer-rate-limit-dismiss"
    />
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
