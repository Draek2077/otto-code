import { useEffect, useRef } from "react";
import { getIsElectron } from "@/constants/platform";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import {
  getQuitSchedulesWarningCount,
  suppressQuitSchedulesWarning,
} from "@/desktop/components/quit-schedules-warning";
import { useDesktopSettings, type DesktopSettings } from "@/desktop/settings/desktop-settings";
import { useAgentDirectoryDemand } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { isSidebarActiveAgent } from "@/utils/sidebar-agent-state";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";
import { i18n } from "@/i18n/i18next";

interface QuitConfirmRequestPayload {
  requestId: string;
  willStopDaemon: boolean;
}

// Read at quit time rather than subscribed: this listener is mounted for the app's whole lifetime
// and the agents map changes several times a second while any agent streams.
function hasActiveUnarchivedAgents(): boolean {
  for (const session of Object.values(useSessionStore.getState().sessions)) {
    for (const agent of session.agents.values()) {
      if (agent.archivedAt) continue;
      if (
        isSidebarActiveAgent({
          status: agent.status,
          pendingPermissionCount: agent.pendingPermissions.length,
          requiresAttention: agent.requiresAttention,
          attentionReason: agent.attentionReason,
        })
      ) {
        return true;
      }
    }
  }
  return false;
}

async function handleQuitConfirmRequest(
  payload: QuitConfirmRequestPayload,
  settingsRef: { current: DesktopSettings },
  localDaemonServerIdRef: { current: string | null },
): Promise<void> {
  const settings = settingsRef.current;
  const hasActiveAgents = hasActiveUnarchivedAgents();
  // Main also sends the request when the quit will stop the managed daemon
  // (for the schedules warning below), so the generic "warn before quitting"
  // prompt must re-check its own setting here rather than rely on main gating.
  const shouldPrompt =
    settings.quit.warnBeforeQuit &&
    (settings.quit.onlyWarnForActiveAgents ? hasActiveAgents : true);

  // Stopping the daemon means enabled schedules stop firing until it runs
  // again - a suppressible warning that applies even when the generic "warn
  // before quitting" setting is off. Resolved up front so both warnings can
  // share a single dialog instead of prompting twice in sequence. The lookup
  // is deadline-bounded and works off the pre-cached local daemon serverId,
  // so it cannot noticeably delay the dialog.
  const schedulesWarningCount = payload.willStopDaemon
    ? await getQuitSchedulesWarningCount(localDaemonServerIdRef.current)
    : 0;

  console.log("[quit-confirm] request received", {
    requestId: payload.requestId,
    willStopDaemon: payload.willStopDaemon,
    warnBeforeQuit: settings.quit.warnBeforeQuit,
    onlyWarnForActiveAgents: settings.quit.onlyWarnForActiveAgents,
    hasActiveAgents,
    shouldPrompt,
    schedulesWarningCount,
  });

  let confirmed = true;
  if (shouldPrompt || schedulesWarningCount > 0) {
    let title: string;
    let message: string;
    let confirmLabel: string;
    if (shouldPrompt) {
      title = i18n.t("desktop.window.quitConfirm.title");
      confirmLabel = i18n.t("desktop.window.quitConfirm.confirm");
      if (hasActiveAgents) {
        message = i18n.t("desktop.window.quitConfirm.activeAgentsMessage");
      } else if (payload.willStopDaemon) {
        message = i18n.t("desktop.window.quitConfirm.appAndDaemonMessage");
      } else {
        message = i18n.t("desktop.window.quitConfirm.appMessage");
      }
      if (schedulesWarningCount > 0) {
        message += `\n\n${i18n.t("desktop.window.quitConfirm.schedulesMessage", {
          count: schedulesWarningCount,
        })}`;
      }
    } else {
      title = i18n.t("desktop.window.quitConfirm.schedulesTitle");
      confirmLabel = i18n.t("desktop.window.quitConfirm.schedulesConfirm");
      message = i18n.t("desktop.window.quitConfirm.schedulesMessage", {
        count: schedulesWarningCount,
      });
    }

    const result = await confirmDialogWithCheckbox({
      title,
      message,
      confirmLabel,
      cancelLabel: i18n.t("desktop.window.quitConfirm.cancel"),
      destructive: shouldPrompt && hasActiveAgents,
      checkboxLabel:
        schedulesWarningCount > 0
          ? i18n.t("desktop.window.quitConfirm.schedulesSuppress")
          : undefined,
    });
    confirmed = result.confirmed;
    if (confirmed && schedulesWarningCount > 0 && result.checkboxChecked) {
      suppressQuitSchedulesWarning();
    }
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
  // Keeps the agent directories synced so the quit-time read above sees current agents.
  useAgentDirectoryDemand(true);
  // Subscribing here keeps the local daemon serverId query mounted (and its
  // result cached) for the app's whole lifetime, so the quit flow never has
  // to resolve it on demand - that path shells out to the CLI and would hold
  // the quit dialog back by seconds.
  const localDaemonServerId = useLocalDaemonServerId();

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const localDaemonServerIdRef = useRef(localDaemonServerId);
  localDaemonServerIdRef.current = localDaemonServerId;

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
          void handleQuitConfirmRequest(payload, settingsRef, localDaemonServerIdRef);
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
