import type { OpenTarget } from "../open-project-routing.js";
import { PendingOpenProjectStore } from "../pending-open-project-store.js";

export interface OwnedDesktopWindow<TAgentTarget> {
  webContentsId: number;
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  sendAgent(target: TAgentTarget): void;
}

interface DesktopWindowOwnerPort<TAgentTarget> {
  create(input: {
    initialRoute: string | null;
    restoreWindowState: boolean;
    onCreated(webContentsId: number): void;
    onClosed(webContentsId: number): void;
  }): Promise<OwnedDesktopWindow<TAgentTarget>>;
  windows(): OwnedDesktopWindow<TAgentTarget>[];
  focusedWindow(): OwnedDesktopWindow<TAgentTarget> | null;
  agentRoute(target: TAgentTarget): string;
  deliverAgent(webContentsId: number, target: TAgentTarget): TAgentTarget | null;
}

export interface DesktopWindowOwner<TAgentTarget> {
  openPrimary(input?: {
    initialRoute?: string | null;
    pendingProjectPath?: string | null;
    pendingOpenTarget?: OpenTarget | null;
  }): Promise<void>;
  openAdditional(input?: {
    pendingProjectPath?: string | null;
    pendingOpenTarget?: OpenTarget | null;
  }): Promise<void>;
  openOrFocusAgent(target: TAgentTarget): Promise<void>;
  restoreWhenActivated(): Promise<void>;
  takePendingProject(webContentsId: number): string | null;
}

export function createDesktopWindowOwner<TAgentTarget>(
  port: DesktopWindowOwnerPort<TAgentTarget>,
  pendingProjects = new PendingOpenProjectStore(),
): DesktopWindowOwner<TAgentTarget> {
  let agentWindowCreation: Promise<void> | null = null;

  const open = async (input: {
    initialRoute: string | null;
    pendingProjectPath: string | null;
    pendingOpenTarget: OpenTarget | null;
    restoreWindowState: boolean;
  }): Promise<void> => {
    await port.create({
      initialRoute: input.initialRoute,
      restoreWindowState: input.restoreWindowState,
      onCreated: (webContentsId) => {
        pendingProjects.set(webContentsId, input.pendingProjectPath);
        pendingProjects.setTarget(webContentsId, input.pendingOpenTarget);
      },
      onClosed: (webContentsId) => pendingProjects.delete(webContentsId),
    });
  };

  const owner: DesktopWindowOwner<TAgentTarget> = {
    openPrimary: (input = {}) =>
      open({
        initialRoute: input.initialRoute ?? null,
        pendingProjectPath: input.pendingProjectPath ?? null,
        pendingOpenTarget: input.pendingOpenTarget ?? null,
        restoreWindowState: true,
      }),
    openAdditional: (input = {}) =>
      open({
        initialRoute: null,
        pendingProjectPath: input.pendingProjectPath ?? null,
        pendingOpenTarget: input.pendingOpenTarget ?? null,
        restoreWindowState: false,
      }),
    async openOrFocusAgent(target) {
      const windows = port.windows();
      const window =
        port.focusedWindow() ?? windows.find((candidate) => candidate.isVisible()) ?? windows[0];
      if (!window || window.isDestroyed()) {
        if (!agentWindowCreation) {
          agentWindowCreation = owner
            .openPrimary({ initialRoute: port.agentRoute(target) })
            .finally(() => {
              agentWindowCreation = null;
            });
          await agentWindowCreation;
          return;
        }
        await agentWindowCreation;
        await owner.openOrFocusAgent(target);
        return;
      }
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      const deliverable = port.deliverAgent(window.webContentsId, target);
      if (deliverable) window.sendAgent(deliverable);
    },
    async restoreWhenActivated() {
      if (port.windows().length === 0) await owner.openPrimary();
    },
    takePendingProject: (webContentsId) => pendingProjects.take(webContentsId),
  };
  return owner;
}
