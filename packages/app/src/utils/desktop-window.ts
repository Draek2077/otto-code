import { useEffect, useMemo, useState } from "react";
import {
  getIsElectronRuntimeMac,
  getIsElectronRuntime,
  DESKTOP_TRAFFIC_LIGHT_WIDTH,
  DESKTOP_TRAFFIC_LIGHT_HEIGHT,
  DESKTOP_WINDOW_CONTROLS_WIDTH,
  DESKTOP_WINDOW_CONTROLS_HEIGHT,
} from "@/constants/layout";
import { getDesktopWindow } from "@/desktop/electron/window";
import { usePanelStore } from "@/stores/panel-store";
import { isNative } from "@/constants/platform";

interface RawWindowControlsPadding {
  left: number;
  right: number;
  top: number;
}

export interface WindowControlsOverlayInsets {
  left: number;
  right: number;
}

interface WindowControlsOverlayLike {
  visible: boolean;
  getTitlebarAreaRect: () => { x: number; width: number };
  addEventListener?: (type: "geometrychange", listener: () => void) => void;
}

type WindowControlsPaddingRole =
  | "sidebar"
  | "header"
  | "detailHeader"
  | "tabRow"
  | "explorerSidebar";

// Module-level cache so hook remounts (e.g., on navigation) don't briefly
// fall back to the default `false` while the async fullscreen check resolves.
// Without this, in fullscreen the sidebar flashes with traffic-light padding
// on first frame and then snaps to 0 once the async read completes.
let cachedIsFullscreen = false;
const fullscreenSubscribers = new Set<(value: boolean) => void>();
let fullscreenSubscriptionStarted = false;

function setCachedFullscreen(value: boolean) {
  if (cachedIsFullscreen === value) return;
  cachedIsFullscreen = value;
  for (const sub of fullscreenSubscribers) {
    sub(value);
  }
}

function startFullscreenSubscription() {
  if (fullscreenSubscriptionStarted) return;
  if (isNative || !getIsElectronRuntime()) return;
  fullscreenSubscriptionStarted = true;

  void (async () => {
    const win = getDesktopWindow();
    if (!win) return;

    if (typeof win.isFullscreen === "function") {
      try {
        setCachedFullscreen(await win.isFullscreen());
      } catch (error) {
        console.warn("[DesktopWindow] Failed to read fullscreen state", error);
      }
    }

    if (typeof win.onResized !== "function") return;

    try {
      await win.onResized(async () => {
        if (typeof win.isFullscreen !== "function") return;
        try {
          setCachedFullscreen(await win.isFullscreen());
        } catch (error) {
          console.warn("[DesktopWindow] Failed to read fullscreen state", error);
        }
      });
    } catch (error) {
      console.warn("[DesktopWindow] Failed to subscribe to resize", error);
    }
  })();
}

// The window-controls overlay geometry (navigator.windowControlsOverlay) gives
// the exact chrome-button footprint per OS, unlike the DESKTOP_* constants which
// are one-size guesses. Cached at module level like the fullscreen flag so hook
// remounts don't flash the fallback constant before the first read.
let cachedOverlayInsets: WindowControlsOverlayInsets | null = null;
const overlayInsetsSubscribers = new Set<(value: WindowControlsOverlayInsets | null) => void>();
let overlayInsetsSubscriptionStarted = false;

function setCachedOverlayInsets(value: WindowControlsOverlayInsets | null) {
  const unchanged =
    cachedOverlayInsets === value ||
    (cachedOverlayInsets !== null &&
      value !== null &&
      cachedOverlayInsets.left === value.left &&
      cachedOverlayInsets.right === value.right);
  if (unchanged) return;
  cachedOverlayInsets = value;
  for (const sub of overlayInsetsSubscribers) {
    sub(value);
  }
}

