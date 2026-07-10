import { describe, expect, it } from "vitest";
import {
  contentFractionToLine,
  contentYFraction,
  createSplitSyncGate,
  lineToContentFraction,
  lineToTargetContentY,
  scrollFraction,
} from "./file-split-sync";

describe("scrollFraction", () => {
  it("maps the scrollable range to 0..1", () => {
    expect(scrollFraction({ scrollTop: 0, contentHeight: 1000, clientHeight: 200 })).toBe(0);
    expect(scrollFraction({ scrollTop: 400, contentHeight: 1000, clientHeight: 200 })).toBe(0.5);
    expect(scrollFraction({ scrollTop: 800, contentHeight: 1000, clientHeight: 200 })).toBe(1);
  });

  it("clamps overscroll and returns 0 when nothing scrolls", () => {
    expect(scrollFraction({ scrollTop: -50, contentHeight: 1000, clientHeight: 200 })).toBe(0);
    expect(scrollFraction({ scrollTop: 900, contentHeight: 1000, clientHeight: 200 })).toBe(1);
    expect(scrollFraction({ scrollTop: 100, contentHeight: 150, clientHeight: 200 })).toBe(0);
  });
});

describe("line/content fraction mapping", () => {
  it("round-trips lines through fractions", () => {
    expect(lineToContentFraction(1, 101)).toBe(0);
    expect(lineToContentFraction(51, 101)).toBe(0.5);
    expect(lineToContentFraction(101, 101)).toBe(1);
    expect(contentFractionToLine(0, 101)).toBe(1);
    expect(contentFractionToLine(0.5, 101)).toBe(51);
    expect(contentFractionToLine(1, 101)).toBe(101);
  });

  it("clamps out-of-range lines and fractions", () => {
    expect(lineToContentFraction(0, 10)).toBe(0);
    expect(lineToContentFraction(99, 10)).toBe(1);
    expect(contentFractionToLine(-1, 10)).toBe(1);
    expect(contentFractionToLine(2, 10)).toBe(10);
  });

  it("degenerates to line 1 / fraction 0 for single-line docs", () => {
    expect(lineToContentFraction(1, 1)).toBe(0);
    expect(contentFractionToLine(0.7, 1)).toBe(1);
  });
});

describe("contentYFraction", () => {
  it("maps a content Y into 0..1", () => {
    expect(contentYFraction(250, 1000)).toBe(0.25);
    expect(contentYFraction(-10, 1000)).toBe(0);
    expect(contentYFraction(2000, 1000)).toBe(1);
    expect(contentYFraction(10, 0)).toBe(0);
  });
});

describe("lineToTargetContentY", () => {
  it("lands on the proportional content position", () => {
    expect(lineToTargetContentY({ line: 51, lineCount: 101, targetContentHeight: 2000 })).toBe(
      1000,
    );
    expect(lineToTargetContentY({ line: 1, lineCount: 101, targetContentHeight: 2000 })).toBe(0);
  });
});

describe("createSplitSyncGate", () => {
  it("lets one side drive and blocks the other during the hold", () => {
    let at = 0;
    const gate = createSplitSyncGate({ holdMs: 100, now: () => at });
    expect(gate.claim("editor")).toBe(true);
    at = 50;
    expect(gate.claim("preview")).toBe(false);
    expect(gate.claim("editor")).toBe(true);
  });

  it("hands over the driver role after the hold expires", () => {
    let at = 0;
    const gate = createSplitSyncGate({ holdMs: 100, now: () => at });
    expect(gate.claim("editor")).toBe(true);
    at = 150;
    expect(gate.claim("preview")).toBe(true);
    at = 200;
    expect(gate.claim("editor")).toBe(false);
  });
});
