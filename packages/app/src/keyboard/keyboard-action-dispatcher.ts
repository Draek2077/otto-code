import { getIsDeveloperModeSnapshot } from "@/hooks/use-interface-mode";

export type KeyboardActionScope = "global" | "message-input" | "sidebar" | "workspace";

export type KeyboardActionId =
  | "agent.interrupt"
  | "message-input.focus"
  | "message-input.send"
  | "message-input.dictation-toggle"
  | "message-input.dictation-cancel"
  | "message-input.dictation-confirm"
  | "message-input.voice-toggle"
  | "message-input.voice-mute-toggle"
  | "message-input.mode-cycle"
  | "workspace.tab.new"
  | "workspace.tab.close-current"
  | "workspace.tab.navigate-index"
  | "workspace.tab.navigate-relative"
  | "workspace.pane.split.right"
  | "workspace.pane.split.down"
  | "workspace.pane.focus.left"
  | "workspace.pane.focus.right"
  | "workspace.pane.focus.up"
  | "workspace.pane.focus.down"
  | "workspace.pane.move-tab.left"
  | "workspace.pane.move-tab.right"
  | "workspace.pane.move-tab.up"
  | "workspace.pane.move-tab.down"
  | "workspace.pane.close"
  | "workspace.terminal.new"
  | "sidebar.toggle.right"
  | "sidebar.open.files"
  | "sidebar.open.search"
  | "sidebar.open.changes"
  | "workspace.new"
  | "worktree.new"
  | "workspace.archive";

export type KeyboardActionDefinition =
  | { id: "agent.interrupt"; scope: KeyboardActionScope }
  | { id: "message-input.focus"; scope: KeyboardActionScope }
  | { id: "message-input.send"; scope: KeyboardActionScope }
  | { id: "message-input.dictation-toggle"; scope: KeyboardActionScope }
  | { id: "message-input.dictation-cancel"; scope: KeyboardActionScope }
  | { id: "message-input.dictation-confirm"; scope: KeyboardActionScope }
  | { id: "message-input.voice-toggle"; scope: KeyboardActionScope }
  | { id: "message-input.voice-mute-toggle"; scope: KeyboardActionScope }
  | { id: "message-input.mode-cycle"; scope: KeyboardActionScope }
  | { id: "workspace.tab.new"; scope: KeyboardActionScope }
  | { id: "workspace.tab.close-current"; scope: KeyboardActionScope }
  | { id: "workspace.tab.navigate-index"; scope: KeyboardActionScope; index: number }
  | { id: "workspace.tab.navigate-relative"; scope: KeyboardActionScope; delta: 1 | -1 }
  | { id: "workspace.pane.split.right"; scope: KeyboardActionScope }
  | { id: "workspace.pane.split.down"; scope: KeyboardActionScope }
  | { id: "workspace.pane.focus.left"; scope: KeyboardActionScope }
  | { id: "workspace.pane.focus.right"; scope: KeyboardActionScope }
  | { id: "workspace.pane.focus.up"; scope: KeyboardActionScope }
  | { id: "workspace.pane.focus.down"; scope: KeyboardActionScope }
  | { id: "workspace.pane.move-tab.left"; scope: KeyboardActionScope }
  | { id: "workspace.pane.move-tab.right"; scope: KeyboardActionScope }
  | { id: "workspace.pane.move-tab.up"; scope: KeyboardActionScope }
  | { id: "workspace.pane.move-tab.down"; scope: KeyboardActionScope }
  | { id: "workspace.pane.close"; scope: KeyboardActionScope }
  | { id: "workspace.terminal.new"; scope: KeyboardActionScope }
  | { id: "sidebar.toggle.right"; scope: KeyboardActionScope }
  | { id: "sidebar.open.files"; scope: KeyboardActionScope }
  | { id: "sidebar.open.search"; scope: KeyboardActionScope }
  | { id: "sidebar.open.changes"; scope: KeyboardActionScope }
  | { id: "workspace.new"; scope: KeyboardActionScope }
  | { id: "worktree.new"; scope: KeyboardActionScope }
  | { id: "workspace.archive"; scope: KeyboardActionScope };

// Actions that reach developer-only surfaces (the git/search explorer tabs, new
// terminals, pane splits). In User interface mode they are swallowed at dispatch
// so a stray keybinding can't resurrect a surface the UI hides — one gate for
// every listener, per interface-modes.md surface inventory (#8).
//
// `sidebar.open.files` is NOT here: User mode keeps a Files-only explorer, so the
// files shortcut stays live. Search/Changes remain gated (their tabs are hidden).
const DEVELOPER_ONLY_ACTIONS: ReadonlySet<KeyboardActionId> = new Set([
  "sidebar.open.search",
  "sidebar.open.changes",
  "workspace.terminal.new",
  "workspace.pane.split.right",
  "workspace.pane.split.down",
]);

export interface KeyboardActionHandler {
  handlerId: string;
  actions: readonly KeyboardActionId[];
  enabled: boolean;
  priority: number;
  isActive?: () => boolean;
  handle: (action: KeyboardActionDefinition) => boolean;
}

type KeyboardActionRegistryEntry = KeyboardActionHandler & {
  registeredAt: number;
};

export function createKeyboardActionDispatcher() {
  let nextRegistrationOrder = 1;
  const handlers = new Map<string, KeyboardActionRegistryEntry>();

  return {
    registerHandler(handler: KeyboardActionHandler) {
      handlers.set(handler.handlerId, {
        ...handler,
        registeredAt: nextRegistrationOrder++,
      });

      return () => {
        const current = handlers.get(handler.handlerId);
        if (!current) {
          return;
        }
        handlers.delete(handler.handlerId);
      };
    },

    dispatch(action: KeyboardActionDefinition): boolean {
      if (DEVELOPER_ONLY_ACTIONS.has(action.id) && !getIsDeveloperModeSnapshot()) {
        return false;
      }
      const candidates = Array.from(handlers.values())
        .filter((handler) => handler.actions.includes(action.id))
        .filter((handler) => handler.enabled)
        .filter((handler) => (handler.isActive ? handler.isActive() : true))
        .sort((left, right) => {
          if (left.priority !== right.priority) {
            return right.priority - left.priority;
          }
          return right.registeredAt - left.registeredAt;
        });

      for (const handler of candidates) {
        if (handler.handle(action)) {
          return true;
        }
      }

      return false;
    },
  };
}

export const keyboardActionDispatcher = createKeyboardActionDispatcher();
