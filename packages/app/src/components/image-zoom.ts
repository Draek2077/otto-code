import type { ImageDimensions } from "@/components/image-dimensions";

// The image viewer's zoom arithmetic, split out from the component for the same
// reason the overview ruler's geometry is: it is the part that is easy to get
// subtly wrong and impossible to eyeball, and it is worth unit tests that need
// no renderer.

/**
 * The zoom ladder the +/- buttons walk. Chosen so a step is always a visible
 * change and 100% is always reachable - a multiplicative step (×1.2) drifts
 * past 100% and leaves the user unable to land on it.
 */
export const ZOOM_STEPS: readonly number[] = [
  0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16,
];

export const MIN_ZOOM = ZOOM_STEPS[0] ?? 0.05;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 16;

/**
 * Slack for float comparisons against the ladder. A fit scale is an arbitrary
 * ratio, so "is this already 100%?" has to tolerate 0.9999999.
 */
const EPSILON = 1e-4;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * The scale that makes the whole image visible in `viewport`.
 *
 * Capped at 1: fitting *shrinks* an image too big for the pane and leaves a
 * small one alone. Blowing a 16×16 favicon up to fill a desktop pane is not
 * "fit", it is a decision the user did not ask for - and the zoom controls are
 * right there when they do want it.
 */
export function fitScale(
  image: ImageDimensions | null,
  viewport: { width: number; height: number },
): number {
  if (!image || image.width <= 0 || image.height <= 0) {
    return 1;
  }
  if (viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

/**
 * The next rung up (`direction: 1`) or down (`-1`) from wherever the current
 * scale sits - which is usually *between* rungs, because it started as a fit
 * ratio. Stepping from 0.67-ish must reach 1 rather than snapping back to 0.67,
 * so the comparison is strict and epsilon-guarded on both sides.
 */
export function nextZoomStep(scale: number, direction: 1 | -1): number {
  const current = clampZoom(scale);
  if (direction === 1) {
    const next = ZOOM_STEPS.find((step) => step > current + EPSILON);
    return next ?? MAX_ZOOM;
  }
  const previous = ZOOM_STEPS.toReversed().find((step) => step < current - EPSILON);
  return previous ?? MIN_ZOOM;
}

/** True when the scale is close enough to the ladder's end to disarm a button. */
export function isAtZoomLimit(scale: number, direction: 1 | -1): boolean {
  const current = clampZoom(scale);
  return direction === 1 ? current >= MAX_ZOOM - EPSILON : current <= MIN_ZOOM + EPSILON;
}

/**
 * The readout on the zoom control. Rounded to whole percent, floored at 1% so a
 * deeply zoomed-out image never reads "0%" - which looks like a failure rather
 * than a scale.
 */
export function formatZoomPercent(scale: number): string {
  return `${Math.max(1, Math.round(clampZoom(scale) * 100))}%`;
}

/** The image's on-screen box at a given scale, rounded to whole pixels. */
export function scaledSize(
  image: ImageDimensions,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}
