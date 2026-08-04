import type { InlineImageDimensions } from "./inline-image-size";

const SVG_TAG = /<svg\b[^>]*>/i;
const WIDTH_ATTRIBUTE = /\bwidth\s*=\s*["']?([0-9.]+)\s*(?:px)?["']?/i;
const HEIGHT_ATTRIBUTE = /\bheight\s*=\s*["']?([0-9.]+)\s*(?:px)?["']?/i;
const VIEW_BOX_ATTRIBUTE = /\bviewBox\s*=\s*["']([^"']+)["']/i;

/**
 * An SVG's intrinsic size, from its `width`/`height` attributes or its
 * `viewBox`.
 *
 * `Image.getSize` answers this for every other format, but native renders SVG
 * through `SvgXml` rather than `Image` - so without this an inline SVG has no
 * dimensions to lay out against and falls back to a 16px square. Percentage and
 * unit-bearing sizes (`100%`, `2em`) are deliberately not matched: they are
 * relative to a viewport this document does not have, and the `viewBox` behind
 * them is the better answer anyway.
 */
export function parseSvgIntrinsicSize(xml: string): InlineImageDimensions | null {
  const openTag = xml.match(SVG_TAG)?.[0];
  if (!openTag) {
    return null;
  }

  const width = Number(openTag.match(WIDTH_ATTRIBUTE)?.[1]);
  const height = Number(openTag.match(HEIGHT_ATTRIBUTE)?.[1]);
  if (isPositive(width) && isPositive(height)) {
    return { width, height };
  }

  const viewBox = openTag
    .match(VIEW_BOX_ATTRIBUTE)?.[1]
    ?.trim()
    .split(/[\s,]+/);
  if (viewBox?.length === 4) {
    const boxWidth = Number(viewBox[2]);
    const boxHeight = Number(viewBox[3]);
    if (isPositive(boxWidth) && isPositive(boxHeight)) {
      return { width: boxWidth, height: boxHeight };
    }
  }

  return null;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
