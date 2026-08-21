import { useMemo } from "react";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getIsElectronRuntime } from "@/constants/layout";
import {
  buildEffectiveBindings,
  getWorkspaceIndexJumpModifierKey,
} from "@/keyboard/keyboard-shortcuts";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { useAppSettingValue, type AppSettings } from "@/hooks/use-settings";
import { getShortcutOs } from "@/utils/shortcut-platform";

const selectShortcutOverlayMode = (settings: AppSettings) => settings.shortcutOverlayMode;

export function useShortcutOverlayMode() {
  return useAppSettingValue(selectShortcutOverlayMode);
}

/** The workspace-number consumer of the broader held-modifier discovery state. */
export function useShowShortcutBadges(): boolean {
  const isDesktop = getIsElectronRuntime();
  const isMac = getShortcutOs() === "mac";
  const { overrides } = useKeyboardShortcutOverrides();
  const bindings = useMemo(() => buildEffectiveBindings(overrides), [overrides]);
  const workspaceModifier = getWorkspaceIndexJumpModifierKey({ isDesktop, isMac }, bindings);
  const mode = useShortcutOverlayMode();
  const revealEnabled = mode === "workspaces" || mode === "full";

  return useKeyboardShortcutsStore((state) => {
    if (!revealEnabled || !state.showShortcutBadges) {
      return false;
    }
    switch (workspaceModifier) {
      case "Alt":
        return state.shortcutDiscoveryModifiers.alt;
      case "Control":
        return state.shortcutDiscoveryModifiers.ctrl;
      case "Meta":
        return state.shortcutDiscoveryModifiers.meta;
      default:
        return false;
    }
  });
}

export function useShowShortcutDiscovery(): boolean {
  const mode = useShortcutOverlayMode();
  const revealEnabled = mode === "on-screen" || mode === "full";
  return useKeyboardShortcutsStore((state) => revealEnabled && state.showShortcutBadges);
}

/** Centered fallback commands are reserved for the Full overlay mode. */
export function useShowCenteredShortcutDiscovery(): boolean {
  const mode = useShortcutOverlayMode();
  return useKeyboardShortcutsStore((state) => mode === "full" && state.showShortcutBadges);
}
