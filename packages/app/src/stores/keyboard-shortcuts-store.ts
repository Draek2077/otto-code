import { create } from "zustand";
import type { SidebarShortcutWorkspaceTarget } from "@/utils/sidebar-shortcuts";

const SHORTCUT_BADGE_DELAY_MS = 300;

export type CommandCenterScope = "files" | null;

export interface ShortcutDiscoveryModifiers {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

const EMPTY_SHORTCUT_DISCOVERY_MODIFIERS: ShortcutDiscoveryModifiers = {
  alt: false,
  ctrl: false,
  meta: false,
  shift: false,
};

interface KeyboardShortcutsState {
  commandCenterOpen: boolean;
  commandCenterScope: CommandCenterScope;
  shortcutsDialogOpen: boolean;
  capturingShortcut: boolean;
  shortcutDiscoveryModifiers: ShortcutDiscoveryModifiers;
  showShortcutBadges: boolean;
  /** Sidebar-visible workspace targets (up to 9), in top-to-bottom visual order. */
  sidebarShortcutWorkspaceTargets: SidebarShortcutWorkspaceTarget[];

  setCommandCenterOpen: (open: boolean, scope?: CommandCenterScope) => void;
  setCommandCenterScope: (scope: CommandCenterScope) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setCapturingShortcut: (capturing: boolean) => void;
  setShortcutDiscoveryModifiers: (modifiers: ShortcutDiscoveryModifiers) => void;
  setSidebarShortcutWorkspaceTargets: (targets: SidebarShortcutWorkspaceTarget[]) => void;
  resetModifiers: () => void;
}

let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function updateBadgeTimer(
  set: (partial: Partial<KeyboardShortcutsState>) => void,
  get: () => KeyboardShortcutsState,
) {
  const { shortcutDiscoveryModifiers } = get();
  const modifierDown =
    shortcutDiscoveryModifiers.alt ||
    shortcutDiscoveryModifiers.ctrl ||
    shortcutDiscoveryModifiers.meta ||
    shortcutDiscoveryModifiers.shift;

  if (badgeTimer) {
    clearTimeout(badgeTimer);
    badgeTimer = null;
  }

  if (modifierDown) {
    badgeTimer = setTimeout(() => {
      set({ showShortcutBadges: true });
    }, SHORTCUT_BADGE_DELAY_MS);
  } else {
    set({ showShortcutBadges: false });
  }
}

export const useKeyboardShortcutsStore = create<KeyboardShortcutsState>((set, get) => ({
  commandCenterOpen: false,
  commandCenterScope: null,
  shortcutsDialogOpen: false,
  capturingShortcut: false,
  shortcutDiscoveryModifiers: EMPTY_SHORTCUT_DISCOVERY_MODIFIERS,
  showShortcutBadges: false,
  sidebarShortcutWorkspaceTargets: [],

  setCommandCenterOpen: (open, scope = null) =>
    set({ commandCenterOpen: open, commandCenterScope: open ? scope : null }),
  setCommandCenterScope: (scope) => set({ commandCenterScope: scope }),
  setShortcutsDialogOpen: (open) => set({ shortcutsDialogOpen: open }),
  setCapturingShortcut: (capturing) => set({ capturingShortcut: capturing }),
  setShortcutDiscoveryModifiers: (modifiers) => {
    set({ shortcutDiscoveryModifiers: modifiers });
    updateBadgeTimer(set, get);
  },
  setSidebarShortcutWorkspaceTargets: (targets) =>
    set({ sidebarShortcutWorkspaceTargets: targets }),
  resetModifiers: () => {
    set({ shortcutDiscoveryModifiers: EMPTY_SHORTCUT_DISCOVERY_MODIFIERS });
    updateBadgeTimer(set, get);
  },
}));
