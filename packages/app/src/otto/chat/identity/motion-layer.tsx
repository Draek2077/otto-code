import { useLayoutEffect, useState, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { motionFrame, type MotionKind } from "./motion";

export interface MotionLayerProps {
  kind: MotionKind;
  active: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}
const clock = makeMutable(0);
const consumers = makeMutable(0);
const running = makeMutable(false);
let nextListener = 0;
function tick() {
  "worklet";
  if (consumers.value === 0) {
    running.value = false;
    return;
  }
  clock.value = Date.now();
  requestAnimationFrame(tick);
}
function attach(local: SharedValue<number>, attached: SharedValue<boolean>, id: number) {
  "worklet";
  if (attached.value) return;
  attached.value = true;
  local.value = Date.now();
  clock.addListener(id, (time) => {
    local.value = time;
  });
  consumers.value++;
  if (!running.value) {
    running.value = true;
    requestAnimationFrame(tick);
  }
}
function detach(attached: SharedValue<boolean>, id: number) {
  "worklet";
  if (!attached.value) return;
  attached.value = false;
  clock.removeListener(id);
  consumers.value--;
}
/** One native UI clock; retained hidden layers detach their local animated values. */
export function MotionLayer({ kind, active, children, style }: MotionLayerProps) {
  const local = useSharedValue(0);
  const attached = useSharedValue(false);
  const [id] = useState(() => ++nextListener);
  useLayoutEffect(() => {
    if (!active) return;
    scheduleOnUI(attach, local, attached, id);
    return () => scheduleOnUI(detach, attached, id);
  }, [active, local, attached, id]);
  const animatedStyle = useAnimatedStyle(() => {
    const frame = motionFrame(kind, local.value);
    if (!active && kind === "halo") return { opacity: 1, transform: [{ scale: 1 }] };
    return {
      opacity: frame.opacity,
      transform: [
        { rotate: `${frame.rotate}deg` },
        { scaleX: frame.scaleX },
        { scaleY: frame.scaleY },
      ],
    };
  });
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