function getWindowControlsOverlay(): WindowControlsOverlayLike | null {
  if (isNative || !getIsElectronRuntime()) return null;
  if (typeof navigator === "undefined") return null;
  const overlay = (navigator as { windowControlsOverlay?: WindowControlsOverlayLike })
    .windowControlsOverlay;
  return overlay ?? null;
}

export function resolveOverlayInsets(input: {
  visible: boolean;
  rect: { x: number; width: number } | null;
  innerWidth: number;
}): WindowControlsOverlayInsets | null {
  if (!input.visible || !input.rect) return null;
  if (input.rect.width <= 0 || input.innerWidth <= 0) return null;
  const left = Math.max(0, Math.round(input.rect.x));
  const right = Math.max(0, Math.round(input.innerWidth - input.rect.x - input.rect.width));
  // A rect spanning the full window means the platform draws no overlay
  // controls — treat as "no geometry" so callers fall back to the constants.
  if (left <= 0 && right <= 0) return null;
  return { left, right };
}

function refreshOverlayInsets() {
  const overlay = getWindowControlsOverlay();
  if (!overlay) return;
  let rect: { x: number; width: number } | null = null;
  try {
    rect = overlay.getTitlebarAreaRect();
  } catch (error) {
    console.warn("[DesktopWindow] Failed to read window-controls overlay rect", error);
  }
  setCachedOverlayInsets(
    resolveOverlayInsets({ visible: overlay.visible, rect, innerWidth: window.innerWidth }),
  );
}

function startOverlayInsetsSubscription() {
  if (overlayInsetsSubscriptionStarted) return;
  const overlay = getWindowControlsOverlay();
  if (!overlay) return;
  overlayInsetsSubscriptionStarted = true;
  refreshOverlayInsets();
  // geometrychange fires on window resize too, keeping the right inset in sync
  // with innerWidth.
  overlay.addEventListener?.("geometrychange", refreshOverlayInsets);
}

// Started once at the desktop app root. Maximize/unmaximize is the problem
// transition: unlike a manual drag it does NOT deliver a settled resize to the
// renderer's web layout systems (Unistyles breakpoints, RN-Web Dimensions, and
// the ResizeObserver-backed onLayout the tab strip measures with), so
// breakpoints, sidebar sizing, and tab thresholds all stay frozen at the
// pre-maximize width until the next real resize. The main process emits a
// resized signal on maximize/unmaximize (see setupWindowResizeEvents); on it we
// dispatch a single synthetic window resize — the event every web layout
// consumer already listens to — plus refresh our own overlay insets, deferred a
// frame so window.innerWidth and the native overlay rect have both settled.
let resizeReflowSubscriptionStarted = false;

export function startDesktopResizeReflow(): void {
  if (resizeReflowSubscriptionStarted) return;
  if (isNative || !getIsElectronRuntime()) return;
  const win = getDesktopWindow();
  if (!win?.onResized) return;
  resizeReflowSubscriptionStarted = true;

  const reflow = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("resize"));
    }
    refreshOverlayInsets();
  };

  void win.onResized(() => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(reflow);
    } else {
      reflow();
    }
  });
}

function useWindowControlsOverlayInsets(): WindowControlsOverlayInsets | null {
  const [insets, setInsets] = useState(cachedOverlayInsets);

  useEffect(() => {
    startOverlayInsetsSubscription();
    // Sync to any value that resolved between render and effect.
    setInsets(cachedOverlayInsets);
    overlayInsetsSubscribers.add(setInsets);
    return () => {
      overlayInsetsSubscribers.delete(setInsets);
    };
  }, []);

  return insets;
}

