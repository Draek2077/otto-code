import { useEffect, useMemo } from "react";
import {
  cancelAnimation,
  Easing,
  makeMutable,
  ReduceMotion,
  useAnimatedReaction,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useBrainMotionEnabled } from "./lifecycle";

interface SweepClock {
  progress: SharedValue<number>;
  consumers: number;
}

// The frozen visual table has a finite set of cadences. All mounted copies of
// one cadence share a ramp, while hidden copies disconnect their local values.
const clocks = new Map<number, SweepClock>();

function clockFor(durationMs: number): SweepClock {
  let clock = clocks.get(durationMs);
  if (!clock) {
    clock = { progress: makeMutable(0), consumers: 0 };
    clocks.set(durationMs, clock);
  }
  return clock;
}

export function useSweepProgress(active: boolean, durationMs: number): SharedValue<number> {
  const motionEnabled = useBrainMotionEnabled();
  const running = active && motionEnabled && durationMs > 0;
  const clock = useMemo(() => clockFor(durationMs), [durationMs]);
  const source = clock.progress;
  const progress = useSharedValue(0);
  useAnimatedReaction(
    () => (running ? source.value : 0),
    (value) => {
      progress.value = value;
    },
    [running, source, progress],
  );
  useEffect(() => {
    if (!running) return;
    clock.consumers += 1;
    if (clock.consumers === 1) {
      source.value = 0;
      source.value = withRepeat(
        withTiming(1, {
          duration: durationMs,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        false,
        undefined,
        ReduceMotion.Never,
      );
    }
    return () => {
      clock.consumers -= 1;
      if (clock.consumers === 0) {
        cancelAnimation(source);
        source.value = 0;
      }
    };
  }, [clock, durationMs, running, source]);
  return progress;
}
