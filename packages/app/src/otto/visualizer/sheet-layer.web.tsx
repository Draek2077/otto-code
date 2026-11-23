import { Fragment, useMemo, type ComponentType, type PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { createPortal } from "react-dom";
import { getOverlayRoot, OverlayLayerProvider, useOverlayLayer } from "@/lib/overlay-root";
import { useVisualizerScopedSheets } from "./sheet-scope";

const style = StyleSheet.absoluteFillObject;
function VisualizerRootSheetLayer({ children }: PropsWithChildren) {
  const layer = useOverlayLayer("modal");
  const containerStyle = useMemo(() => [style, { zIndex: layer }], [layer]);
  return createPortal(
    <OverlayLayerProvider layer={layer}>
      {/* React Native box-none restores child hit testing beneath overlay-root's
          pointer-events:none. A plain HTML parent makes the backdrop button
          inherit none while Gorhom's animated visual backdrop remains hittable. */}
      <View style={containerStyle} pointerEvents="box-none">
        {children}
      </View>
    </OverlayLayerProvider>,
    getOverlayRoot(),
  );
}
/** Gorhom still owns its stack, gestures, sizing and dismissal. Only root web
 * presentation joins the same plane as PIP, transient sidebars and web dialogs. */
export function useVisualizerSheetLayer(): ComponentType<PropsWithChildren> {
  return useVisualizerScopedSheets() ? Fragment : VisualizerRootSheetLayer;
}
