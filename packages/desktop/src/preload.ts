import { contextBridge, ipcRenderer, webUtils } from "electron";

type EventHandler = (payload: unknown) => void;

contextBridge.exposeInMainWorld("ottoDesktop", {
  platform: process.platform,
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("otto:invoke", command, args),
  getPendingOpenProject: () =>
    ipcRenderer.invoke("otto:get-pending-open-project") as Promise<string | null>,
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
    getCurrentWindow: () => ({
      toggleMaximize: () => ipcRenderer.invoke("otto:window:toggleMaximize"),
      isFullscreen: () => ipcRenderer.invoke("otto:window:isFullscreen"),
      updateWindowControls: (update: {
        height?: number;
        backgroundColor?: string;
        foregroundColor?: string;
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
    }),
  },
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke("otto:dialog:ask", message, options),
    askWithCheckbox: (message: string, options: Record<string, unknown>) =>
      ipcRenderer.invoke("otto:dialog:askWithCheckbox", message, options),
    open: (options?: Record<string, unknown>) => ipcRenderer.invoke("otto:dialog:open", options),
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
      path: string;
      cwd?: string;
      mode?: "open" | "reveal";
    }) => ipcRenderer.invoke("otto:editor:openTarget", input),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  menu: {
    showContextMenu: (input?: Record<string, unknown>) =>
      ipcRenderer.invoke("otto:menu:showContextMenu", input),
  },
  browser: {
    registerWorkspaceBrowser: (input: { browserId: string; workspaceId: string }) =>
      ipcRenderer.invoke("otto:browser:register-workspace-browser", input),
    unregisterWorkspaceBrowser: (browserId: string) =>
      ipcRenderer.invoke("otto:browser:unregister-workspace-browser", browserId),
    setWorkspaceActiveBrowser: (input: { workspaceId: string; browserId: string | null }) =>
      ipcRenderer.invoke("otto:browser:set-workspace-active-browser", input),
    openDevTools: (browserId: string) =>
      ipcRenderer.invoke("otto:browser:open-devtools", browserId),
    clearPartition: (browserId: string) =>
      ipcRenderer.invoke("otto:browser:clear-partition", browserId),
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
