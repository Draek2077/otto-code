import { useMemo, useRef, useState } from "react";
import { PanResponder, View, useWindowDimensions } from "react-native";
import { resolveVisualizerAnchor, visualizerAnchor, visualizerPipSize } from "./geometry";
import type { VisualizerPipFrameProps } from "./pip-types";
const handleStyle = { height: 12, backgroundColor: "#80808050" };
export function VisualizerPipFrame({
  preferences,
  save,
  children,
  shown,
}: VisualizerPipFrameProps) {
  const viewport = useWindowDimensions(),
    size = visualizerPipSize(preferences.visualizerPipSize, viewport);
  const [anchor, setAnchor] = useState(() =>
    visualizerAnchor(
      {
        x: preferences.visualizerPipX * Math.max(0, viewport.width - size.width),
        y: preferences.visualizerPipY * Math.max(0, viewport.height - size.height),
      },
      viewport,
      size,
    ),
  );
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const position = resolveVisualizerAnchor(anchor, viewport, size);
  const live = useRef({ position, viewport, size, save });
  live.current = { position, viewport, size, save };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_event, gesture) => setOffset({ x: gesture.dx, y: gesture.dy }),
        onPanResponderRelease: (_event, gesture) => {
          const value = live.current,
            at = { x: value.position.x + gesture.dx, y: value.position.y + gesture.dy };
          const next = visualizerAnchor(at, value.viewport, value.size);
          const placed = resolveVisualizerAnchor(next, value.viewport, value.size);
          setAnchor(next);
          setOffset({ x: 0, y: 0 });
          value.save({
            visualizerPipX: placed.x / Math.max(1, value.viewport.width - value.size.width),
            visualizerPipY: placed.y / Math.max(1, value.viewport.height - value.size.height),
          });
        },
        onPanResponderTerminate: () => setOffset({ x: 0, y: 0 }),
      }),
    [],
  );
  const style = useMemo(
    () => ({
      position: "absolute" as const,
      left: position.x + offset.x,
      top: position.y + offset.y,
      width: size.width,
      height: size.height,
      zIndex: 10,
      overflow: "hidden" as const,
      borderRadius: 8,
      display: shown ? ("flex" as const) : ("none" as const),
    }),
    [position, offset, size, shown],
  );
  return (
    <View style={style} testID="visualizer-window-pip">
      <View {...responder.panHandlers} style={handleStyle} accessibilityLabel="Move Visualizer" />
      {children}
    </View>
  );
}
