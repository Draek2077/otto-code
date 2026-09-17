import { useEffect, useRef, useState } from "react";
import { getIsElectronRuntimeMac } from "@/constants/layout";
import { useAgentDirectoryDemand } from "./use-aggregated-agents";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { useWorkspaceStatusesForBadges } from "@/stores/session-store-hooks";
import { deriveMacDockBadgeCountFromWorkspaceStatuses } from "@/utils/desktop-badge-state";
import { isNative } from "@/constants/platform";

type FaviconStatus = "none" | "running" | "attention";
type ColorScheme = "dark" | "light";

/* eslint-disable @typescript-eslint/no-require-imports */
const FAVICON_IMAGES: Record<ColorScheme, Record<FaviconStatus, { uri: string } | number>> = {
  dark: {
    none: require("../../assets/images/favicon-dark.png"),
    running: require("../../assets/images/favicon-dark-running.png"),
    attention: require("../../assets/images/favicon-dark-attention.png"),
  },
  light: {
    none: require("../../assets/images/favicon-light.png"),
    running: require("../../assets/images/favicon-light-running.png"),
    attention: require("../../assets/images/favicon-light-attention.png"),
  },
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Selected as a primitive so the hook re-renders only when the status flips, not on every
// streamed agent update. Archived agents are skipped, matching the aggregated agent list.
function deriveFaviconStatus(sessions: Record<string, SessionState>): FaviconStatus {
  let hasAttention = false;
  for (const session of Object.values(sessions)) {
    for (const agent of session.agents.values()) {
      if (agent.archivedAt) continue;
      if (agent.status === "running") {
        return "running";
      }
      if (agent.requiresAttention || agent.pendingPermissions.length > 0) {
        hasAttention = true;
      }
    }
  }
  return hasAttention ? "attention" : "none";
}

function getFaviconUri(status: FaviconStatus, colorScheme: ColorScheme): string {
  const image = FAVICON_IMAGES[colorScheme][status];
  if (typeof image === "object" && "uri" in image) {
    return image.uri;
  }
  const suffix = status === "none" ? "" : `-${status}`;
  return `/assets/images/favicon-${colorScheme}${suffix}.png`;
}

function getOrCreateFaviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
  }
  return link;
}

function updateFavicon(status: FaviconStatus, colorScheme: ColorScheme) {
  const link = getOrCreateFaviconLink();
  if (!link) return;

  const newHref = getFaviconUri(status, colorScheme);
  // `link.href` reads back as an absolute URL, so compare against the resolved form; comparing to
  // a relative path never matches and rewrites the favicon on every call.
  if (link.href !== new URL(newHref, document.baseURI).href) {
    link.href = newHref;
  }
}

function getSystemColorScheme(): ColorScheme {
  if (isNative || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function updateMacDockBadge(count?: number) {
  if (isNative || !getIsElectronRuntimeMac()) return;

  const desktopWindow = getDesktopHost()?.window?.getCurrentWindow?.();
  if (!desktopWindow || typeof desktopWindow.setBadgeCount !== "function") {
    return;
  }

  try {
    await desktopWindow.setBadgeCount(count);
  } catch (error) {
    console.warn("[useFaviconStatus] Failed to update macOS dock badge", error);
  }
}

// The tray icon (all desktop platforms, not just mac) swaps to the amber wink
// variant when something needs the user's attention - see packages/desktop/src/features/tray.ts.
async function updateTrayAttention(status: FaviconStatus) {
  if (isNative || !isElectronRuntime()) return;

  const desktopWindow = getDesktopHost()?.window?.getCurrentWindow?.();
  if (!desktopWindow || typeof desktopWindow.setTrayAttention !== "function") {
    return;
  }

  try {
    await desktopWindow.setTrayAttention(status === "attention");
  } catch (error) {
    console.warn("[useFaviconStatus] Failed to update tray attention state", error);
  }
}

export function useFaviconStatus() {
  useAgentDirectoryDemand(!isNative);
  const status = useSessionStore((state) =>
    isNative ? "none" : deriveFaviconStatus(state.sessions),
  );
  const workspaceStatuses = useWorkspaceStatusesForBadges();
  const [colorScheme, setColorScheme] = useState<ColorScheme>(getSystemColorScheme);
  const lastDockBadgeCountRef = useRef<number | undefined>(undefined);
  const lastTrayAttentionRef = useRef<boolean | undefined>(undefined);

  // Listen for system color scheme changes
  useEffect(() => {
    if (isNative || typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setColorScheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Update favicon when agents or color scheme changes
  useEffect(() => {
    if (isNative) return;

    updateFavicon(status, colorScheme);

    const dockBadgeCount = deriveMacDockBadgeCountFromWorkspaceStatuses(workspaceStatuses);
    if (dockBadgeCount !== lastDockBadgeCountRef.current) {
      lastDockBadgeCountRef.current = dockBadgeCount;
      void updateMacDockBadge(dockBadgeCount);
    }

    const trayAttention = status === "attention";
    if (trayAttention !== lastTrayAttentionRef.current) {
      lastTrayAttentionRef.current = trayAttention;
      void updateTrayAttention(status);
    }
  }, [status, colorScheme, workspaceStatuses]);
}