function useRawWindowControlsPadding(): RawWindowControlsPadding {
  const [isFullscreen, setIsFullscreen] = useState(cachedIsFullscreen);
  const overlayInsets = useWindowControlsOverlayInsets();

  useEffect(() => {
    startFullscreenSubscription();
    // Sync to any value that resolved between render and effect.
    setIsFullscreen(cachedIsFullscreen);
    fullscreenSubscribers.add(setIsFullscreen);
    return () => {
      fullscreenSubscribers.delete(setIsFullscreen);
    };
  }, []);

  return resolveRawWindowControlsPadding({
    isElectron: getIsElectronRuntime(),
    isMac: getIsElectronRuntimeMac(),
    isFullscreen,
    overlayInsets,
  });
}

export function resolveRawWindowControlsPadding(input: {
  isElectron: boolean;
  isMac: boolean;
  isFullscreen: boolean;
  overlayInsets?: WindowControlsOverlayInsets | null;
}): RawWindowControlsPadding {
  if (!input.isElectron || input.isFullscreen) {
    return { left: 0, right: 0, top: 0 };
  }

  // Mac keeps the constants: traffic-light position is set by our own
  // trafficLightPosition option, so the guess is already exact.
  if (input.isMac) {
    return {
      left: DESKTOP_TRAFFIC_LIGHT_WIDTH,
      right: 0,
      top: DESKTOP_TRAFFIC_LIGHT_HEIGHT,
    };
  }

  return {
    left: 0,
    right: input.overlayInsets?.right ?? DESKTOP_WINDOW_CONTROLS_WIDTH,
    top: DESKTOP_WINDOW_CONTROLS_HEIGHT,
  };
}

/**
 * True when the explorer sidebar surface sits under the window-controls
 * overlay (Windows/Linux chrome buttons live top-right, where the explorer
 * docks). The overlay background must then match `surfaceSidebar` instead of
 * `surface0`, or the buttons render on a mismatched color patch. The explorer
 * only renders on workspace routes, on non-compact layouts, outside focus
 * mode — mirroring `shouldShowWorkspaceExplorerSidebar` plus the store flag.
 */
export function isExplorerUnderWindowControls(input: {
  isCompact: boolean;
  explorerOpen: boolean;
  focusModeEnabled: boolean;
  isWorkspaceRoute: boolean;
}): boolean {
  return (
    !input.isCompact && input.explorerOpen && !input.focusModeEnabled && input.isWorkspaceRoute
  );
}

export function useWindowControlsPadding(role: WindowControlsPaddingRole): {
  left: number;
  right: number;
  top: number;
} {
  const sidebarOpen = usePanelStore((state) => state.desktop.agentListOpen);
  const explorerOpen = usePanelStore((state) => state.desktop.fileExplorerOpen);
  const focusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const rawPadding = useRawWindowControlsPadding();
  const sidebarClosed = !sidebarOpen;

  const { left, right, top } = resolveWindowControlsPadding({
    role,
    rawPadding,
    sidebarClosed,
    explorerOpen,
    focusModeEnabled,
  });

  return useMemo(() => ({ left, right, top }), [left, right, top]);
}

export function resolveWindowControlsPadding(input: {
  role: WindowControlsPaddingRole;
  rawPadding: RawWindowControlsPadding;
  sidebarClosed: boolean;
  explorerOpen: boolean;
  focusModeEnabled: boolean;
}): RawWindowControlsPadding {
  if (input.role === "sidebar") {
    return {
      left: input.rawPadding.left,
      right: 0,
      top: input.rawPadding.top,
    };
  }

  if (input.role === "header") {
    return {
      left: input.sidebarClosed ? input.rawPadding.left : 0,
      right: input.explorerOpen ? 0 : input.rawPadding.right,
      top: 0,
    };
  }

  if (input.role === "detailHeader") {
    return {
      left: 0,
      right: input.rawPadding.right,
      top: 0,
    };
  }

  if (input.role === "tabRow") {
    return {
      left: input.focusModeEnabled ? input.rawPadding.left : 0,
      right: input.focusModeEnabled ? input.rawPadding.right : 0,
      top: 0,
    };
  }

  return {
    left: 0,
    right: input.rawPadding.right,
    top: 0,
  };
}
