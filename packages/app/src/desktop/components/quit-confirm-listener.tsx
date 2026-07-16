import { useEffect, useRef } from "react";
import { getIsElectron } from "@/constants/platform";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { confirmQuitWithEnabledSchedules } from "@/desktop/components/quit-schedules-warning";
import { useDesktopSettings, type DesktopSettings } from "@/desktop/settings/desktop-settings";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { isSidebarActiveAgent } from "@/utils/sidebar-agent-state";
import { confirmDialog } from "@/utils/confirm-dialog";
import { i18n } from "@/i18n/i18next";

interface QuitConfirmRequestPayload {
  requestId: string;
  willStopDaemon: boolean;
}

async function handleQuitConfirmRequest(
  payload: QuitConfirmRequestPayload,
  settingsRef: { current: DesktopSettings },
  agentsRef: { current: AggregatedAgent[] },
): Promise<void> {
  const settings = settingsRef.current;
  const hasActiveAgents = agentsRef.current.some((agent) => isSidebarActiveAgent(agent));
  // Main also sends the request when the quit will stop the managed daemon
  // (for the schedules warning below), so the generic "warn before quitting"
  // prompt must re-check its own setting here rather than rely on main gating.
  const shouldPrompt =
    settings.quit.warnBeforeQuit &&
    (settings.quit.onlyWarnForActiveAgents ? hasActiveAgents : true);

  console.log("[quit-confirm] request received", {
    requestId: payload.requestId,
    willStopDaemon: payload.willStopDaemon,
    warnBeforeQuit: settings.quit.warnBeforeQuit,
    onlyWarnForActiveAgents: settings.quit.onlyWarnForActiveAgents,
    hasActiveAgents,
    shouldPrompt,
  });

  let confirmed = true;
  if (shouldPrompt) {
    let message: string;
    if (hasActiveAgents) {
      message = i18n.t("desktop.window.quitConfirm.activeAgentsMessage");
    } else if (payload.willStopDaemon) {
      message = i18n.t("desktop.window.quitConfirm.appAndDaemonMessage");
    } else {
      message = i18n.t("desktop.window.quitConfirm.appMessage");
    }

    confirmed = await confirmDialog({
      title: i18n.t("desktop.window.quitConfirm.title"),
      message,
      confirmLabel: i18n.t("desktop.window.quitConfirm.confirm"),
      cancelLabel: i18n.t("desktop.window.quitConfirm.cancel"),
      destructive: hasActiveAgents,
    });
  }

  // Stopping the daemon means enabled schedules stop firing until it runs
  // again — a separate, suppressible warning that applies even when the
  // generic "warn before quitting" setting is off.
  if (confirmed && payload.willStopDaemon) {
    confirmed = await confirmQuitWithEnabledSchedules();
  }

  console.log("[quit-confirm] responding", { requestId: payload.requestId, confirmed });
  await invokeDesktopCommand("respond_quit_confirm", {
    requestId: payload.requestId,
    confirmed,
  });
}

/**
 * Global listener that answers the desktop main process's "should we
 * actually quit?" question, per the user's "warn before quitting" settings.
 * Mounted once alongside {@link ConfirmDialogHost}, mirroring `QuittingOverlay`.
 */
export function QuitConfirmListener() {
  const { settings } = useDesktopSettings();
  const { agents } = useAggregatedAgents();

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  useEffect(() => {
    if (!getIsElectron()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const fn = await listenToDesktopEvent<QuitConfirmRequestPayload>(
        "quit-confirm-request",
        (payload) => {
          void handleQuitConfirmRequest(payload, settingsRef, agentsRef);
        },
      );
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}
