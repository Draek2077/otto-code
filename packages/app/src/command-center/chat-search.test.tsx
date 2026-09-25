// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useChatSearch } from "./chat-search";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const fixture = vi.hoisted(() => ({
  hosts: [
    { serverId: "fast", label: "Fast" },
    { serverId: "slow", label: "Slow" },
  ],
  fast: { searchChatMessages: vi.fn(), refreshAgent: vi.fn(), resolveChatSearchMessage: vi.fn() },
  slow: { searchChatMessages: vi.fn() },
  online: true,
  supported: true,
  t: (key: string) => key,
  onError: vi.fn(),
  invalidateQueries: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => {
  const queryClient = { invalidateQueries: fixture.invalidateQueries };
  return { useQueryClient: () => queryClient };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: fixture.t }) }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => fixture.hosts,
  getHostRuntimeStore: () => ({
    getClient: (id: string) => (id === "fast" ? fixture.fast : fixture.slow),
    getSnapshot: (id: string) => ({
      connectionStatus: id === "slow" && !fixture.online ? "offline" : "online",
    }),
  }),
}));
vi.mock("@/stores/session-store", () => {
  const state = () => ({
    sessions: {
      fast: { serverInfo: { features: { chatContentSearch: true } } },
      slow: { serverInfo: { features: { chatContentSearch: fixture.supported } } },
    },
  });
  return {
    useSessionStore: Object.assign(
      (selector: (value: ReturnType<typeof state>) => unknown) => selector(state()),
      { getState: state },
    ),
  };
});
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/utils/command-center-focus-restore", () => ({
  clearCommandCenterFocusRestoreElement: vi.fn(),
}));
vi.mock("@/agent-stream/chat-search-jump", () => ({
  useChatSearchJumpStore: { getState: () => ({ setTarget: vi.fn() }) },
}));
const payload = {
  hits: [
    {
      id: "chat",
      messageKey: "key",
      title: "Chat",
      provider: "claude",
      projectName: "Project",
      role: "user",
      timestamp: "",
      snippet: "Orchard",
      archived: false,
    },
  ],
  coverage: { total: 1, indexed: 1, pending: 0, unavailable: 0 },
  hasMore: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  fixture.online = true;
  fixture.supported = true;
  fixture.fast.searchChatMessages.mockReset().mockResolvedValue(payload);
  fixture.slow.searchChatMessages.mockReset();
  fixture.fast.refreshAgent.mockReset().mockResolvedValue(undefined);
  fixture.fast.resolveChatSearchMessage.mockReset().mockResolvedValue({
    workspaceId: "restored-workspace",
    target: { epoch: "current", seq: 1 },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function useSearch() {
  return useChatSearch({ enabled: true, query: "orchard", onError: fixture.onError });
}
test("shows a fast host's matches while another host is still responding", async () => {
  const slow = Promise.withResolvers<typeof payload>();
  fixture.slow.searchChatMessages.mockReturnValue(slow.promise);
  const hook = renderHook(useSearch);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(hook.result.current.sections[0].results).toHaveLength(1);
  expect(hook.result.current.loading).toBe(true);
  await act(async () => slow.resolve(payload));
  expect(hook.result.current.sections[0].results).toHaveLength(2);
  expect(hook.result.current.loading).toBe(false);
});
test("does not queue a search on an offline host", async () => {
  fixture.online = false;
  const hook = renderHook(useSearch);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(fixture.slow.searchChatMessages).not.toHaveBeenCalled();
  expect(hook.result.current.sections[0].results).toHaveLength(1);
  expect(hook.result.current.status).toContain("historyUnavailable");
});
test("requires the host capability without falling back to metadata search", async () => {
  fixture.supported = false;
  const hook = renderHook(useSearch);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(fixture.slow.searchChatMessages).not.toHaveBeenCalled();
  expect(hook.result.current.status).toContain("updateHostForChats");
});

test("keeps archive state separate from title and metadata for the trailing pill", async () => {
  fixture.online = false;
  fixture.fast.searchChatMessages.mockResolvedValue({
    ...payload,
    hits: [{ ...payload.hits[0], archived: true }],
  });
  const hook = renderHook(useSearch);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(hook.result.current.sections[0].results[0]).toMatchObject({
    title: "Chat",
    provider: "claude",
    serverId: "fast",
    archived: true,
    subtitle: "Fast · Project · shell.commandCenter.you",
    snippet: "Orchard",
  });
});

test("restores archived matches before resolving the current timeline and navigating", async () => {
  fixture.online = false;
  fixture.fast.searchChatMessages.mockResolvedValue({
    ...payload,
    hits: [{ ...payload.hits[0], archived: true }],
  });
  const restored = Promise.withResolvers<void>();
  fixture.fast.refreshAgent.mockReturnValue(restored.promise);
  const hook = renderHook(useSearch);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const opening = hook.result.current.sections[0].results[0].run();
  expect(fixture.fast.refreshAgent).toHaveBeenCalledWith("chat");
  expect(fixture.fast.resolveChatSearchMessage).not.toHaveBeenCalled();
  await act(async () => {
    restored.resolve();
    await opening;
  });
  expect(fixture.fast.resolveChatSearchMessage).toHaveBeenCalledWith("chat", "key");
  expect(navigateToAgent).toHaveBeenCalledWith({
    serverId: "fast",
    agentId: "chat",
    workspaceId: "restored-workspace",
  });
  expect(fixture.invalidateQueries).toHaveBeenCalled();
});

test("reports a failed archived-chat restore without resolving or navigating", async () => {
  fixture.online = false;
  fixture.fast.searchChatMessages.mockResolvedValue({
    ...payload,
    hits: [{ ...payload.hits[0], archived: true }],
  });
  fixture.fast.refreshAgent.mockRejectedValue(new Error("Workspace cannot be restored"));
  const hook = renderHook(useSearch);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await act(async () => {
    await hook.result.current.sections[0].results[0].run();
  });
  expect(fixture.onError).toHaveBeenCalledWith("Workspace cannot be restored");
  expect(fixture.fast.resolveChatSearchMessage).not.toHaveBeenCalled();
  expect(navigateToAgent).not.toHaveBeenCalled();
});
