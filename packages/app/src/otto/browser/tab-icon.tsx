import { useCallback, useEffect, useMemo, useState } from "react";
import { Image } from "react-native";
import { Globe } from "lucide-react-native";
import { getDesktopHost } from "@/desktop/host";
import type { PanelIconProps } from "@/panels/panel-registry";
import { createBrowserFaviconCache, type BrowserFaviconLookup } from "./favicon-cache";

const cache = createBrowserFaviconCache({
  loader: () => getDesktopHost()?.browser?.resolveFavicon ?? null,
});
function useFavicon(lookup: BrowserFaviconLookup | null) {
  const [dataUrl, setDataUrl] = useState(() => (lookup ? (cache.peek(lookup) ?? null) : null));
  useEffect(() => {
    if (!lookup) {
      setDataUrl(null);
      return;
    }
    let active = true;
    void cache.load(lookup).then((value) => {
      if (active) setDataUrl(value);
      return value;
    });
    return () => {
      active = false;
    };
  }, [lookup]);
  const failed = useCallback(() => {
    if (lookup) cache.markBroken(lookup);
    setDataUrl(null);
  }, [lookup]);
  return { dataUrl, failed };
}
/** One stable icon component per descriptor identity; a broken or absent image always shows Globe. */
export function createOttoBrowserTabIcon(lookup: BrowserFaviconLookup | null) {
  return function OttoBrowserTabIcon({ size, color }: PanelIconProps) {
    const { dataUrl, failed } = useFavicon(lookup);
    const source = useMemo(() => (dataUrl ? { uri: dataUrl } : undefined), [dataUrl]);
    const style = useMemo(() => ({ width: size, height: size, borderRadius: 3 }), [size]);
    if (dataUrl)
      return (
        <Image
          source={source}
          style={style}
          onError={failed}
          accessibilityIgnoresInvertColors
          testID={`browser-favicon-${lookup?.browserId}`}
        />
      );
    return (
      <Globe
        size={size}
        color={color}
        testID={`browser-globe-${lookup?.browserId ?? "unavailable"}`}
      />
    );
  };
}
