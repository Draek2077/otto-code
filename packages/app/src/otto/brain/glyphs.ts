import { BRAIN_SYMBOL_SVGS } from "./artwork";
import type { BrainBadge, BrainGlyph } from "./state";

const GLYPH_SVGS: Record<BrainGlyph, string> = {
  brain: BRAIN_SYMBOL_SVGS.Brain,
  error: BRAIN_SYMBOL_SVGS.BrainError,
  download: BRAIN_SYMBOL_SVGS.BrainDownload,
  scan: BRAIN_SYMBOL_SVGS.BrainScan,
  benchmark: BRAIN_SYMBOL_SVGS.BrainBenchmark,
};

// Frozen geometry: center 729.5,705.5; transparent gap radius 275;
// the 456-unit badge box inks the family's 380-unit disc in a 960 viewBox.
// The artwork and animated mask deliberately share this same builder.

/** Centre of the badge, as a fraction of the icon box. */
export const BRAIN_BADGE_CENTER_X = 729.5 / 960;
export const BRAIN_BADGE_CENTER_Y = 705.5 / 960;
/** The family's badge disc: 380 of 960. Measured, do not hand-edit. */
const FAMILY_BADGE_DIAMETER = 380 / 960;
/**
 * Material glyphs ink 800 of their 960 box, so a mark drawn in a box D wide only
 * shows D * this. Dividing it back out is what makes our marks measure the same
 * as the family's disc rather than coming out a sixth too small.
 */
const MARK_INK_RATIO = 800 / 960;
/** The box to draw the mark in, so its ink matches `FAMILY_BADGE_DIAMETER`. */
export const BRAIN_BADGE_SIZE = FAMILY_BADGE_DIAMETER / MARK_INK_RATIO;
/** Radius of the gap bitten out for the mark. Tuned by eye; see above. */
const GAP_RADIUS = 275;
const VIEW_BOX = "0 -960 960 960";

/**
 * The brain artwork for a state: the glyph, with a round gap bitten out of it
 * when a mark has to sit there.
 *
 * A real transparent gap, not a disc filled with the surface colour. The rail
 * button has a hover fill behind it, and a painted disc would seam against it
 * the moment the pointer landed.
 *
 * One builder for both uses. The animated states mask a moving gradient with
 * this exact shape and the still ones draw it directly, so deriving them
 * separately is how the gap ends up in one and not the other.
 */
export function brainArtworkSvg(glyph: BrainGlyph, badge: BrainBadge | null): string {
  const svg = GLYPH_SVGS[glyph];
  if (!badge) {
    return svg;
  }
  const cx = BRAIN_BADGE_CENTER_X * 960;
  const cy = BRAIN_BADGE_CENTER_Y * 960 - 960;
  // The id is per-badge rather than per-instance. Two of the same icon on screen
  // means two identical definitions under one id, which resolves to the same
  // mask either way; a unique id per render would defeat memoisation for nothing.
  const maskId = `brain-gap-${badge}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="48" height="48" viewBox="${VIEW_BOX}"><defs><mask id="${maskId}"><rect x="0" y="-960" width="960" height="960" fill="#ffffff"/><circle cx="${cx}" cy="${cy}" r="${GAP_RADIUS}" fill="#000000"/></mask></defs><g mask="url(#${maskId})">${innerMarkup(svg)}</g></svg>`;
}

/**
 * The same artwork as a mask.
 *
 * `currentColor` is stripped out: a mask has no inherited colour to resolve
 * against (on web it is a detached `mask-image` resource, on native it is
 * composited by alpha), and a glyph that resolves to transparent masks
 * everything away - which looks exactly like the animation failing to start.
 *
 * The mask covers the brain only. The mark is drawn on top and stays still: a
 * gradient travelling through an 11px reticle would read as flicker.
 */
export function brainMaskSvg(glyph: BrainGlyph, badge: BrainBadge | null): string {
  return brainArtworkSvg(glyph, badge).replace(/currentColor/g, "#000000");
}

function innerMarkup(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}
