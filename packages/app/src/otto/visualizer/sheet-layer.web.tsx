import {
  Fragment,
  useMemo,
  type ComponentType,
  type CSSProperties,
  type PropsWithChildren,
} from "react";
import { createPortal } from "react-dom";
import { getOverlayRoot, OverlayLayerProvider, useOverlayLayer } from "@/lib/overlay-root";
import { useVisualizerScopedSheets } from "./sheet-scope";

const style: CSSProperties = { position: "fixed", inset: 0, pointerEvents: "none" };
function VisualizerRootSheetLayer({ children }: PropsWithChildren) {
  const layer = useOverlayLayer("modal");
  const containerStyle = useMemo(() => ({ ...style, zIndex: layer }), [layer]);
  return createPortal(
    <OverlayLayerProvider layer={layer}>
      <div style={containerStyle}>{children}</div>
    </OverlayLayerProvider>,
    getOverlayRoot(),
  );
}
/** Gorhom still owns its stack, gestures, sizing and dismissal. Only root web
 * presentation joins the same plane as PIP, transient sidebars and web dialogs. */
export function useVisualizerSheetLayer(): ComponentType<PropsWithChildren> {
  return useVisualizerScopedSheets() ? Fragment : VisualizerRootSheetLayer;
}
