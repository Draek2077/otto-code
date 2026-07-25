// Geometry for the overview ruler — the annotation lane down the right edge.
//
// Split out from the extension so the one thing that is easy to get wrong (and
// impossible to eyeball) can be tested in plain Node: the mapping between a
// position in the document and a position on the track, in both directions.
//
// Everything here works in SCROLL coordinates, not line numbers. A mark's y is
// derived from the height CM6 assigns its line, which is what makes a mark line
// up with the viewport thumb even when lines have different heights — wrapped
// text, or a file where the height map is still estimating the part nobody has
// scrolled to. Mapping by line number instead would put marks where the line
// "should" be and leave them a screen away from where scrolling actually lands.

/**
 * Painted height of a mark. Three pixels is the smallest band that survives a
 * scaled-down 5000-line file and still reads as a mark rather than a hairline.
 */
export const RULER_MARK_HEIGHT_PX = 3;

/**
 * The thumb never shrinks below this, however long the file. A proportional
 * thumb on a 20000-line document is under a pixel tall — correct, and useless
 * as the "where am I" indicator that is half of what this lane is for.
 */
export const RULER_MIN_THUMB_PX = 24;

/**
 * Marks are collapsed into buckets this tall before any DOM is created, so a
 * file with 4000 problems produces one element per band rather than 4000
 * stacked in the same few pixels. Equal to the mark height: two marks that
 * would paint the same pixels are the same mark as far as the eye is concerned.
 */
export const RULER_BUCKET_PX = RULER_MARK_HEIGHT_PX;

export interface RulerMetrics {
  /** Height of the track element, px. */
  trackHeight: number;
  /** Scrollable content height, px — `scrollDOM.scrollHeight`. */
  scrollHeight: number;
  /** Visible height, px — `scrollDOM.clientHeight`. */
  clientHeight: number;
}

/**
 * Is there anything to scroll? A file shorter than the viewport still gets its
 * marks (a problem is worth seeing whether or not it is off-screen) but no
 * thumb — a thumb covering the whole track says nothing.
 */
export function isRulerScrollable(metrics: RulerMetrics): boolean {
  return metrics.scrollHeight - metrics.clientHeight > 1;
}

/** Track pixels per content pixel. Zero when there is nothing measured yet. */
export function rulerScale(metrics: RulerMetrics): number {
  if (metrics.scrollHeight <= 0 || metrics.trackHeight <= 0) {
    return 0;
  }
  return metrics.trackHeight / metrics.scrollHeight;
}

/**
 * Where a mark for content at `contentTop` (a `lineBlockAt().top`) paints.
 *
 * Clamped so the last line's mark stays inside the track instead of hanging off
 * the bottom edge, which is exactly where the marks you most want to click on a
 * long file end up.
 */
export function rulerMarkTop(contentTop: number, metrics: RulerMetrics): number {
  const scale = rulerScale(metrics);
  if (scale === 0) {
    return 0;
  }
  const top = contentTop * scale;
  return clamp(top, 0, Math.max(0, metrics.trackHeight - RULER_MARK_HEIGHT_PX));
}

export interface RulerBandRect {
  top: number;
  height: number;
}

/**
 * A mark with EXTENT — a selected range — scaled onto the track.
 *
 * Floored at the mark height, which is the whole reason this is not just two
 * `rulerMarkTop` calls: a three-line selection in a 5000-line file scales to a
 * fraction of a pixel, and "your selection is somewhere around here" is the one
 * thing the band exists to say. Kept inside the track at both ends, so a
 * selection running to the last line does not paint past the bottom edge.
 */
export function rulerBandRect(
  contentTop: number,
  contentBottom: number,
  metrics: RulerMetrics,
): RulerBandRect {
  const scale = rulerScale(metrics);
  if (scale === 0) {
    return { top: 0, height: 0 };
  }
  const top = clamp(contentTop * scale, 0, Math.max(0, metrics.trackHeight - RULER_MARK_HEIGHT_PX));
  const height = Math.max(RULER_MARK_HEIGHT_PX, contentBottom * scale - top);
  return { top, height: Math.min(height, metrics.trackHeight - top) };
}

export interface RulerThumbRect {
  top: number;
  height: number;
}

/**
 * The viewport indicator. Its height is the visible fraction, floored at
 * `RULER_MIN_THUMB_PX` — and once floored the travel has to be rescaled against
 * the shortened range, or the thumb runs past the bottom of the track before the
 * document reaches its end.
 */
export function rulerThumbRect(scrollTop: number, metrics: RulerMetrics): RulerThumbRect {
  const scale = rulerScale(metrics);
  if (scale === 0) {
    return { top: 0, height: 0 };
  }
  const height = clamp(metrics.clientHeight * scale, RULER_MIN_THUMB_PX, metrics.trackHeight);
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const travel = Math.max(0, metrics.trackHeight - height);
  const progress = maxScrollTop <= 0 ? 0 : clamp(scrollTop, 0, maxScrollTop) / maxScrollTop;
  return { top: progress * travel, height };
}

/**
 * Scroll offset that brings the clicked point of the track to the CENTRE of the
 * viewport.
 *
 * Centring, rather than putting it at the top: the gesture means "show me what
 * is there", and a mark landed exactly at the top edge is one where you cannot
 * see the line above it — which is usually the context that explains it.
 */
export function rulerScrollTopForTrackY(trackY: number, metrics: RulerMetrics): number {
  if (metrics.trackHeight <= 0) {
    return 0;
  }
  const fraction = clamp(trackY / metrics.trackHeight, 0, 1);
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  return clamp(fraction * metrics.scrollHeight - metrics.clientHeight / 2, 0, maxScrollTop);
}

/** Which collapse band a mark at `top` falls in. */
export function rulerBucket(top: number): number {
  return Math.floor(top / RULER_BUCKET_PX);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
