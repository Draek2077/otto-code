import { describe, expect, it } from "vitest";
import {
  computeWorkspaceTabLayout,
  computeWorkspaceTabRailWidth,
  retainWorkspaceTabMeasuredWidth,
} from "@/screens/workspace/workspace-tab-layout";

const metrics = {
  rowHorizontalInset: 0,
  actionsReservedWidth: 120,
  rowPaddingHorizontal: 8,
  tabGap: 4,
  minTabWidth: 96,
  maxTabWidth: 160,
};

describe("computeWorkspaceTabLayout", () => {
  it("grows every tab to the maximum width when the strip has ample space", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabCount: 3,
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
    expect(result.items.map((item) => item.width)).toEqual([160, 160, 160]);
  });

  it("clamps a single tab at the maximum width", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabCount: 1,
      metrics,
    });

    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([160]);
  });

  it("divides available space evenly without crossing the clickable minimum", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 460,
      tabCount: 3,
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([105, 105, 105]);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
  });

  it("caps long tabs at the maximum width", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1004,
      tabCount: 4,
      metrics: {
        ...metrics,
        actionsReservedWidth: 44,
        rowPaddingHorizontal: 0,
        tabGap: 0,
      },
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([160, 160, 160, 160]);
  });

  it("gives every tab more room as the available strip width grows", () => {
    const narrow = computeWorkspaceTabLayout({
      viewportWidth: 320,
      tabCount: 2,
      metrics,
    });
    const wide = computeWorkspaceTabLayout({
      viewportWidth: 440,
      tabCount: 2,
      metrics,
    });

    expect(narrow.items.map((item) => item.width)).toEqual([96, 96]);
    expect(wide.items.map((item) => item.width)).toEqual([150, 150]);
  });

  it("keeps every tab at the clickable minimum at the exact fit boundary", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 532,
      tabCount: 4,
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([96, 96, 96, 96]);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
  });

  it("uses horizontal scroll rather than shrinking below the clickable minimum", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 531,
      tabCount: 4,
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(true);
    expect(result.items.map((item) => item.width)).toEqual([96, 96, 96, 96]);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
  });

  it("returns empty layout details when there are no tabs", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabCount: 0,
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("gives every tab the same measured share", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 440,
      tabCount: 2,
      metrics,
    });

    expect(result.items.map((item) => item.width)).toEqual([150, 150]);
  });
});

describe("retainWorkspaceTabMeasuredWidth", () => {
  it("retains the last usable width while a retained panel is hidden", () => {
    expect(retainWorkspaceTabMeasuredWidth(720, 0)).toBe(720);
  });

  it("accepts the next usable layout width", () => {
    expect(retainWorkspaceTabMeasuredWidth(720, 640)).toBe(640);
  });
});

describe("computeWorkspaceTabRailWidth", () => {
  const railMetrics = {
    tabIconWidth: 14,
    tabHorizontalPadding: 12,
    estimatedCharWidth: 7,
    closeButtonWidth: 22,
    maxTabWidth: 200,
    minTabWidth: 120,
  };

  it("floors short labels at minTabWidth instead of shrinking further", () => {
    const width = computeWorkspaceTabRailWidth({
      tabLabelLengths: [1, 2],
      metrics: railMetrics,
    });

    expect(width).toBe(120);
  });

  it("sizes to the widest current label between the floor and the ceiling", () => {
    const width = computeWorkspaceTabRailWidth({
      tabLabelLengths: [9, 12],
      metrics: railMetrics,
    });

    expect(width).toBe(144);
  });

  it("clamps at maxTabWidth for long labels, matching today's horizontal cap", () => {
    const width = computeWorkspaceTabRailWidth({
      tabLabelLengths: [5, 40],
      metrics: railMetrics,
    });

    expect(width).toBe(200);
  });

  it("falls back to minTabWidth when there are no tabs", () => {
    const width = computeWorkspaceTabRailWidth({
      tabLabelLengths: [],
      metrics: railMetrics,
    });

    expect(width).toBe(120);
  });
});
