import { describe, expect, it } from "vitest";
import {
  COMPACT_RESOURCE_GROUP,
  estimateStripWidth,
  RESOURCE_GROUPS,
  resolveResourceBarLayout,
} from "@/components/client-resource-bar.layout";

const FULL_WIDTH = estimateStripWidth(RESOURCE_GROUPS, "full");
const SHORT_WIDTH = estimateStripWidth(RESOURCE_GROUPS, "short");

describe("resolveResourceBarLayout", () => {
  it("shows every group with full labels when there is room", () => {
    const layout = resolveResourceBarLayout({ availableWidth: FULL_WIDTH + 1, isCompact: false });

    expect(layout.labelMode).toBe("full");
    expect(layout.groups).toHaveLength(RESOURCE_GROUPS.length);
  });

  it("shows the full strip before it has measured itself, so the first frame is not degraded", () => {
    const layout = resolveResourceBarLayout({ availableWidth: 0, isCompact: false });

    expect(layout.labelMode).toBe("full");
    expect(layout.groups).toEqual(RESOURCE_GROUPS);
  });

  it("switches to acronyms before dropping anything", () => {
    const layout = resolveResourceBarLayout({ availableWidth: SHORT_WIDTH + 1, isCompact: false });

    expect(layout.labelMode).toBe("short");
    expect(layout.groups).toHaveLength(RESOURCE_GROUPS.length);
  });

  it("acronyms are a real saving, so shortening buys width before any group is lost", () => {
    expect(SHORT_WIDTH).toBeLessThan(FULL_WIDTH);
  });

  it("drops Timers first once acronyms are not enough", () => {
    const layout = resolveResourceBarLayout({ availableWidth: SHORT_WIDTH - 1, isCompact: false });

    expect(layout.groups.map((group) => group.id)).not.toContain("timers");
    expect(layout.groups.map((group) => group.id)).toContain("frames");
  });

  it("sheds groups progressively as the width falls", () => {
    const widths = [900, 700, 500, 300, 150];
    const counts = widths.map(
      (availableWidth) =>
        resolveResourceBarLayout({ availableWidth, isCompact: false }).groups.length,
    );

    // Monotonically non-increasing: narrower never shows more.
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
    }
  });

  it("never drops the frame timings, however narrow it gets", () => {
    const layout = resolveResourceBarLayout({ availableWidth: 1, isCompact: false });

    expect(layout.groups.map((group) => group.id)).toEqual(["frames"]);
    expect(layout.labelMode).toBe("short");
  });

  it("keeps the left-to-right diagnosis order when it drops groups", () => {
    const layout = resolveResourceBarLayout({ availableWidth: 400, isCompact: false });
    const order = RESOURCE_GROUPS.map((group) => group.id);
    const kept = layout.groups.map((group) => group.id);

    expect(kept).toEqual(order.filter((id) => kept.includes(id)));
  });

  it("shows exactly one curated group on compact, whatever the width says", () => {
    for (const availableWidth of [0, 320, 2000]) {
      const layout = resolveResourceBarLayout({ availableWidth, isCompact: true });

      expect(layout.groups).toEqual([COMPACT_RESOURCE_GROUP]);
      expect(layout.labelMode).toBe("short");
    }
  });

  it("the compact group leads with frame timings and the heap figure", () => {
    expect(COMPACT_RESOURCE_GROUP.fields.map((field) => field.id)).toEqual([
      "fps",
      "p95",
      "worst",
      "heap",
    ]);
  });
});
