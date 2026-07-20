// The two heads-ups shown when a host's "Browser tools" master is off.
//
// Browser tools are a deliberate opt-in (they drive real Otto tabs carrying the
// user's logged-in sessions — see docs/preview.md), so off is a normal state,
// not a misconfiguration. What is NOT acceptable is letting a user reach for a
// feature and get silence. These two gates differ on purpose:
//
// - **Preview is hard-gated.** Without browser tools the agent has no
//   preview_*/browser_* tools at all, so the point of preview — the agent
//   starting the server and checking the result — cannot happen. The dialog is
//   a fork in the road (go to settings, or don't preview) and is deliberately
//   NOT suppressible: suppressing it would leave a button that silently does
//   nothing useful.
// - **Opening a browser tab is soft-gated.** The tab itself works fine for the
//   human; only agent access is missing. So that one is informational, proceeds
//   either way, and carries a "Don't show this again" checkbox.
//
// Both live here rather than at each call site so the copy and the suppression
// rule stay in one place — "New browser" has several entry points.
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import { confirmDialog, confirmDialogWithCheckbox } from "@/utils/confirm-dialog";
import { persistAppSettings } from "@/hooks/use-settings";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";

export interface BrowserToolsWarningCopy {
  previewTitle: string;
  previewMessage: string;
  browserTitle: string;
  browserMessage: string;
  suppressLabel: string;
  openSettings: string;
  cancel: string;
  notNow: string;
}

/** One copy source for both gates, so the two dialogs can't drift apart. */
export function useBrowserToolsWarningCopy(): BrowserToolsWarningCopy {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      previewTitle: t("workspace.browser.browserToolsOff.previewTitle"),
      previewMessage: t("workspace.browser.browserToolsOff.previewMessage"),
      browserTitle: t("workspace.browser.browserToolsOff.browserTitle"),
      browserMessage: t("workspace.browser.browserToolsOff.browserMessage"),
      suppressLabel: t("workspace.browser.browserToolsOff.suppress"),
      openSettings: t("workspace.browser.browserToolsOff.openSettings"),
      cancel: t("common.actions.cancel"),
      notNow: t("workspace.browser.browserToolsOff.notNow"),
    }),
    [t],
  );
}

/** Deep-links to the host's Tools section, where the master switch lives. */
export function useOpenBrowserToolsSettings(serverId: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "tools") as Href);
  }, [router, serverId]);
}

/**
 * The single read of the master. An absent value is off — browser tools are an
 * opt-in, so anything short of an explicit `true` must not read as enabled.
 */
export function isBrowserToolsEnabled(config: MutableDaemonConfig | null | undefined): boolean {
  return config?.browserTools.enabled === true;
}

export interface PreviewGateInput {
  config: MutableDaemonConfig | null | undefined;
  copy: BrowserToolsWarningCopy;
  /** Navigates to Host settings → Tools. Only called when the user opts in. */
  onOpenSettings: () => void;
}

/**
 * Gate the user-driven preview flow. Returns true when the caller should run
 * the flow, false when it must stop (either the user chose to go turn browser
 * tools on, or they backed out).
 */
export async function confirmPreviewNeedsBrowserTools(input: PreviewGateInput): Promise<boolean> {
  if (isBrowserToolsEnabled(input.config)) {
    return true;
  }
  const confirmed = await confirmDialog({
    title: input.copy.previewTitle,
    message: input.copy.previewMessage,
    confirmLabel: input.copy.openSettings,
    cancelLabel: input.copy.cancel,
  });
  if (confirmed) {
    input.onOpenSettings();
  }
  return false;
}

export interface BrowserGateInput {
  config: MutableDaemonConfig | null | undefined;
  copy: BrowserToolsWarningCopy;
  /** Device-local suppression from app settings. */
  suppressed: boolean;
  onOpenSettings: () => void;
}

/**
 * Heads-up before opening a browser tab that agents won't be able to use. Same
 * shape as the preview gate — "Open settings" navigates and stops here, "Not
 * now" proceeds — because the tab is still useful to the human on its own.
 * Ticking the checkbox persists the suppression before returning, so the answer
 * sticks whichever branch the user takes.
 */
export async function confirmBrowserToolsOffBeforeOpening(
  input: BrowserGateInput,
): Promise<boolean> {
  if (input.suppressed || isBrowserToolsEnabled(input.config)) {
    return true;
  }
  const { confirmed, checkboxChecked } = await confirmDialogWithCheckbox({
    title: input.copy.browserTitle,
    message: input.copy.browserMessage,
    checkboxLabel: input.copy.suppressLabel,
    confirmLabel: input.copy.openSettings,
    cancelLabel: input.copy.notNow,
  });
  if (checkboxChecked) {
    await persistAppSettings({ suppressBrowserToolsWarning: true });
  }
  if (confirmed) {
    input.onOpenSettings();
    return false;
  }
  return true;
}
