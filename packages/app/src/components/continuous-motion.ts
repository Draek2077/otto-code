// Frame budget for continuous (infinite) CSS animations when Chromium is
// compositing in software.
//
// Under software compositing every frame with any damage redraws the whole
// window on the CPU. One 18px spinner animating per vsync therefore costs a
// full-window draw at the display's refresh rate, and the cost grows with
// window area rather than with how many spinners there are: measured in
// Chromium with --disable-gpu at 2400x1350, no animation = 1 draw/s, one
// spinner = 120 draws/s (~300ms/s of compositor CPU), the same spinner with
// steps() at 8/s = 9 draws/s. On a slower Linux machine at 4K that per-frame
// draw reached ~60ms and pinned the whole app near 16 fps whenever an agent
// was running. Chromium only produces a frame when a stepped value changes, so
// stepping is what bounds the cost. With GPU compositing none of this applies
// and animations run at the display's full rate.

// Every step size is a whole fraction of 350ms, one segment of the plasma
// ring's 1400ms four-segment wobble, which also divides its 5600ms loop. So
// whatever rate is chosen, every layer of every ring (and the shimmer, whose
// duration is quantized onto the same grid) steps on one shared timeline grid
// and they all share each frame.
export const STEP_GRID_UNIT_MS = 350;

// Before a measurement exists: ~11.4 steps/s.
export const DEFAULT_SOFTWARE_STEP_MS = STEP_GRID_UNIT_MS / 4;

// Share of one CPU core that decorative motion may spend on software draws.
export const SOFTWARE_MOTION_CPU_BUDGET = 0.25;
// Slowest and fastest rates the budget may pick, in steps per second. The
// floor keeps a running indicator visibly alive on a very slow draw; the
// ceiling is where the motion stops reading any smoother.
const MIN_SOFTWARE_STEPS_PER_SECOND = 5;
const MAX_SOFTWARE_STEPS_PER_SECOND = 60;

/** The grid step closest to `stepsPerSecond`. */
export function stepMsForRate(stepsPerSecond: number): number {
  const stepsPerUnit = Math.max(1, Math.round((stepsPerSecond * STEP_GRID_UNIT_MS) / 1000));
  return STEP_GRID_UNIT_MS / stepsPerUnit;
}

/**
 * Picks the software step from a frame-interval probe. `idleFrameMs` is the
 * rAF interval with nothing animating (the display's refresh), `animatedFrameMs`
 * the interval while one tiny element animates every frame. When the animated
 * interval stays at the refresh, a full draw costs less than one refresh, so
 * the refresh interval is used as the cost's upper bound; otherwise the
 * animated interval is the draw cost. The rate is what fits the CPU budget,
 * never above the display's own refresh rate.
 */
export function chooseSoftwareStepMs(input: {
  idleFrameMs: number;
  animatedFrameMs: number;
}): number {
  const refreshMs = Math.max(1, input.idleFrameMs);
  const drawCostMs = input.animatedFrameMs > refreshMs * 1.25 ? input.animatedFrameMs : refreshMs;
  const affordable = (1000 * SOFTWARE_MOTION_CPU_BUDGET) / drawCostMs;
  const ceiling = Math.min(MAX_SOFTWARE_STEPS_PER_SECOND, 1000 / refreshMs);
  const rate = Math.min(ceiling, Math.max(MIN_SOFTWARE_STEPS_PER_SECOND, affordable));
  return stepMsForRate(rate);
}

/**
 * A `steps()` timing function that advances a continuous animation every
 * `stepMs`. CSS timing functions apply per keyframe segment, so pass the
 * number of segments the keyframes define.
 */
export function steppedTimingFunction(
  durationMs: number,
  segments: number,
  stepMs: number,
): string {
  const steps = Math.max(1, Math.round(durationMs / stepMs / segments));
  return `steps(${steps}, end)`;
}

/**
 * Rounds a duration to a whole number of steps, so an animation whose duration
 * is derived (e.g. from text length) still steps on the shared grid.
 */
export function quantizeToStepGrid(durationMs: number, stepMs: number): number {
  return Math.max(1, Math.round(durationMs / stepMs)) * stepMs;
}

/**
 * Pins every CSS animation under `root` to the document timeline's origin, so
 * all stepped instances step on the same instants and share one frame per
 * step. Each instance otherwise resolves its own start time a few ms after
 * its phase was computed, and every misaligned grid adds frames of its own
 * (measured: five rings stepped independently still drew 57 frames/s).
 * Animations must carry no delay of their own for the phase to stay shared.
 *
 * Aligns now and again on every `animationstart` inside `root`: an element
 * under `display: none` (a parked deck workspace, a hidden tab) has no CSS
 * animation until it is shown, so a one-shot pass at mount misses it.
 * Returns the cleanup.
 */
export function alignAnimationsToTimelineOrigin(root: unknown): () => void {
  if (typeof Element === "undefined" || !(root instanceof Element)) {
    return () => {};
  }
  const align = () => {
    for (const animation of root.getAnimations({ subtree: true })) {
      if (animation.startTime !== 0) {
        animation.startTime = 0;
      }
    }
  };
  align();
  root.addEventListener("animationstart", align);
  return () => root.removeEventListener("animationstart", align);
}
