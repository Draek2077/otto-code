import { webContents as allWebContents, type WebContents } from "electron";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  handleBrowserWindowOpenRequest,
  isAllowedBrowserWebviewUrl,
} from "./window-open.js";
import { OttoBrowserWebviewRegistry, type BrowserWorkspaceRegistration } from "./registry.js";

export { BROWSER_NEW_TAB_REQUEST_EVENT, handleBrowserWindowOpenRequest };
export type { BrowserWorkspaceRegistration };

const browserRegistry = new OttoBrowserWebviewRegistry();

interface BrowserWebContentsIdentity {
  readonly id: number;
  isDestroyed(): boolean;
}

interface RegisteredBrowserWebContents extends BrowserWebContentsIdentity {
  setBackgroundThrottling(allowed: boolean): void;
  once(event: "destroyed", listener: () => void): void;
}

function getBrowserIdFromWebviewPartition(partition: string | undefined): string | null {
  const prefix = "persist:otto-browser-";
  if (!partition?.startsWith(prefix)) {
    return null;
  }
  const browserId = partition.slice(prefix.length).trim();
  return browserId.length > 0 ? browserId : null;
}

export function readBrowserIdFromWebviewAttach(input: {
  src?: string;
  partition?: string;
}): string | null {
  if (!isAllowedBrowserWebviewUrl(input.src)) {
    return null;
  }
  return getBrowserIdFromWebviewPartition(input.partition);
}

export function listRegisteredOttoBrowserIds(): string[] {
  return browserRegistry
    .listBrowserIds()
    .filter((browserId) => getOttoBrowserWebContents(browserId));
}

export function registerOttoBrowserWebContents(
  contents: RegisteredBrowserWebContents,
  browserId: string,
): void {
  contents.setBackgroundThrottling(false);
  browserRegistry.registerWebContents({ webContentsId: contents.id, browserId });
  contents.once("destroyed", () => {
    browserRegistry.unregisterWebContents(contents.id);
  });
}

export function getOttoBrowserIdForWebContents(
  contents: BrowserWebContentsIdentity | null,
): string | null {
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  return browserRegistry.getBrowserIdForWebContents(contents.id);
}

export function registerOttoBrowserWorkspace(input: BrowserWorkspaceRegistration): void {
  browserRegistry.registerWorkspace(input);
}

export function unregisterOttoBrowser(browserId: string): void {
  browserRegistry.unregisterBrowser(browserId);
}

export function getOttoBrowserWorkspaceId(browserId: string): string | null {
  return browserRegistry.getWorkspaceId(browserId);
}

export function listRegisteredOttoBrowserIdsForWorkspace(workspaceId: string): string[] {
  return browserRegistry
    .listBrowserIdsForWorkspace(workspaceId)
    .filter((browserId) => getOttoBrowserWebContents(browserId));
}

export function setWorkspaceActiveOttoBrowserId(input: {
  workspaceId: string;
  browserId: string | null;
}): void {
  browserRegistry.setWorkspaceActiveBrowser(input);
}

export function getWorkspaceActiveOttoBrowserId(workspaceId: string): string | null {
  return browserRegistry.getWorkspaceActiveBrowserId(workspaceId);
}

export function getOttoBrowserWebContents(browserId: string): WebContents | null {
  const contentsId = browserRegistry.getWebContentsIdForBrowser(browserId);
  if (contentsId === null) {
    return null;
  }
  const contents = allWebContents.fromId(contentsId);
  if (contents && !contents.isDestroyed()) {
    return contents;
  }
  browserRegistry.unregisterWebContents(contentsId);
  return null;
}

export function getMostRecentWorkspaceActiveOttoBrowserWebContents(): WebContents | null {
  const browserId = browserRegistry.getMostRecentWorkspaceActiveBrowserId();
  return browserId ? getOttoBrowserWebContents(browserId) : null;
}

function preventUnsafeBrowserWebviewNavigation(
  event: { preventDefault: () => void },
  url: string | undefined,
): void {
  if (!isAllowedBrowserWebviewUrl(url)) {
    event.preventDefault();
  }
}

export function registerBrowserWebviewNavigationGuards(contents: WebContents): void {
  contents.on("will-navigate", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
  contents.on("will-frame-navigate", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
  contents.on("will-redirect", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
}
