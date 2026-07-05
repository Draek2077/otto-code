import { useMemo } from "react";
import { Image } from "react-native";
import { Globe, Play } from "lucide-react-native";
import invariant from "tiny-invariant";
import { BrowserPane } from "@/components/browser-pane";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor, PanelIconProps, PanelRegistration } from "@/panels/panel-registry";
import { useBrowserStore } from "@/stores/browser-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

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
  return function BrowserTabIcon({ size, color }: PanelIconProps) {
    const source = useMemo(() => (input.faviconUrl ? { uri: input.faviconUrl } : undefined), []);
    const imageStyle = useMemo(() => ({ width: size, height: size, borderRadius: 3 }), [size]);

    // Preview tabs always show Play, even once a favicon loads, so they stay
    // visually distinct from tabs the user opened themselves.
    if (input.isPreview) {
      return <Play size={size} color={color} />;
    }

    if (input.faviconUrl) {
      return <Image accessibilityIgnoresInvertColors source={source} style={imageStyle} />;
    }

    return <Globe size={size} color={color} />;
  };
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
    subtitle: url,
    titleState: "ready",
    icon,
    statusBucket: browser?.isLoading ? "running" : null,
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

export const browserPanelRegistration: PanelRegistration<"browser"> = {
  kind: "browser",
  component: BrowserPanel,
  useDescriptor: useBrowserPanelDescriptor,
};
