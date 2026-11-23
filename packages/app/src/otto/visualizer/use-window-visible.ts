import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
/** Native compact sidebars own the full modal presentation. Retain the PIP
 * anchor while releasing its guest until the ordinary chat surface returns. */
export function useVisualizerWindowVisible() {
  const visible = useAppVisible(),
    compact = useIsCompactFormFactor();
  const panel = usePanelStore((state) => state.mobilePanel.target);
  return visible && (!compact || panel === "agent");
}
