import { useCallback, useMemo, useState } from "react";
import { Image } from "react-native";
import { Globe, Play } from "@/components/icons/material-icons";
import invariant from "tiny-invariant";
import { BrowserPane } from "@/desktop/browser/pane";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useBrowserStore } from "@/desktop/browser/store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { withIconSizeToken } from "@/components/icons/icon-size";
import { getBrowserTabIconKind } from "./tab-icon-state";

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

function createBrowserTabIcon(input: { faviconUrl: string | null; isPreview: boolean }) {
  function BrowserTabIcon({ size, color }: { size: number; color?: string }) {
    const [faviconFailed, setFaviconFailed] = useState(false);
    const source = useMemo(() => (input.faviconUrl ? { uri: input.faviconUrl } : undefined), []);
    const imageStyle = useMemo(() => ({ width: size, height: size, borderRadius: 3 }), [size]);
    const iconKind = getBrowserTabIconKind({ ...input, faviconFailed });
    const handleFaviconError = useCallback(() => setFaviconFailed(true), []);

    // Preview tabs always show Play, even once a favicon loads, so they stay
    // visually distinct from tabs the user opened themselves.
    if (iconKind === "preview") {
      return <Play size={size} color={color} />;
    }

    if (iconKind === "favicon") {
      return (
        <Image
          accessibilityIgnoresInvertColors
          onError={handleFaviconError}
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
    faviconUrl: browser?.faviconUrl ?? null,
    isPreview: browser?.isPreview ?? false,
  });

  return {
    label: getBrowserLabel({ title: browser?.title ?? "", url }),
    tooltip: url,
    subtitle: url,
    titleState: "ready",
    icon,
    // Keep the browser identity visible while a page is loading. The shared
    // tab presentation swaps the icon for a busy loader when statusBucket is
    // "running", which makes browser tabs appear blank (especially when a
    // navigation fails and the loading state lingers).
    statusBucket: null,
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
