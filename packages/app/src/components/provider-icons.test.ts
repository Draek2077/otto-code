import { describe, expect, it } from "vitest";
import { MATERIAL_SYMBOL_SVGS } from "@/assets/material-symbol-icons";
import { getProviderIconSvg, PROVIDER_BRAIN_VIEW_BOX } from "./provider-icons";

/**
 * The provider-sized brain, pinned to the glyph's ink.
 *
 * `PROVIDER_BRAIN_VIEW_BOX` is a measurement, not a taste call: it is the
 * bounding box of the Material brain path, cropped so the mark fills its box the
 * way the Claude and Codex marks fill theirs. If Material ever ships a redrawn
 * brain, the measurement goes stale silently and the icon starts rendering
 * clipped or off-centre - so recompute it here instead of trusting the constant.
 */

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

/**
 * Bounding box of an SVG path, measured off its on-curve points AND its Bezier
 * control points. A control point can sit outside the curve it steers, so this
 * is an over-estimate rather than a tight fit - which is the safe direction: a
 * viewBox derived from it never clips the ink.
 */
function pathBounds(d: string) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
  let index = 0;
  let command = "M";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const mark = (px: number, py: number) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  };

  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) {
      command = tokens[index];
      index += 1;
    }
    const absolute = command.toUpperCase();
    const relative = command !== absolute;
    const arity = ARG_COUNT[absolute];
    // Arcs would need their own sweep maths; the brain path has none, and a new
    // command showing up is exactly the kind of redraw this test exists to catch.
    expect(arity, `unsupported path command "${command}"`).toBeDefined();
    const args = tokens.slice(index, index + arity).map(Number);
    index += arity;

    if (absolute === "Z") {
      x = startX;
      y = startY;
    } else if (absolute === "H") {
      x = relative ? x + args[0] : args[0];
    } else if (absolute === "V") {
      y = relative ? y + args[0] : args[0];
    } else {
      for (let k = 0; k < args.length; k += 2) {
        const px = relative ? x + args[k] : args[k];
        const py = relative ? y + args[k + 1] : args[k + 1];
        mark(px, py);
        if (k + 2 >= args.length) {
          x = px;
          y = py;
        }
      }
    }
    mark(x, y);
    if (absolute === "M") {
      startX = x;
      startY = y;
    }
  }

  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function viewBoxOf(svg: string): string {
  return /viewBox="([^"]*)"/.exec(svg)?.[1] ?? "";
}

function pathDataOf(svg: string): string {
  return [...svg.matchAll(/ d="([^"]*)"/g)].map((match) => match[1]).join(" ");
}

describe("provider-sized brain icon", () => {
  it("crops the viewBox to the glyph's measured ink", () => {
    const { minX, minY, width, height } = pathBounds(pathDataOf(MATERIAL_SYMBOL_SVGS.Brain));
    expect(`${minX} ${minY} ${width} ${height}`).toBe(PROVIDER_BRAIN_VIEW_BOX);
  });

  it("leaves room to grow - the glyph does not already fill its box", () => {
    // The whole reason this variant exists. If a redraw makes the base glyph
    // full-bleed, the crop becomes a no-op and should be deleted, not kept.
    expect(viewBoxOf(MATERIAL_SYMBOL_SVGS.Brain)).toBe("0 -960 960 960");
  });

  it("changes nothing but the viewBox", () => {
    const provider = getProviderIconSvg("otto-brain");
    expect(viewBoxOf(provider)).toBe(PROVIDER_BRAIN_VIEW_BOX);
    expect(pathDataOf(provider)).toBe(pathDataOf(MATERIAL_SYMBOL_SVGS.Brain));
    expect(provider.replace(viewBoxOf(provider), viewBoxOf(MATERIAL_SYMBOL_SVGS.Brain))).toBe(
      MATERIAL_SYMBOL_SVGS.Brain,
    );
  });

  it("does not touch the shared Brain icon", () => {
    // Scoped on purpose: the rail, the Brain screen and the state machine all
    // draw the base glyph and stay optically aligned with the other Material
    // Symbols around them.
    expect(MATERIAL_SYMBOL_SVGS.Brain).not.toContain(PROVIDER_BRAIN_VIEW_BOX);
  });
});
