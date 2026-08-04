import { describe, expect, test } from "vitest";
import { readWidgetPayload } from "@otto-code/protocol/widgets/types";

import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { normalizeWidgetTimelineItem } from "./widget-timeline.js";

function widgetToolCall(input: unknown, name = "mcp__otto__show_widget"): AgentTimelineItem {
  return {
    type: "tool_call",
    callId: "toolu_widget_1",
    name,
    status: "running",
    error: null,
    detail: { type: "unknown", input, output: null },
  };
}

describe("normalizeWidgetTimelineItem", () => {
  test("turns a show_widget call into a renderable widget payload", () => {
    const item = normalizeWidgetTimelineItem(
      widgetToolCall({
        title: "q4_revenue",
        loading_messages: ["Plotting the bars"],
        widget_code: "<div>hello</div>",
      }),
    );

    expect(item.type).toBe("tool_call");
    const payload = readWidgetPayload(
      (item as Extract<AgentTimelineItem, { type: "tool_call" }>).metadata,
    );
    expect(payload).toEqual({
      version: 1,
      id: "toolu_widget_1",
      title: "q4_revenue",
      mode: "html",
      code: "<div>hello</div>",
      loadingMessages: ["Plotting the bars"],
    });
  });

  test("detects SVG mode from the fragment itself", () => {
    const item = normalizeWidgetTimelineItem(
      widgetToolCall({
        title: "logo",
        loading_messages: [],
        widget_code: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
      }),
    );
    expect(
      readWidgetPayload((item as Extract<AgentTimelineItem, { type: "tool_call" }>).metadata)?.mode,
    ).toBe("svg");
  });

  test("leaves a pending payload while widget_code is still streaming", () => {
    // Providers withhold a string argument until it closes, so title and
    // loading_messages legitimately arrive before the fragment does.
    const item = normalizeWidgetTimelineItem(
      widgetToolCall({ title: "chart", loading_messages: ["Counting things"] }),
    );
    const payload = readWidgetPayload(
      (item as Extract<AgentTimelineItem, { type: "tool_call" }>).metadata,
    );
    expect(payload?.code).toBe("");
    expect(payload?.loadingMessages).toEqual(["Counting things"]);
  });

  test("keeps a plain_text fallback detail so old clients render a row", () => {
    const item = normalizeWidgetTimelineItem(
      widgetToolCall({ title: "chart", loading_messages: [], widget_code: "<p>x</p>" }),
    );
    expect((item as Extract<AgentTimelineItem, { type: "tool_call" }>).detail).toEqual({
      type: "plain_text",
      label: "Widget",
      text: "chart",
      icon: "sparkles",
    });
  });

  test("surfaces a sanitize failure as visible text rather than a blank frame", () => {
    const item = normalizeWidgetTimelineItem(
      widgetToolCall({ title: "broken", loading_messages: [], widget_code: "just prose" }),
    );
    const toolCall = item as Extract<AgentTimelineItem, { type: "tool_call" }>;
    expect(readWidgetPayload(toolCall.metadata)).toBeNull();
    expect(toolCall.detail).toMatchObject({ type: "plain_text", label: "Widget" });
    expect(String((toolCall.detail as { text?: string }).text)).toContain("HTML or SVG");
  });

  test("is idempotent - re-running does not replace a good payload", () => {
    const once = normalizeWidgetTimelineItem(
      widgetToolCall({ title: "chart", loading_messages: [], widget_code: "<p>x</p>" }),
    );
    const twice = normalizeWidgetTimelineItem(once);
    expect(twice).toEqual(once);
  });

  test("ignores tool calls that are not show_widget", () => {
    const item = widgetToolCall({ widget_code: "<p>x</p>" }, "Read");
    expect(normalizeWidgetTimelineItem(item)).toBe(item);
  });

  test("recognizes the bare name the openai-compat tool loop uses", () => {
    // openai-compat injects Otto's catalog natively and exposes each tool under
    // its bare name, so a namespaced-only match would skip that provider.
    const item = normalizeWidgetTimelineItem(
      widgetToolCall({ title: "t", loading_messages: [], widget_code: "<p>x</p>" }, "show_widget"),
    );
    expect(
      readWidgetPayload((item as Extract<AgentTimelineItem, { type: "tool_call" }>).metadata),
    ).not.toBeNull();
  });

  test("recognizes the dotted Otto tool namespace as well as mcp__otto__", () => {
    const item = normalizeWidgetTimelineItem(
      widgetToolCall(
        { title: "t", loading_messages: [], widget_code: "<p>x</p>" },
        "otto.show_widget",
      ),
    );
    expect(
      readWidgetPayload((item as Extract<AgentTimelineItem, { type: "tool_call" }>).metadata),
    ).not.toBeNull();
  });
});
