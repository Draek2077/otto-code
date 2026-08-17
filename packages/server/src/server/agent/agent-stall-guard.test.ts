import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  buildStallInterruptMessage,
  classifyTimelineItem,
  createStallGuardState,
  hasStalled,
  latchStallGuard,
  observeStallSignal,
  type StallGuardState,
} from "./agent-stall-guard.js";

const THRESHOLD = 15;

function assistant(text: string, messageId?: string): AgentTimelineItem {
  return { type: "assistant_message", text, ...(messageId ? { messageId } : {}) };
}

function toolCall(callId: string, name = "read_file"): AgentTimelineItem {
  return {
    type: "tool_call",
    callId,
    name,
    status: "completed",
    detail: { type: "plain_text", text: name },
    error: null,
  };
}

function userMessage(text: string): AgentTimelineItem {
  return { type: "user_message", text };
}

/**
 * Feed a timeline through the guard the way the manager does, and report the
 * first index at which it would have stopped the run (null if it never trips).
 */
function runGuard(
  items: readonly AgentTimelineItem[],
  options: { threshold?: number; isSystemInjected?: (item: AgentTimelineItem) => boolean } = {},
): { state: StallGuardState; trippedAtIndex: number | null; trippedCount: number | null } {
  const threshold = options.threshold ?? THRESHOLD;
  let state = createStallGuardState();
  for (const [index, item] of items.entries()) {
    state = observeStallSignal(
      state,
      classifyTimelineItem(item, {
        isSystemInjected: options.isSystemInjected?.(item) ?? false,
      }),
    );
    if (hasStalled(state, threshold)) {
      return { state, trippedAtIndex: index, trippedCount: state.count };
    }
  }
  return { state, trippedAtIndex: null, trippedCount: null };
}

describe("agent stall guard", () => {
  it("stops a text-only stream once it reaches the threshold", () => {
    // The incident shape: the model announces the tool calls it intends to make
    // and never emits one. Each announcement is its own model round, so each
    // carries its own messageId.
    const items = Array.from({ length: 40 }, (_, index) =>
      assistant("Let me produce the three tool calls.", `msg-${index}`),
    );

    const { trippedAtIndex, trippedCount } = runGuard(items);

    expect(trippedCount).toBe(THRESHOLD);
    // Trips on the 15th message, not the 40th - the run stops early.
    expect(trippedAtIndex).toBe(THRESHOLD - 1);
  });

  it("never trips on a long interleaved working stream", () => {
    // 200 messages of real work: a tool call every few messages. This is the
    // false positive the guard must not produce, no matter how long it runs.
    const items: AgentTimelineItem[] = [];
    for (let round = 0; round < 200; round += 1) {
      items.push(assistant(`Thinking about step ${round}.`, `msg-${round}a`));
      items.push(assistant(`Still on step ${round}.`, `msg-${round}b`));
      items.push(assistant(`One more note on step ${round}.`, `msg-${round}c`));
      items.push(toolCall(`call-${round}`));
    }

    const { trippedAtIndex, state } = runGuard(items);

    expect(trippedAtIndex).toBeNull();
    expect(state.count).toBe(0);
  });

  it("resets the count to zero on a tool call", () => {
    const items = [
      ...Array.from({ length: THRESHOLD - 1 }, (_, index) => assistant("...", `pre-${index}`)),
      toolCall("call-1"),
      assistant("Back to work.", "post-1"),
    ];

    const { trippedAtIndex, state } = runGuard(items);

    expect(trippedAtIndex).toBeNull();
    // One message since the reset, not THRESHOLD.
    expect(state.count).toBe(1);
  });

  it("resets on a real user prompt so ordinary chat never trips", () => {
    // 40 conversational exchanges, every one of them text-only by design.
    const items: AgentTimelineItem[] = [];
    for (let turn = 0; turn < 40; turn += 1) {
      items.push(userMessage(`Question ${turn}?`));
      items.push(assistant(`Answer ${turn}.`, `msg-${turn}`));
    }

    const { trippedAtIndex, state } = runGuard(items);

    expect(trippedAtIndex).toBeNull();
    expect(state.count).toBe(1);
  });

  it("does not let a system-injected prompt reset the count", () => {
    // A daemon-authored nudge is the daemon talking to itself. If it reset the
    // guard, an automated re-prompt loop would be invisible to it.
    const items: AgentTimelineItem[] = [];
    for (let index = 0; index < 40; index += 1) {
      items.push(assistant("Going.", `msg-${index}`));
      items.push(userMessage("<system-injected>keep going</system-injected>"));
    }

    const { trippedCount } = runGuard(items, {
      isSystemInjected: (item) => item.type === "user_message",
    });

    expect(trippedCount).toBe(THRESHOLD);
  });

  it("counts one streamed message once, however many deltas it arrives in", () => {
    // openai-compat emits an assistant_message timeline event per content
    // delta, all sharing the round's messageId. 500 deltas is one message.
    const items = Array.from({ length: 500 }, () => assistant("chunk ", "same-message"));

    const { trippedAtIndex, state } = runGuard(items);

    expect(trippedAtIndex).toBeNull();
    expect(state.count).toBe(1);
  });

  it("collapses consecutive messages from providers that stamp no messageId", () => {
    // Without an id there is no way to tell a new message from another delta of
    // the current one, so they collapse into one unit. Under-counting is the
    // safe direction for a guard that stops runs.
    const items = Array.from({ length: 500 }, () => assistant("chunk "));

    const { trippedAtIndex, state } = runGuard(items);

    expect(trippedAtIndex).toBeNull();
    expect(state.count).toBe(1);
  });

  it("does not split a message on interleaved reasoning, todo, or error items", () => {
    const items: AgentTimelineItem[] = [
      assistant("Part one.", "msg-1"),
      { type: "reasoning", text: "hmm" },
      assistant(" Part two.", "msg-1"),
      { type: "todo", items: [{ text: "do it", completed: false }] },
      { type: "error", message: "something went wrong" },
      assistant(" Part three.", "msg-1"),
    ];

    const { state } = runGuard(items);

    expect(state.count).toBe(1);
  });

  it("treats threshold 0 as disabled", () => {
    const items = Array.from({ length: 1000 }, (_, index) => assistant("...", `msg-${index}`));

    const { trippedAtIndex, state } = runGuard(items, { threshold: 0 });

    expect(trippedAtIndex).toBeNull();
    expect(state.count).toBe(1000);
  });

  it("stays latched after a stop until a tool call or a user prompt clears it", () => {
    let state = latchStallGuard();

    // The tail of the burst that was already in flight when the run was stopped.
    for (let index = 0; index < 100; index += 1) {
      state = observeStallSignal(state, { kind: "assistant_message", messageId: `tail-${index}` });
      expect(hasStalled(state, THRESHOLD)).toBe(false);
    }

    state = observeStallSignal(state, { kind: "user_prompt" });
    expect(state.latched).toBe(false);

    // Counting resumes normally once cleared.
    state = observeStallSignal(state, { kind: "assistant_message", messageId: "after" });
    expect(state.count).toBe(1);
  });

  it("clears the latch on a tool call too", () => {
    const state = observeStallSignal(latchStallGuard(), { kind: "tool_call" });

    expect(state).toEqual(createStallGuardState());
  });

  it("names the count and the setting in the message the user sees", () => {
    const message = buildStallInterruptMessage(15);

    expect(message).toContain("no tool calls in 15 consecutive messages");
    expect(message).toContain("agentBehaviors.stallGuardThreshold");
  });
});
