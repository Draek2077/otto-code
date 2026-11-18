import { useLayoutEffect, useRef } from "react";
import { View } from "react-native";
import { motionKeyframes } from "./motion";
import type { MotionLayerProps } from "./motion-layer";

/** Browser-timeline motion, without a JavaScript frame loop or per-instance timers. */
export function MotionLayer({ kind, active, children, style }: MotionLayerProps) {
  const ref = useRef<View>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !(element instanceof HTMLElement)) return;
    const { frames, timing } = motionKeyframes(kind);
    const animation = element.animate(frames, timing);
    animation.startTime = 0;
    return () => animation.cancel();
  }, [active, kind]);
  return (
    <View ref={ref} style={style}>
      {children}
    </View>
  );
}
