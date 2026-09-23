import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, Notification, ipcMain, nativeImage } from "electron";
import { resolveBrandedAssetPath } from "./dev-icon.js";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

interface NotificationClickPayload {
  data?: Record<string, unknown>;
}

const activeNotifications = new Set<Notification>();
interface NotificationSource {
  serverId: string;
  kind: "agent" | "terminal";
  id: string;
  workspaceId: string | null;
  key: string;
}

interface AttentionSnapshot {
  generation: number;
  agentIds: Set<string>;
  workspaceIds: Set<string>;
}

const sourceNotifications = new Map<
  string,
  { source: NotificationSource; notification: Notification }
>();
const attentionSnapshots = new Map<string, AttentionSnapshot>();

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function notificationSource(data: Record<string, unknown> | undefined): NotificationSource | null {
  const serverId = toTrimmedString(data?.serverId);
  const agentId = toTrimmedString(data?.agentId);
  const terminalId = toTrimmedString(data?.terminalId);
  if (!serverId || (!agentId && !terminalId)) return null;
  const kind = agentId ? "agent" : "terminal";
  const id = (agentId ?? terminalId)!;
  return {
    serverId,
    kind,
    id,
    workspaceId: toTrimmedString(data?.workspaceId),
    key: JSON.stringify([serverId, kind, id]),
  };
}

function sourceStillNeedsAttention(
  source: NotificationSource,
  snapshot: AttentionSnapshot,
): boolean {
  if (source.kind === "agent") return snapshot.agentIds.has(source.id);
  if (source.workspaceId) return snapshot.workspaceIds.has(source.workspaceId);
  return snapshot.agentIds.size > 0 || snapshot.workspaceIds.size > 0;
}

function dismissNotification(notification: Notification): void {
  activeNotifications.delete(notification);
  notification.close();
}

function getNotificationIcon(): Electron.NativeImage | null {
  // Dev builds show the navy tile here too, so a dev toast is distinguishable
  // by artwork and not only by sender name. See dev-icon.ts.
  const assetsDir = path.resolve(__dirname, "../assets");
  const candidates = [
    resolveBrandedAssetPath(assetsDir, "icon.png"),
    path.join(assetsDir, "64x64.png"),
    path.join(assetsDir, "128x128.png"),
  ];

  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) {
      continue;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  }

  return null;
}

function focusSenderWindow(sender: Electron.WebContents): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win || win.isDestroyed()) {
    return null;
  }
  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
  return win;
}

/**
 * macOS requires a notification to have been shown at least once before
 * the app appears in System Preferences > Notifications. We fire a
 * silent no-op notification during startup to ensure registration.
 */
export function ensureNotificationCenterRegistration(): void {
  if (process.platform !== "darwin" || !Notification.isSupported()) {
    return;
  }

  const probe = new Notification({ title: app.name, silent: true });
  probe.on("show", () => probe.close());
  setTimeout(() => probe.close(), 2_000);
  probe.show();
}

export function registerNotificationHandlers(options: {
  requireTrustedSender: (event: Electron.IpcMainInvokeEvent) => void;
}): void {
  ipcMain.handle("otto:notification:isSupported", (event) => {
    options.requireTrustedSender(event);
    return Notification.isSupported();
  });

  ipcMain.handle("otto:notification:send", async (event, rawInput?: NotificationInput) => {
    options.requireTrustedSender(event);
    if (!Notification.isSupported()) {
      return false;
    }

    const title = toTrimmedString(rawInput?.title);
    if (!title) {
      return false;
    }

    const body = toTrimmedString(rawInput?.body) ?? undefined;
    const data = toRecord(rawInput?.data);
    const source = notificationSource(data);
    const startingGeneration = source
      ? (attentionSnapshots.get(source.serverId)?.generation ?? 0)
      : 0;
    const icon = getNotificationIcon();
    const settings = await getDesktopSettingsStore().get();
    if (source) {
      const snapshot = attentionSnapshots.get(source.serverId);
      if (
        snapshot &&
        snapshot.generation > startingGeneration &&
        !sourceStillNeedsAttention(source, snapshot)
      ) {
        return false;
      }
    }
    const notification = new Notification({
      title,
      ...(body ? { body } : {}),
      ...(icon ? { icon } : {}),
      silent: !settings.notifications.playSound,
    });

    if (source) {
      const previous = sourceNotifications.get(source.key)?.notification;
      if (previous) dismissNotification(previous);
      sourceNotifications.set(source.key, { source, notification });
    }

    activeNotifications.add(notification);

    notification.on("click", () => {
      const win = focusSenderWindow(event.sender);
      if (win && data && Object.keys(data).length > 0) {
        const payload: NotificationClickPayload = { data };
        win.webContents.send("otto:event:notification-click", payload);
      }
      if (source && sourceNotifications.get(source.key)?.notification === notification) {
        sourceNotifications.delete(source.key);
      }
      dismissNotification(notification);
    });

    notification.on("close", () => {
      // GNOME can retain an expired toast in its notification list. Keep its
      // Electron handle until Otto clears the corresponding attention state.
      if (process.platform !== "linux" || !source) {
        activeNotifications.delete(notification);
        if (source && sourceNotifications.get(source.key)?.notification === notification) {
          sourceNotifications.delete(source.key);
        }
      }
    });

    notification.show();
    return true;
  });

  ipcMain.handle("otto:notification:reconcile", (event, rawInput?: unknown) => {
    options.requireTrustedSender(event);
    const input = toRecord(rawInput);
    const serverId = toTrimmedString(input?.serverId);
    const agentIds = input?.agentIds;
    const workspaceIds = input?.workspaceIds;
    if (
      !serverId ||
      !Array.isArray(agentIds) ||
      !agentIds.every((id) => typeof id === "string") ||
      !Array.isArray(workspaceIds) ||
      !workspaceIds.every((id) => typeof id === "string")
    )
      return;
    const snapshot: AttentionSnapshot = {
      generation: (attentionSnapshots.get(serverId)?.generation ?? 0) + 1,
      agentIds: new Set(agentIds),
      workspaceIds: new Set(workspaceIds),
    };
    attentionSnapshots.set(serverId, snapshot);
    for (const [key, { source, notification }] of sourceNotifications) {
      if (source.serverId !== serverId || sourceStillNeedsAttention(source, snapshot)) continue;
      sourceNotifications.delete(key);
      dismissNotification(notification);
    }
  });
}
