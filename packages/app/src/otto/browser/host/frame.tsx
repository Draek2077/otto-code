import { useCallback, useMemo, useRef, useState } from "react";
import { Image, View, type LayoutChangeEvent, type GestureResponderEvent } from "react-native";
import { Buffer } from "buffer";
import type { HostFrameProps } from "./frame-types";
import { hostPagePoint, hostTouchPhase } from "./geometry";
const fill = { flex: 1 };
const yes = () => true;
export function HostBrowserFrame({ frame, displayed, failed, input, focus }: HostFrameProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const contacts = useRef(new Map<string, number>());
  const source = useMemo(
    () => ({ uri: `data:image/jpeg;base64,${Buffer.from(frame.jpeg).toString("base64")}` }),
    [frame],
  );
  const layout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }, []);
  const touches = useCallback(
    (event: GestureResponderEvent) => {
      const wasActive = contacts.current.size > 0;
      const rows = event.nativeEvent.touches.slice(0, 10),
        points: Array<{ id: number; x: number; y: number }> = [];
      const current = new Set(rows.map((row) => row.identifier));
      for (const identifier of contacts.current.keys())
        if (!current.has(identifier)) contacts.current.delete(identifier);
      let added = false;
      for (const touch of rows) {
        const position = hostPagePoint({
          ...size,
          x: touch.locationX,
          y: touch.locationY,
          viewportWidth: frame.viewportWidth,
          viewportHeight: frame.viewportHeight,
          clamp: contacts.current.has(touch.identifier),
        });
        if (!position) continue;
        let id = contacts.current.get(touch.identifier);
        if (id === undefined) {
          const used = new Set(contacts.current.values());
          id = Array.from({ length: 10 }, (_value, index) => index).find(
            (index) => !used.has(index),
          );
          if (id === undefined) continue;
          contacts.current.set(touch.identifier, id);
          added = true;
        }
        points.push({ id, ...position });
      }
      focus();
      if (points.length || wasActive)
        input({ kind: "touch", phase: hostTouchPhase(points.length, added), points });
    },
    [focus, frame.viewportHeight, frame.viewportWidth, input, size],
  );
  const cancel = useCallback(() => {
    if (!contacts.current.size) return;
    contacts.current.clear();
    input({ kind: "touch", phase: "cancel", points: [] });
  }, [input]);
  const loaded = useCallback(() => displayed(frame.sequence), [displayed, frame.sequence]);
  const broken = useCallback(() => failed(frame.sequence), [failed, frame.sequence]);
  return (
    <View
      style={fill}
      onLayout={layout}
      onStartShouldSetResponder={yes}
      onMoveShouldSetResponder={yes}
      onTouchStart={touches}
      onTouchMove={touches}
      onTouchEnd={touches}
      onResponderTerminate={cancel}
    >
      <View style={fill} pointerEvents="none">
        <Image
          source={source}
          style={fill}
          resizeMode="contain"
          onLoad={loaded}
          onError={broken}
          accessibilityLabel="Host browser page"
        />
      </View>
    </View>
  );
}
