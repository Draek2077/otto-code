/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { FENCE_HIGHLIGHT_DEBOUNCE_MS, useSettledFenceCode } from "./fence-highlight-debounce";

// Every distinct value the hook has handed downstream. One entry is one
// tokenization the highlighter would have run, which is the quantity F2 is
// about - not the number of renders.
let commits: string[] = [];

function Probe({ code }: { code: string }) {
  const settled = useSettledFenceCode(code);
  if (commits[commits.length - 1] !== settled) {
    commits.push(settled);
  }
  return <pre>{settled}</pre>;
}

describe("useSettledFenceCode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    commits = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(code: string) {
    act(() => root.render(<Probe code={code} />));
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("highlights already-settled content on the first paint", () => {
    render("const answer = 42;");

    expect(container.textContent).toBe("const answer = 42;");
    expect(commits).toEqual(["const answer = 42;"]);
  });

  it("holds growth back until the window closes, then commits the latest", () => {
    render("const a");
    render("const ab");
    advance(100);
    render("const abc");

    expect(container.textContent).toBe("const a");

    advance(FENCE_HIGHLIGHT_DEBOUNCE_MS);

    expect(container.textContent).toBe("const abc");
    expect(commits).toEqual(["const a", "const abc"]);
  });

  it("keeps growing while the fence streams instead of freezing until it stops", () => {
    // The regression this guards: a plain debounce restarts its timer on every
    // delta, so a fence that streams for a second would show nothing but its
    // first paint for that whole second.
    render("");
    for (let tick = 1; tick <= 30; tick += 1) {
      render("x".repeat(tick));
      advance(32);
    }

    expect(commits.length).toBeGreaterThan(2);
    expect(commits.length).toBeLessThan(10);
  });

  it("commits the final content within one window of the stream ending", () => {
    render("a");
    render("ab");
    advance(FENCE_HIGHLIGHT_DEBOUNCE_MS);
    render("abc");

    advance(FENCE_HIGHLIGHT_DEBOUNCE_MS);

    expect(container.textContent).toBe("abc");
    expect(commits[commits.length - 1]).toBe("abc");

    // Nothing further is pending once the fence has settled.
    advance(FENCE_HIGHLIGHT_DEBOUNCE_MS * 4);
    expect(commits[commits.length - 1]).toBe("abc");
  });

  it("swaps content that is not an append immediately", () => {
    render("const a");
    render("SELECT 1");

    expect(container.textContent).toBe("SELECT 1");
    expect(commits).toEqual(["const a", "SELECT 1"]);
  });

  it("does not strand a pending commit after a swap cancels it", () => {
    render("const a");
    render("const ab");
    advance(100);
    render("SELECT 1");

    expect(container.textContent).toBe("SELECT 1");

    render("SELECT 1 FROM t");
    advance(FENCE_HIGHLIGHT_DEBOUNCE_MS);

    expect(container.textContent).toBe("SELECT 1 FROM t");
  });
});
