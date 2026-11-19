import { expect, it, vi } from "vitest";
import { SuggestedTasks } from "./store.js";

const parent = { agentId: "chat-a", workspaceId: "workspace-a" };
const input = {
  title: "Check the old flow",
  summary: "Useful follow-up.",
  prompt: "private launch prompt",
};

it("publishes only the card and rejects sibling and cross-workspace launches", async () => {
  const store = new SuggestedTasks();
  const card = store.suggest(parent, input);
  expect(JSON.stringify(store.list(parent))).not.toContain(input.prompt);
  const launch = vi.fn(async () => "launched");
  await expect(
    store.start({ ...parent, workspaceId: "workspace-b" }, card.id, launch),
  ).rejects.toThrow("unavailable");
  expect(() => store.dismiss({ ...parent, agentId: "chat-b" }, card.id)).toThrow("unavailable");
  expect(launch).not.toHaveBeenCalled();
});

it("single-flights a launch and remembers the receipt", async () => {
  const store = new SuggestedTasks();
  const card = store.suggest(parent, input);
  let accept!: (id: string) => void;
  const launch = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        accept = resolve;
      }),
  );
  const first = store.start(parent, card.id, launch);
  await expect(store.start(parent, card.id, launch)).rejects.toThrow("already");
  accept("new chat");
  expect(await first).toBe("new chat");
  expect(launch).toHaveBeenCalledExactlyOnceWith(card, input.prompt);
  expect(store.list(parent)).toEqual([]);
  expect(store.dismiss(parent, card.id)).toBe(false);
});

it("does not re-admit a launch with an uncertain outcome", async () => {
  const store = new SuggestedTasks();
  const card = store.suggest(parent, input);
  await expect(
    store.start(parent, card.id, async () => {
      throw new Error("Lost acknowledgment");
    }),
  ).rejects.toThrow("Check the workspace");
  await expect(store.start(parent, card.id, async () => undefined)).rejects.toThrow("already");
});
