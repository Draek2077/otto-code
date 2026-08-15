import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcutsStore } from "./keyboard-shortcuts-store";

beforeEach(() => {
  useKeyboardShortcutsStore.setState({
    commandCenterOpen: false,
    shortcutsDialogOpen: false,
    capturingShortcut: false,
    shortcutDiscoveryModifiers: { alt: false, ctrl: false, meta: false, shift: false },
    showShortcutBadges: false,
    sidebarShortcutWorkspaceTargets: [],
  });
});

describe("keyboard-shortcuts-store", () => {
  it("toggles command center open state", () => {
    expect(useKeyboardShortcutsStore.getState().commandCenterOpen).toBe(false);
    useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
    expect(useKeyboardShortcutsStore.getState().commandCenterOpen).toBe(true);
  });

  it("toggles shortcut capture state", () => {
    expect(useKeyboardShortcutsStore.getState().capturingShortcut).toBe(false);
    useKeyboardShortcutsStore.getState().setCapturingShortcut(true);
    expect(useKeyboardShortcutsStore.getState().capturingShortcut).toBe(true);
  });

  it("reveals shortcut discovery after a held modifier", () => {
    vi.useFakeTimers();

    useKeyboardShortcutsStore.getState().setShortcutDiscoveryModifiers({
      alt: false,
      ctrl: true,
      meta: false,
      shift: false,
    });

    expect(useKeyboardShortcutsStore.getState().showShortcutBadges).toBe(false);
    vi.advanceTimersByTime(150);
    expect(useKeyboardShortcutsStore.getState().showShortcutBadges).toBe(true);

    useKeyboardShortcutsStore.getState().setShortcutDiscoveryModifiers({
      alt: false,
      ctrl: true,
      meta: false,
      shift: true,
    });
    expect(useKeyboardShortcutsStore.getState().showShortcutBadges).toBe(true);

    useKeyboardShortcutsStore.getState().resetModifiers();
    expect(useKeyboardShortcutsStore.getState().showShortcutBadges).toBe(false);
    vi.useRealTimers();
  });

  it("reveals shortcut discovery after Shift alone", () => {
    vi.useFakeTimers();

    useKeyboardShortcutsStore.getState().setShortcutDiscoveryModifiers({
      alt: false,
      ctrl: false,
      meta: false,
      shift: true,
    });

    vi.advanceTimersByTime(150);
    expect(useKeyboardShortcutsStore.getState().showShortcutBadges).toBe(true);

    useKeyboardShortcutsStore.getState().resetModifiers();
    expect(useKeyboardShortcutsStore.getState().showShortcutBadges).toBe(false);
    vi.useRealTimers();
  });
});
