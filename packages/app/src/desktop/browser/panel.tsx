import { useCallback, useEffect, useMemo, useState } from "react";
import { Image } from "react-native";
import { Globe, Play } from "@/components/icons/material-icons";
import invariant from "tiny-invariant";
import { BrowserPane } from "@/desktop/browser/pane";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useBrowserStore } from "@/desktop/browser/store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { withIconSizeToken } from "@/components/icons/icon-size";
import { getDesktopHost } from "@/desktop/host";
import { getBrowserTabIconKind, getBrowserTabLoadingStatus } from "./tab-icon-state";
import { createBrowserFaviconCache, type BrowserFaviconLookup } from "./favicon-cache";

function getBrowserLabel(input: { title: string; url: string }): string {
  const title = input.title.trim();
  if (title) {
    return title;
  }

  try {
    const parsed = new URL(input.url);
    return parsed.hostname || input.url;
  } catch {
    return input.url;
  }
}

// One cache per renderer, so the tab icon (which remounts whenever the panel
// descriptor changes) never re-asks main for a favicon it already resolved.
const browserFaviconCache = createBrowserFaviconCache({
  loader: () => getDesktopHost()?.browser?.resolveFavicon ?? null,
});

function useBrowserTabFavicon(lookup: BrowserFaviconLookup | null): {
  dataUrl: string | null;
  markBroken: () => void;
} {
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    lookup ? (browserFaviconCache.peek(lookup) ?? null) : null,
  );
  const browserId = lookup?.browserId ?? null;
  const faviconUrl = lookup?.faviconUrl ?? null;
  const pageUrl = lookup?.pageUrl ?? null;

  useEffect(() => {
    if (!browserId || !faviconUrl) {
      setDataUrl(null);
      return;
    }
    const current = { browserId, faviconUrl, pageUrl };
    const cached = browserFaviconCache.peek(current);
    if (cached !== undefined) {
      setDataUrl(cached);
      return;
    }
    let cancelled = false;
    const resolve = async () => {
      const resolved = await browserFaviconCache.load(current);
      if (!cancelled) setDataUrl(resolved);
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [browserId, faviconUrl, pageUrl]);

  const markBroken = useCallback(() => {
    if (browserId && faviconUrl) {
      browserFaviconCache.markBroken({ browserId, faviconUrl, pageUrl });
    }
    setDataUrl(null);
  }, [browserId, faviconUrl, pageUrl]);

  return { dataUrl, markBroken };
}

function createBrowserTabIcon(input: {
  browserId: string;
  faviconUrl: string | null;
  pageUrl: string | null;
  isPreview: boolean;
}) {
  const lookup =
    input.faviconUrl && !input.isPreview
      ? { browserId: input.browserId, faviconUrl: input.faviconUrl, pageUrl: input.pageUrl }
      : null;
  function BrowserTabIcon({ size, color }: { size: number; color?: string }) {
    // The page's favicon URL is never handed to <Image>: main resolves it to a
    // data: URL (the app CSP blocks remote images), and null keeps the Globe.
    const { dataUrl, markBroken } = useBrowserTabFavicon(lookup);
    const source = useMemo(() => (dataUrl ? { uri: dataUrl } : undefined), [dataUrl]);
    const imageStyle = useMemo(() => ({ width: size, height: size, borderRadius: 3 }), [size]);
    const iconKind = getBrowserTabIconKind({
      faviconUrl: dataUrl,
      faviconFailed: false,
      isPreview: input.isPreview,
    });

    // Preview tabs always show Play, even once a favicon loads, so they stay
    // visually distinct from tabs the user opened themselves.
    if (iconKind === "preview") {
      return <Play size={size} color={color} />;
    }

    if (iconKind === "favicon") {
      return (
        <Image
          accessibilityIgnoresInvertColors
          onError={markBroken}
          source={source}
          style={imageStyle}
        />
      );
    }

    return <Globe size={size} color={color} />;
  }
  return withIconSizeToken(BrowserTabIcon, "BrowserTabIcon");
}

function useBrowserPanelDescriptor(target: {
  kind: "browser";
  browserId: string;
}): PanelDescriptor {
  const browser = useBrowserStore((state) => state.browsersById[target.browserId] ?? null);
  const url = browser?.url ?? "https://example.com";
  const icon = createBrowserTabIcon({
    browserId: target.browserId,
    faviconUrl: browser?.faviconUrl ?? null,
    pageUrl: browser?.url ?? null,
    isPreview: browser?.isPreview ?? false,
  });

  return {
    label: getBrowserLabel({ title: browser?.title ?? "", url }),
    tooltip: url,
    subtitle: url,
    titleState: "ready",
    icon,
    // Page load is ordinary I/O, so the workspace tab replaces the page icon
    // with the neutral circular loader until Electron reports it stopped.
    statusBucket: getBrowserTabLoadingStatus(browser?.isLoading ?? false),
    busyLoader: "spinner",
  };
}

function BrowserPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  const { focusPane, isInteractive } = usePaneFocus();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "browser", "BrowserPanel requires browser target");
  return (
    <BrowserPane
      browserId={target.browserId}
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={cwd}
      isInteractive={isInteractive}
      onFocusPane={focusPane}
    />
  );
}

export const browserPanelRegistration = definePanel("browser", {
  component: BrowserPanel,
  useDescriptor: useBrowserPanelDescriptor,
});
