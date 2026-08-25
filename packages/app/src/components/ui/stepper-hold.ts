import { useCallback, useEffect, useRef } from "react";

/**
 * The press-and-hold behaviour every +/- stepper in the app shares.
 *
 * A single tap steps once. Holding a button dwells briefly (so a slightly-long
 * press is still one step), then auto-repeats on a fixed cadence with an
 * exponentially growing step size - starting at 1 so you keep fine control,
 * ramping up to the cap so you can cover the whole range in a couple of
 * seconds. Repeats stop the instant a bound is hit.
 */
export const HOLD_START_DELAY_MS = 350;
export const REPEAT_INTERVAL_MS = 60;
export const RAMP_DURATION_MS = 1600;
export const DEFAULT_STEP_CAP = 200;

/** How many auto-repeat ticks a full-range sweep should take at top speed. */
const TICKS_TO_CROSS_RANGE = 40;

/**
 * stepForHeldTime maps how long the auto-repeat has been running to a step
 * multiplier. `cap ** progress` is 1 at progress 0 and `cap` at progress 1,
 * with a smooth exponential curve between - the "starts slow, accelerates" feel.
 */
export function stepForHeldTime(repeatingMs: number, cap: number = DEFAULT_STEP_CAP): number {
  const progress = Math.min(1, Math.max(0, repeatingMs / RAMP_DURATION_MS));
  return Math.max(1, Math.round(Math.max(1, cap) ** progress));
}

/**
 * The multiplier ceiling for a field whose increment is `step` rather than 1.
 *
 * Acceleration has to be relative to the range, not absolute: 200x on a
 * temperature that moves in 0.05 steps would jump the whole 0-2 range in a
 * single tick. Sizing the cap so a held button crosses the range in about
 * TICKS_TO_CROSS_RANGE ticks gives a short range no acceleration at all (cap 1)
 * and a 999-layer range enough to be usable.
 */
export function stepCapForRange(min: number, max: number, step: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || step <= 0) {
    return DEFAULT_STEP_CAP;
  }
  const increments = (max - min) / step;
  return Math.min(DEFAULT_STEP_CAP, Math.max(1, Math.round(increments / TICKS_TO_CROSS_RANGE)));
}

export interface StepperHold {
  /** Steps once immediately, then begins the accelerating repeat. */
  startHold: (direction: 1 | -1) => void;
  /** Ends the repeat. Safe to call when no hold is running. */
  stopHold: () => void;
}

/**
 * `applyStep` performs one step of `magnitude` in `direction` and returns
 * whether the value actually moved - false at a bound, which stops the repeat.
 */
export function useStepperHold(
  applyStep: (direction: 1 | -1, magnitude: number) => boolean,
  stepCap: number = DEFAULT_STEP_CAP,
): StepperHold {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatStartRef = useRef(0);

  const stopHold = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startHold = useCallback(
    (direction: 1 | -1) => {
      stopHold();
      // Immediate single step: a plain tap changes the value by exactly one step.
      if (!applyStep(direction, 1)) {
        return;
      }
      const beginRepeat = () => {
        repeatStartRef.current = Date.now();
        const tick = () => {
          const magnitude = stepForHeldTime(Date.now() - repeatStartRef.current, stepCap);
          if (!applyStep(direction, magnitude)) {
            stopHold();
            return;
          }
          timerRef.current = setTimeout(tick, REPEAT_INTERVAL_MS);
        };
        tick();
      };
      timerRef.current = setTimeout(beginRepeat, HOLD_START_DELAY_MS);
    },
    [applyStep, stepCap, stopHold],
  );

  useEffect(() => stopHold, [stopHold]);

  return { startHold, stopHold };
}
