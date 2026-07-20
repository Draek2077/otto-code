import { isElectronRuntime } from "@/desktop/host";
import { loadAppSettingsFromStorage } from "@/hooks/use-settings";
import { openExternalUrl } from "@/utils/open-external-url";

type InAppLinkOpener = (url: string) => void;

// The single slot the active workspace screen registers its "open a normal
// Otto browser tab" action into. Module-level (not React context) because
// openLink is called from non-React code paths (terminal link handlers,
// composer actions) and from components far outside the workspace tree.
let inAppLinkOpener: InAppLinkOpener | null = null;

/**
 * Registered by the workspace screen — the only surface that can host Otto
 * browser tabs (Electron desktop). Returns an unregister function that only
 * clears the slot if it still holds this opener, so an unmount racing a new
 * mount never wipes the newer registration.
 */
export function registerInAppLinkOpener(opener: InAppLinkOpener): () => void {
  inAppLinkOpener = opener;
  return () => {
    if (inAppLinkOpener === opener) {
      inAppLinkOpener = null;
    }
  };
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The one way the app opens an outbound URL. Routes by the device-local
 * `linkOpenBehavior` setting: "in-app" (the default) opens a normal Otto
 * browser tab in the current workspace (and focuses it), "external" hands off
 * to the system browser via openExternalUrl.
 *
 * Falls back to the system browser regardless of the setting when the in-app
 * pane can't take the link: non-http(s) schemes (mailto:, editor deep links),
 * non-Electron platforms (native mobile / plain web have no browser pane), or
 * no workspace screen mounted to host the tab. There is never a broken option.
 */
export async function openLink(url: string): Promise<void> {
  if (isHttpUrl(url) && isElectronRuntime() && inAppLinkOpener) {
    const settings = await loadAppSettingsFromStorage();
    if (settings.linkOpenBehavior === "in-app") {
      inAppLinkOpener(url);
      return;
    }
  }
  await openExternalUrl(url);
}
