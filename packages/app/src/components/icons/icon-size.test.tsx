import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ICON_SIZE } from "@/styles/theme";
import { withIconSizeToken, type IconSizeProp } from "./icon-size";

interface GlyphProps {
  size?: IconSizeProp;
  color?: string;
}

function Glyph(_: { size: number; color?: string }) {
  return null;
}

const TokenGlyph = withIconSizeToken(Glyph, "TokenGlyph");

/** Render the wrapper as a plain function so its output element can be inspected. */
function render(props: GlyphProps): ReactElement {
  return (TokenGlyph as unknown as (p: GlyphProps) => ReactElement)(props);
}

type UniProps = (theme: { iconSize: Record<string, number> }) => { size: number };

function propsOf(element: ReactElement): { size?: unknown; uniProps?: UniProps; color?: string } {
  return element.props as { size?: unknown; uniProps?: UniProps; color?: string };
}

// The theme `applyAppearance` would have installed on a phone: every base token
// doubled, the chrome ladder up by half.
const COMPACT_THEME = {
  iconSize: {
    xs: 24,
    sm: 28,
    md: 32,
    lg: 40,
    chromeSm: 21,
    chromeMd: 24,
    chromeLg: 30,
  },
};

describe("withIconSizeToken", () => {
  it("draws a numeric size exactly as asked", () => {
    expect(propsOf(render({ size: 96, color: "red" })).size).toBe(96);
  });

  // The property the whole migration rests on: a call site that has not been moved to
  // a token yet keeps its current pixels, so no glyph can end up scaled twice while
  // the codemod is half-applied.
  it("never scales a numeric size, on any form factor", () => {
    const element = render({ size: 14, color: "red" });
    expect(propsOf(element).size).toBe(14);
    expect(propsOf(element).uniProps).toBeUndefined();
  });

  it("resolves a token through the live theme rather than a captured number", () => {
    const uniProps = propsOf(render({ size: "md", color: "red" })).uniProps;
    expect(uniProps).toBeDefined();
    expect(uniProps?.(COMPACT_THEME)).toEqual({ size: 32 });
    expect(uniProps?.({ iconSize: ICON_SIZE })).toEqual({ size: ICON_SIZE.md });
  });

  // Title-bar glyphs grow by half, not double: their row height is fixed by the
  // window chrome, so a doubled glyph overruns the bar instead of filling it.
  it("resolves a chrome token off the chrome ladder", () => {
    const uniProps = propsOf(render({ size: "chromeLg", color: "red" })).uniProps;
    expect(uniProps?.(COMPACT_THEME)).toEqual({ size: 30 });
    expect(uniProps?.({ iconSize: ICON_SIZE })).toEqual({ size: ICON_SIZE.lg });
  });

  it("defaults to md so a bare icon is the app's ordinary icon", () => {
    const uniProps = propsOf(render({ color: "red" })).uniProps;
    expect(uniProps?.(COMPACT_THEME)).toEqual({ size: 32 });
  });

  it("reuses one mapping per token rather than allocating per render", () => {
    expect(propsOf(render({ size: "sm", color: "red" })).uniProps).toBe(
      propsOf(render({ size: "sm", color: "blue" })).uniProps,
    );
  });

  it("passes every other prop through untouched", () => {
    expect(propsOf(render({ size: "lg", color: "rebeccapurple" })).color).toBe("rebeccapurple");
  });
});
