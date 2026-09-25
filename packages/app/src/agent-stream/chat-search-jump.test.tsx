// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useChatSearchJump, useChatSearchJumpStore } from "./chat-search-jump";
import type { StreamItem } from "@/types/stream";

const runtime = vi.hoisted(() => ({ fetchAgentTimeline: vi.fn() }));
afterEach(cleanup);
vi.mock("@/runtime/host-runtime", () => ({ getHostRuntimeStore: () => runtime }));
const target = { serverId: "host", agentId: "chat", epoch: "current", seq: 80 };
const message: StreamItem = {
  id: "message",
  kind: "user_message",
  text: "Orchard",
  timestamp: new Date("2026-09-25T00:00:00Z"),
  timelineCursor: { epoch: "current", seq: 80 },
};
beforeEach(() => {
  runtime.fetchAgentTimeline.mockReset();
  useChatSearchJumpStore.setState({ target: null });
});
function input(items: StreamItem[] = []) {
  return {
    serverId: "host",
    agentId: "chat",
    active: true,
    items,
    viewportRef: {
      current: {
        scrollToBottom: vi.fn(),
        prepareForViewportChange: vi.fn(),
        scrollToMessage: vi.fn(),
      },
    },
    reveal: vi.fn(() => false),
    onError: vi.fn(),
  };
}
test("a hidden retained pane does not consume the navigation intent", () => {
  const options = input([message]);
  useChatSearchJumpStore.setState({ target });
  const hook = renderHook(({ active }) => useChatSearchJump({ ...options, active }), {
    initialProps: { active: false },
  });
  expect(options.viewportRef.current.scrollToMessage).not.toHaveBeenCalled();
  expect(useChatSearchJumpStore.getState().target).toEqual(target);
  hook.rerender({ active: true });
  expect(options.viewportRef.current.scrollToMessage).toHaveBeenCalledExactlyOnceWith("message");
  expect(useChatSearchJumpStore.getState().target).toBeNull();
});
test("loads the requested window once, then scrolls to its matching message", async () => {
  const response = Promise.withResolvers<void>();
  runtime.fetchAgentTimeline.mockReturnValue(response.promise);
  const options = input();
  useChatSearchJumpStore.setState({ target });
  const hook = renderHook(({ items }) => useChatSearchJump({ ...options, items }), {
    initialProps: { items: [] as StreamItem[] },
  });
  expect(runtime.fetchAgentTimeline).toHaveBeenCalledOnce();
  hook.rerender({ items: [message] });
  await act(async () => response.resolve());
  expect(options.viewportRef.current.scrollToMessage).toHaveBeenCalledExactlyOnceWith("message");
});
test("stale or missing targets show an error rather than scrolling to an unrelated epoch", async () => {
  runtime.fetchAgentTimeline.mockResolvedValue({});
  const options = input([{ ...message, timelineCursor: { epoch: "old", seq: 80 } }]);
  useChatSearchJumpStore.setState({ target });
  renderHook(() => useChatSearchJump(options));
  await waitFor(() => expect(options.onError).toHaveBeenCalledOnce());
  expect(options.viewportRef.current.scrollToMessage).not.toHaveBeenCalled();
  expect(useChatSearchJumpStore.getState().target).toBeNull();
});
