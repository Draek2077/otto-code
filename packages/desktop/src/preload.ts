import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { BrowserKeyboardPolicy } from "./features/browser-keyboard/index.js";

// This preload runs in Electron's sandbox and is tsc-compiled (not bundled), so it MUST
// NOT emit any runtime module load other than "electron" — a require() of a local or
// third-party module throws and aborts the preload before exposeInMainWorld runs, leaving
// window.ottoDesktop undefined (the 0.1.108 regression, #2103). Keep this literal in sync
// with OTTO_BROWSER_PROFILE_PARTITION in features/browser-profile.ts; preload-sandbox.test.ts
// guards both the no-local-import rule and this drift. Type-only imports are fine (erased at emit).
const OTTO_BROWSER_PROFILE_PARTITION = "persist:otto-browser";

type EventHandler = (payload: unknown) => void;

interface AttachedBrowserRegistration {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}

contextBridge.exposeInMainWorld("ottoDesktop", {
  platform: process.platform,
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("otto:invoke", command, args),
  getPendingOpenProject: () =>
    ipcRenderer.invoke("otto:get-pending-open-project") as Promise<string | null>,
  agentNavigation: {
    ready: () =>
      ipcRenderer.invoke("otto:agent-navigation:ready") as Promise<{
        serverId: string;
        agentId: string;
      } | null>,
  },
  events: {
    on: (event: string, handler: EventHandler): Promise<() => void> => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(`otto:event:${event}`, listener);
      return Promise.resolve(() => {
        ipcRenderer.removeListener(`otto:event:${event}`, listener);
      });
    },
  },
  window: {
    openNew: (options?: { pendingOpenProjectPath?: string | null }) =>
      ipcRenderer.invoke("otto:window:openNew", options),
    signalReady: () => ipcRenderer.invoke("otto:window:signalReady"),
    getCurrentWindow: () => ({
      toggleMaximize: () => ipcRenderer.invoke("otto:window:toggleMaximize"),
      setFullscreen: (fullscreen: boolean) =>
        ipcRenderer.invoke("otto:window:setFullscreen", fullscreen),
      isFullscreen: () => ipcRenderer.invoke("otto:window:isFullscreen"),
      updateWindowControls: (update: {
        height?: number;
        backgroundColor?: string;
        foregroundColor?: string;
        trafficLightOffsetY?: number;
      }) => ipcRenderer.invoke("otto:window:updateWindowControls", update),
      onResized: (handler: EventHandler): (() => void) => {
        const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
          handler(payload);
        };
        ipcRenderer.on("otto:window:resized", listener);
        return () => {
          ipcRenderer.removeListener("otto:window:resized", listener);
        };
      },
      setBadgeCount: (count?: number) => ipcRenderer.invoke("otto:window:setBadgeCount", count),
      setTrayAttention: (active: boolean) =>
        ipcRenderer.invoke("otto:window:setTrayAttention", active),
    }),
  },
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke("otto:dialog:ask", message, options),
    askWithCheckbox: (message: string, options: Record<string, unknown>) =>
      ipcRenderer.invoke("otto:dialog:askWithCheckbox", message, options),
    open: (options?: Record<string, unknown>) => ipcRenderer.invoke("otto:dialog:open", options),
  },
  pdf: {
    /** Standalone HTML in, base64 PDF bytes out. See features/print-to-pdf.ts. */
    printHtml: (input: { html: string }) => ipcRenderer.invoke("otto:pdf:printHtml", input),
  },
  notification: {
    isSupported: () => ipcRenderer.invoke("otto:notification:isSupported"),
    sendNotification: (payload: { title: string; body?: string; data?: Record<string, unknown> }) =>
      ipcRenderer.invoke("otto:notification:send", payload),
  },
  opener: {
    openUrl: (url: string) => ipcRenderer.invoke("otto:opener:openUrl", url),
  },
  editor: {
    listTargets: () => ipcRenderer.invoke("otto:editor:listTargets"),
    openTarget: (input: {
      editorId: string;
      workspacePath: string;
      filePath?: string;
      line?: number;
      column?: number;
    }) => ipcRenderer.invoke("otto:editor:openTarget", input),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  menu: {
    showContextMenu: (input?: Record<string, unknown>) =>
      ipcRenderer.invoke("otto:menu:showContextMenu", input),
    setCapturingShortcut: (capturing: boolean) =>
      ipcRenderer.invoke("otto:menu:set-capturing-shortcut", capturing),
  },
  browser: {
    setShortcutPolicy: (input: BrowserKeyboardPolicy) =>
      ipcRenderer.invoke("otto:browser:set-shortcut-policy", input),
    profilePartition: OTTO_BROWSER_PROFILE_PARTITION,
    registerAttachedBrowser: (input: AttachedBrowserRegistration) =>
      ipcRenderer.invoke("otto:browser:register-attached", input),
    unregisterWorkspaceBrowser: (browserId: string) =>
      ipcRenderer.invoke("otto:browser:unregister-workspace-browser", browserId),
    setWorkspaceActiveBrowser: (input: { workspaceId: string; browserId: string | null }) =>
      ipcRenderer.invoke("otto:browser:set-workspace-active-browser", input),
    openDevTools: (browserId: string) =>
      ipcRenderer.invoke("otto:browser:open-devtools", browserId),
    clearProfile: (legacyBrowserIds: string[]) =>
      ipcRenderer.invoke("otto:browser:clear-profile", legacyBrowserIds),
    executeAutomationCommand: (request: Record<string, unknown>) =>
      ipcRenderer.invoke("otto:browser:execute-automation-command", request),
    captureElement: (
      browserId: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => ipcRenderer.invoke("otto:browser:capture-element", browserId, rect),
    copyElement: (payload: { text?: string; imageDataUrl?: string }) =>
      ipcRenderer.invoke("otto:browser:copy-element", payload),
  },
});
