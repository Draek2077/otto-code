import { describe, expect, it } from "vitest";

import { buildResourceMetrics, type ResourceMetricsInput } from "./resource-metrics";

function input(view: ResourceMetricsInput["view"]): ResourceMetricsInput {
  return {
    stores: {},
    query: null,
    dom: null,
    view,
    heap: null,
    runtime: {
      liveIntervals: 0,
      pendingTimeouts: 0,
      intervalsCreated: 0,
      timeoutsCreated: 0,
      installed: 1,
    },
    traffic: null,
    chat: { streams: 0, agents: 0, chats: 0, workspaces: 0 },
    frames: null,
  };
}

describe("buildResourceMetrics view readings", () => {
  it("reports painted device pixels and what is shown on screen", () => {
    const metrics = buildResourceMetrics(
      input({
        cssWidth: 1920,
        cssHeight: 1080,
        devicePixelRatio: 2,
        focused: true,
        visible: true,
        shownWebviews: 1,
        shownCanvases: 0,
      }),
    );

    expect(metrics).toMatchObject({
      "view.cssWidth": 1920,
      "view.cssHeight": 1080,
      "view.devicePixelRatio": 2,
      "view.devicePixels": 1920 * 1080 * 4,
      "view.focused": 1,
      "view.visible": 1,
      "view.shownWebviews": 1,
      "view.shownCanvases": 0,
    });
  });

  it("omits view metrics when the reading is unavailable", () => {
    const metrics = buildResourceMetrics(input(null));

    expect(Object.keys(metrics).some((key) => key.startsWith("view."))).toBe(false);
  });
});
