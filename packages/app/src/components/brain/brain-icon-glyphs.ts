import { BrainCalibrate, BrainSweep, type IconComponent } from "@/components/icons/material-icons";
import { MATERIAL_SYMBOL_SVGS } from "@/assets/material-symbol-icons";
import type { BrainBadge, BrainGlyph } from "@/components/brain/brain-state";

/**
 * The mark that sits in the gap. Both are round and filled, which is why they
 * drop into a circular bite cleanly and read at rail size where an outline
 * would turn to mud.
 */
export const BRAIN_BADGE_COMPONENTS: Record<BrainBadge, IconComponent> = {
  calibrate: BrainCalibrate,
  sweep: BrainSweep,
};

/**
 * The artwork for each glyph the rail can draw.
 *
 * ## Adding a glyph for a state
 *
 * 1. `packages/app/scripts/material-symbols-map.json` - add `"BrainX": "<the
 *    material symbol name>"`, suffixing `-fill` for the filled weight, then run
 *    `node packages/app/scripts/generate-material-symbols.mjs` and
 *    `npm run format:files -- packages/app/src/assets/material-symbol-icons.ts`.
 * 2. `components/icons/material-icons.ts` - export it.
 * 3. `GLYPH_SVGS` below (a whole-glyph swap) or `BRAIN_BADGE_COMPONENTS` above
 *    (a mark in the gap).
 * 4. `BrainGlyph` / `BrainBadge` in `brain-state.ts` and the state's row in
 *    `BRAIN_STATE_VISUALS`.
 */
const GLYPH_SVGS: Record<BrainGlyph, string> = {
  brain: MATERIAL_SYMBOL_SVGS.Brain,
  error: MATERIAL_SYMBOL_SVGS.BrainError,
  download: MATERIAL_SYMBOL_SVGS.BrainDownload,
  scan: MATERIAL_SYMBOL_SVGS.BrainScan,
  benchmark: MATERIAL_SYMBOL_SVGS.BrainBenchmark,
};

// --- Badge geometry ---------------------------------------------------------
//
// THE SPEC. Every value is in the glyphs' own 960-unit viewBox, so it is
// resolution-independent: the composite is identical at 26px on the rail and at
// 120px in a doc.
//
//   badge centre      729.5, 705.5
//   gap radius        275
//   badge disc        380 across  (drawn in a 456 box - see MARK_INK_RATIO)
//
// How these were arrived at, because the two halves have different authority:
//
//   * The X centre and the disc size are MEASURED off the family's own variants
//     and should not be changed by hand. Rasterising `network_intelligence_history`
//     and `_update` at 960px (one pixel per viewBox unit) and reading the badge's
//     connected component gives 729.5, 725.5 and a 380 disc, identical in both.
//     That is what makes a composed mark sit exactly where their clock and arrow
//     sit and measure exactly the same.
//   * The Y centre and the gap radius are TUNED BY EYE against them. The family
//     does not punch a circle: they pull the brain back with a shaped edge, so no
//     single radius reproduces it. Their boundary runs from 269 (closest the
//     brain comes to the badge) out to 299 (furthest the removed area reaches),
//     and 275 sits in that band. The badge also reads better 20 above the
//     measured centre, because our marks are solid discs where theirs are rings.
//
// To retune: change one value, run `node <temp>/glyphcheck/render.mjs`, and look
// at the preview it writes - it reads these constants straight out of this file,
// so it cannot drift from what ships. `brain-icon-geometry.test.ts` pins the
// values against accidental drift, not against deliberate change.

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
