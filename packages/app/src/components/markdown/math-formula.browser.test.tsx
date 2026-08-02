import { afterEach, describe, expect, it } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MathFormula } from "./math-formula";

// KaTeX against a real browser. The parse half is covered by math.test.ts; what
// only a browser can show is that the MathML actually lands in the document and
// that a malformed formula falls back to its source instead of throwing through
// the surrounding render.

const mounted: Array<{ root: Root; host: HTMLElement }> = [];

function render(element: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  mounted.push({ root, host });
  return host;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    act(() => entry?.root.unmount());
    entry?.host.remove();
  }
});

const STYLE = { color: "#e6e6e6", fontSize: 14 };

describe("MathFormula on web", () => {
  it("emits MathML the browser can lay out", () => {
    const host = render(<MathFormula tex="x^2" display={false} style={STYLE} />);
    const math = host.querySelector("math");
    expect(math).not.toBeNull();
    // The exponent survived as real structure, not as text.
    expect(host.querySelector("msup")).not.toBeNull();
    expect(host.textContent).toContain("x");
  });

  // No stylesheet is shipped, so anything that needed CSS to be legible would
  // render as a pile of unpositioned spans.
  it("needs no KaTeX stylesheet", () => {
    const host = render(<MathFormula tex="\frac{a}{b}" display style={STYLE} />);
    expect(host.querySelector(".katex-html")).toBeNull();
    expect(host.querySelector("mfrac")).not.toBeNull();
  });

  it("marks display math as a block", () => {
    const host = render(<MathFormula tex="a=b" display style={STYLE} />);
    expect(host.querySelector("math")?.getAttribute("display")).toBe("block");
  });

  it("leaves inline math inline", () => {
    const host = render(<MathFormula tex="a=b" display={false} style={STYLE} />);
    expect(host.querySelector("math")?.getAttribute("display")).not.toBe("block");
  });

  // A typo in someone else's README must not take the page down with it.
  it("falls back to the source when the TeX does not parse", () => {
    const host = render(<MathFormula tex="\frac{" display={false} style={STYLE} />);
    expect(host.querySelector("math")).toBeNull();
    expect(host.textContent).toBe("\\frac{");
  });
});
