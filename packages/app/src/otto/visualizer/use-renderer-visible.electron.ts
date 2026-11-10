import { useSyncExternalStore } from "react";
import { getDesktopHost } from "@/desktop/host";

const hidden = () => false;
const noSubscription = () => () => {};

export function useVisualizerRendererVisible(): boolean {
  const visibility = getDesktopHost()?.visualizerWindow;
  return useSyncExternalStore(
    visibility?.subscribe ?? noSubscription,
    visibility?.getSnapshot ?? hidden,
    hidden,
  );
}
