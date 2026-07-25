import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  WIDGET_PROMPT_MAX_CHARS,
  WIDGET_PROMPT_MIN_INTERVAL_MS,
  WIDGET_PROMPT_SESSION_LIMIT,
} from "@otto-code/protocol/widgets/bridge";
import { useWidgetPromptStore } from "./prompt-store";

const TARGET = { serverId: "host-1", agentId: "agent-1" };

function send(text: string, now: number, widgetId = "widget-1") {
  return useWidgetPromptStore.getState().sendPrompt({ target: TARGET, widgetId, text, now });
}

describe("widget prompt store", () => {
  beforeEach(() => {
    useWidgetPromptStore.setState({ senders: {}, budgets: {} });
  });

  test("a widget with no registered chat cannot send", () => {
    // This IS the active-chat gate: only a mounted composer registers a sender,
    // so a widget in a background tab or an unopened transcript reaches nothing.
    expect(send("hello", 0)).toBe("no-target");
  });

  test("delivers to the registered chat", () => {
    const sender = vi.fn();
    useWidgetPromptStore.getState().registerSender(TARGET, sender);
    expect(send("  explain this  ", 0)).toBe("sent");
    expect(sender).toHaveBeenCalledWith("explain this");
  });

  test("caps length", () => {
    useWidgetPromptStore.getState().registerSender(TARGET, vi.fn());
    expect(send("x".repeat(WIDGET_PROMPT_MAX_CHARS + 1), 0)).toBe("too-long");
  });

  test("enforces a minimum interval between sends", () => {
    const sender = vi.fn();
    useWidgetPromptStore.getState().registerSender(TARGET, sender);
    expect(send("one", 1_000)).toBe("sent");
    expect(send("two", 1_000 + WIDGET_PROMPT_MIN_INTERVAL_MS - 1)).toBe("rate-limited");
    expect(send("two", 1_000 + WIDGET_PROMPT_MIN_INTERVAL_MS)).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(2);
  });

  test("exhausts a per-widget session budget however slowly it is spent", () => {
    useWidgetPromptStore.getState().registerSender(TARGET, vi.fn());
    let now = 0;
    for (let i = 0; i < WIDGET_PROMPT_SESSION_LIMIT; i += 1) {
      now += WIDGET_PROMPT_MIN_INTERVAL_MS;
      expect(send(`m${i}`, now)).toBe("sent");
    }
    expect(send("one more", now + 10 * WIDGET_PROMPT_MIN_INTERVAL_MS)).toBe("exhausted");
  });

  test("budgets are per widget, not per chat", () => {
    useWidgetPromptStore.getState().registerSender(TARGET, vi.fn());
    expect(send("a", 5_000, "widget-a")).toBe("sent");
    expect(send("b", 5_000, "widget-b")).toBe("sent");
  });

  test("unregistering only drops its own sender", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = useWidgetPromptStore.getState().registerSender(TARGET, first);
    useWidgetPromptStore.getState().registerSender(TARGET, second);
    // A remount installs the next composer's sender before the old cleanup runs.
    unregisterFirst();
    expect(send("hello", 0)).toBe("sent");
    expect(second).toHaveBeenCalledWith("hello");
    expect(first).not.toHaveBeenCalled();
  });
});
