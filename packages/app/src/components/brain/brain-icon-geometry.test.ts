import { describe, expect, it } from "vitest";
import {
  BRAIN_BADGE_CENTER_X,
  BRAIN_BADGE_CENTER_Y,
  BRAIN_BADGE_SIZE,
  brainArtworkSvg,
  brainMaskSvg,
} from "@/components/brain/brain-icon-glyphs";
import { BRAIN_STATE_VISUALS } from "@/components/brain/brain-state";

/**
 * The badge geometry, pinned.
 *
 * This is not here to stop the numbers being changed - retuning by eye against
 * the family is the documented way to work on them. It is here so they cannot
 * change by ACCIDENT: a refactor of the mask builder, a stray edit, or someone
 * "simplifying" the ink-ratio division would all silently move the mark off the
 * spot it was tuned to, and nothing else in the suite would notice.
 *
 * The spec lives in the header of `brain-icon-glyphs.ts`.
 */
const UNIT = 960;

describe("badge geometry", () => {
  it("places the badge where the family places theirs", () => {
    expect(BRAIN_BADGE_CENTER_X * UNIT).toBeCloseTo(729.5, 4);
    expect(BRAIN_BADGE_CENTER_Y * UNIT).toBeCloseTo(705.5, 4);
  });

  it("draws the mark in a box whose ink matches the family's 380 disc", () => {
    // The box is deliberately larger than the disc: Material glyphs only ink 800
    // of their 960 box, so drawing at 380 would render 317 and read undersized.
    expect(BRAIN_BADGE_SIZE * UNIT).toBeCloseTo(456, 4);
    expect(BRAIN_BADGE_SIZE * UNIT * (800 / 960)).toBeCloseTo(380, 4);
  });

  it("bites the gap at the tuned radius, centred on the badge", () => {
    const svg = brainArtworkSvg("brain", "calibrate");
    const circle = /<circle cx="([\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/.exec(svg);
    expect(circle).not.toBeNull();
    const [, cx, cy, r] = circle!;
    expect(Number(cx)).toBeCloseTo(729.5, 4);
    // The viewBox runs from -960 to 0, so the y centre is measured up from the
    // bottom. Getting this sign wrong puts the gap off the top of the glyph.
    expect(Number(cy)).toBeCloseTo(705.5 - 960, 4);
    expect(Number(r)).toBe(275);
  });

  it("bites the gap only for the states that carry a mark", () => {
    expect(brainArtworkSvg("brain", null)).not.toContain("<circle");
    for (const badge of ["calibrate", "sweep"] as const) {
      expect(brainArtworkSvg("brain", badge)).toContain("<circle");
    }
  });

  it("keeps the drawn artwork and the animation mask the same shape", () => {
    // These are one builder on purpose. If they ever diverge, the sweep animates
    // a different silhouette than the still frame draws, and the gap appears or
    // vanishes the moment the state starts moving.
    for (const badge of [null, "calibrate", "sweep"] as const) {
      const drawn = brainArtworkSvg("brain", badge);
      const mask = brainMaskSvg("brain", badge);
      expect(mask).toBe(drawn.replace(/currentColor/g, "#000000"));
    }
  });

  it("never asks for a gap on a glyph that already carries its own mark", () => {
    // A variant glyph puts its clock or arrow exactly where the gap goes, so
    // biting a hole there would punch straight through it.
    for (const visual of Object.values(BRAIN_STATE_VISUALS)) {
      if (visual.badge !== null) {
        expect(visual.glyph).toBe("brain");
      }
    }
  });
});
