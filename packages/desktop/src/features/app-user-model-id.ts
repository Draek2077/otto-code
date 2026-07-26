import path from "node:path";

// Windows identifies notification senders and routes toast clicks by
// AppUserModelID. The packaged app must use electron-builder's `appId`, because
// the NSIS installer stamps that same AUMID onto the Start Menu shortcut it
// creates, and Windows resolves the sender through that shortcut.
export const RELEASE_APP_USER_MODEL_ID = "ai.ottocode.desktop";

// A dev build gets its own identity so its toasts are attributable — otherwise
// dev and the installed app, which are expected to run side by side (see
// docs/development.md → "Four lanes"), post notifications Windows cannot tell
// apart, and a toast click can activate the wrong window.
export const DEV_APP_USER_MODEL_ID = "ai.ottocode.desktop.dev";

export const DEV_SHORTCUT_FILE_NAME = "Otto (Dev).lnk";

// A distinct AUMID is only usable if Windows can resolve it, which means a Start
// Menu shortcut carrying it must exist. The installed app gets one from NSIS; a
// dev build runs straight out of the checkout and has none, which is why dev has
// historically borrowed the release AUMID. So we write one — see
// ensureDevAppUserModelId.
export function resolveDevShortcutPath(appDataDir: string): string {
  return path.join(
    appDataDir,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    DEV_SHORTCUT_FILE_NAME,
  );
}

export interface DevShortcutDetails {
  target: string;
  args: string;
  appUserModelId: string;
  description: string;
  icon?: string;
  iconIndex?: number;
}

export function buildDevShortcutDetails(input: {
  execPath: string;
  appPath: string;
  iconPath: string | null;
}): DevShortcutDetails {
  return {
    // In dev, execPath is electron.exe and the app is loaded from a directory
    // argument, so the shortcut needs both to be launchable.
    target: input.execPath,
    args: `"${input.appPath}"`,
    appUserModelId: DEV_APP_USER_MODEL_ID,
    description: "Otto (Dev)",
    ...(input.iconPath ? { icon: input.iconPath, iconIndex: 0 } : {}),
  };
}

export interface EnsureAppUserModelIdInput {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** Opt out of the Start Menu entry; falls back to the release AUMID. */
  skipDevShortcut: boolean;
  /** Returns false when the shortcut could not be written. */
  writeDevShortcut: () => boolean;
}

export interface AppUserModelIdDecision {
  appUserModelId: string | null;
  wroteDevShortcut: boolean;
}

/**
 * Decides which AUMID this process should claim.
 *
 * A dev build takes DEV_APP_USER_MODEL_ID only if its Start Menu shortcut is in
 * place. If writing that shortcut fails we deliberately fall back to the release
 * AUMID rather than claiming an unregistered one: an unregistered AUMID can stop
 * Windows from displaying the toast at all, and toasts that work but look like
 * the installed app's beat toasts that silently never appear.
 */
export function decideAppUserModelId(input: EnsureAppUserModelIdInput): AppUserModelIdDecision {
  if (input.platform !== "win32") {
    return { appUserModelId: null, wroteDevShortcut: false };
  }

  if (input.isPackaged) {
    return { appUserModelId: RELEASE_APP_USER_MODEL_ID, wroteDevShortcut: false };
  }

  if (input.skipDevShortcut) {
    return { appUserModelId: RELEASE_APP_USER_MODEL_ID, wroteDevShortcut: false };
  }

  const wrote = input.writeDevShortcut();
  return {
    appUserModelId: wrote ? DEV_APP_USER_MODEL_ID : RELEASE_APP_USER_MODEL_ID,
    wroteDevShortcut: wrote,
  };
}
