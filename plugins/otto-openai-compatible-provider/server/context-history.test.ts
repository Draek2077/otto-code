import { expect, it } from "vitest";
import { ContextHistory } from "./context-history.js";
import type { StoredMessage } from "./prompt-content.js";

it("compacts complete older turns incrementally while retaining the full archive and tool ordering", () => {
  const messages: StoredMessage[] = [
    { role: "user", content: "old request".repeat(100) },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "read", type: "function", function: { name: "read", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "read", content: "old result".repeat(100) },
    { role: "user", content: [{ type: "image", mimeType: "image/png", sha256: "a".repeat(64) }] },
    { role: "assistant", content: "old answer".repeat(100) },
    { role: "user", content: "recent request" },
    { role: "assistant", content: "recent answer" },
  ];
  const history = new ContextHistory(messages);
  history.recordTurn("old", 0);
  history.recordTurn("recent", 5);
  const first = history.plan(20000, true)!;
  expect(first.throughIndex).toBe(5);
  expect(first.messages).toEqual(messages.slice(0, 5));
  history.commit(first, "Earlier: read the file and inspect the image.");
  expect(messages).toHaveLength(7);
  expect(history.active().slice(1)).toEqual(messages.slice(5));
  messages.push({ role: "user", content: "latest request" });
  history.recordTurn("latest", 7);
  messages.push({ role: "assistant", content: "latest answer" });
  const second = history.plan(20000, true)!;
  expect(second.throughIndex).toBe(7);
  expect(second.messages).toEqual([
    expect.objectContaining({ content: expect.stringContaining("Earlier:") }),
    ...messages.slice(5, 7),
  ]);
  const restored = new ContextHistory(messages, history.snapshot());
  expect(restored.active()).toEqual(history.active());
  expect(() => history.commit(second, "")).toThrow();
  expect(history.active()).toEqual(restored.active());
});

it("can compact a long single turn while retaining complete recent tool groups", () => {
  const messages: StoredMessage[] = [{ role: "user", content: "Original objective".repeat(100) }];
  for (let index = 0; index < 3; index += 1) {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: `tool-${index}`, type: "function", function: { name: "read", arguments: "{}" } },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: `tool-${index}`,
      content: "file contents".repeat(100),
    });
  }
  const history = new ContextHistory(messages);
  history.recordTurn("only-user", 0);
  const plan = history.plan(200)!;
  expect(plan.throughIndex).toBe(5);
  history.commit(plan, "Continue reading files for the original objective.");
  expect(history.active().slice(1)).toEqual(messages.slice(5));
  expect(new ContextHistory(messages, history.snapshot()).active()).toEqual(history.active());
});
