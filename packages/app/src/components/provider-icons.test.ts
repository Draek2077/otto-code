import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ICON_SIZE } from "@/styles/theme";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { getProviderIcon, getProviderIconSvg, PROVIDER_BRAIN_VIEW_BOX } from "./provider-icons";
import { MATERIAL_SYMBOL_SVGS } from "@/assets/material-symbol-icons";

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

// The composer's model chip hands its leading icon a STRING size token
// (`size="md"`), and every provider mark that flows through `getProviderIcon`
// must accept one. A token that reaches the raw `<svg width=... height=...>`
// attributes is an invalid size the browser silently drops - the SVG then
// renders at its default (viewport) size, which is the giant brain mark the
// chip showed. These tests render the component as a plain function, the same
// way `icon-size.test.tsx` does, so they pin the wrapper contract without a DOM.

function invoke(icon: ReturnType<typeof getProviderIcon>, props: { size?: number | string }) {
  return (icon as unknown as (p: { size?: number | string }) => ReactElement)(props);
}

function sizePropOf(element: ReactElement): { size?: unknown; uniProps?: unknown } {
  return element.props as { size?: unknown; uniProps?: unknown };
}

function resolvesToPixels(element: ReactElement, expected: number) {
  const { size, uniProps } = sizePropOf(element);
  if (uniProps) {
    // Token path: the mapping must exist and resolve to a number for a real theme.
    expect(typeof uniProps).toBe("function");
    expect(
      (uniProps as (t: { iconSize: Record<string, number> }) => { size: number })({
        iconSize: ICON_SIZE,
      }),
    ).toEqual({
      size: expected,
    });
  } else {
    // Numeric path: a number goes straight to the SVG, unscaled.
    expect(size).toBe(expected);
  }
}

describe("provider icon size tokens", () => {
  it("brain mark: a token resolves to pixels, never a string width", () => {
    resolvesToPixels(invoke(getProviderIcon("otto-brain"), { size: "md" }), ICON_SIZE.md);
    // And a number keeps its exact pixels, so the chip's neighboring
    // numeric-sized call sites are untouched.
    resolvesToPixels(invoke(getProviderIcon("otto-brain"), { size: 20 }), 20);
  });

  it("every catalog mark with its own SVG resolves tokens the same way", () => {
    for (const entry of ACP_PROVIDER_CATALOG) {
      if (!entry.iconSvg) continue;
      const element = invoke(getProviderIcon(entry.id), { size: "md" });
      const { size, uniProps } = sizePropOf(element);
      if (uniProps !== undefined) {
        expect(
          (uniProps as (t: { iconSize: Record<string, number> }) => { size: number })({
            iconSize: ICON_SIZE,
          }),
        ).toEqual({ size: ICON_SIZE.md });
      } else {
        // A numeric `size` on the element means it went straight to the SVG
        // unwrapped - the exact defect the brain mark had.
        expect(typeof size).toBe("number");
      }
    }
  });
});
