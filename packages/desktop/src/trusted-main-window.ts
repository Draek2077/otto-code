import { BrowserWindow, shell, type WebContents } from "electron";

export interface TrustedOttoOriginPolicy {
  packaged: boolean;
  developmentOrigins: ReadonlySet<string>;
}

function localOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1" &&
      parsed.hostname !== "::1"
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function createTrustedOttoOriginPolicy(options: {
  packaged: boolean;
  developmentUrls: readonly string[];
}): TrustedOttoOriginPolicy {
  return {
    packaged: options.packaged,
    developmentOrigins: new Set(
      options.developmentUrls
        .map((url) => localOrigin(url))
        .filter((origin): origin is string => origin !== null),
    ),
  };
}

export function isTrustedOttoRendererUrl(url: string, policy: TrustedOttoOriginPolicy): boolean {
  try {
    const parsed = new URL(url);
    if (policy.packaged) {
      return parsed.protocol === "otto:" && parsed.hostname === "app";
    }
    return policy.developmentOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

export function isExternalHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function decideTrustedMainWindowNavigation(
  url: string,
  policy: TrustedOttoOriginPolicy,
): "allow" | "block" | "externalize" {
  if (isTrustedOttoRendererUrl(url, policy)) {
    return "allow";
  }
  return isExternalHttpUrl(url) ? "externalize" : "block";
}

export function isTrustedMainWindowSender(
  sender: WebContents,
  policy: TrustedOttoOriginPolicy,
): boolean {
  if (sender.isDestroyed()) {
    return false;
  }
  const window = BrowserWindow.fromWebContents(sender);
  return window?.webContents === sender && isTrustedOttoRendererUrl(sender.getURL(), policy);
}

export function requireTrustedMainWindowSender(
  sender: WebContents,
  policy: TrustedOttoOriginPolicy,
): void {
  if (!isTrustedMainWindowSender(sender, policy)) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
}

export function setupTrustedMainWindowNavigation(
  win: BrowserWindow,
  policy: TrustedOttoOriginPolicy,
  openExternal: (url: string) => void = (url) => {
    void shell.openExternal(url);
  },
): void {
  const externalize = (url: string) => {
    if (decideTrustedMainWindowNavigation(url, policy) === "externalize") {
      openExternal(url);
    }
  };

  win.webContents.on("will-navigate", (event, url) => {
    if (decideTrustedMainWindowNavigation(url, policy) === "allow") {
      return;
    }
    event.preventDefault();
    externalize(url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (decideTrustedMainWindowNavigation(url, policy) !== "allow") {
      externalize(url);
    }
    return { action: "deny" };
  });
}
