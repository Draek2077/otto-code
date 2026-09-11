/** @vitest-environment jsdom */
import React, { type PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { AgentContextUsage } from "@otto-code/protocol/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getAgentContextUsage: vi.fn<DaemonClient["getAgentContextUsage"]>(),
}));

// Only the host boundary is substituted; query caching and refreshes are real.
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => client,
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: () => true,
}));

import { useAgentContextUsage } from "./use-agent-context-usage";

const usage: AgentContextUsage = {
  maxTokens: 1000,
  totalTokens: 250,
  categories: [{ name: "Messages", tokens: 250 }],
};

let queryClient: QueryClient;
function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function refreshAndFlush(refresh: () => Promise<void>) {
  await act(async () => {
    await refresh();
    // React Query delivers observer notifications on the next timer turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  client.getAgentContextUsage.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("useAgentContextUsage", () => {
  it("keeps the displayed breakdown when a refresh has no live provider handle", async () => {
    client.getAgentContextUsage.mockResolvedValueOnce({
      requestId: "initial",
      agentId: "agent-a",
      usage,
    });
    const { result, unmount } = renderHook(() => useAgentContextUsage("host-a", "agent-a"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.usage).toEqual(usage));

    client.getAgentContextUsage.mockResolvedValue({
      requestId: "refresh",
      agentId: "agent-a",
      usage: null,
    });
    await refreshAndFlush(result.current.refresh);
    expect(result.current.usage).toEqual(usage);

    unmount();
    const reopened = renderHook(() => useAgentContextUsage("host-a", "agent-a"), {
      wrapper: Wrapper,
    });
    expect(reopened.result.current.usage).toEqual(usage);
  });

  it("replaces cached usage with a fresh measurement, including an empty context", async () => {
    client.getAgentContextUsage.mockResolvedValue({
      requestId: "initial",
      agentId: "agent-a",
      usage,
    });
    const { result } = renderHook(() => useAgentContextUsage("host-a", "agent-a"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.usage).toEqual(usage));

    const emptyUsage: AgentContextUsage = { maxTokens: 1000, totalTokens: 0, categories: [] };
    client.getAgentContextUsage.mockResolvedValue({
      requestId: "refresh",
      agentId: "agent-a",
      usage: emptyUsage,
    });
    await refreshAndFlush(result.current.refresh);
    expect(result.current.usage).toEqual(emptyUsage);
  });

  it.each([
    { serverId: "host-b", agentId: "agent-a" },
    { serverId: "host-a", agentId: "agent-b" },
  ])("never borrows a breakdown for $serverId/$agentId", async (next) => {
    client.getAgentContextUsage.mockResolvedValue({
      requestId: "initial",
      agentId: "agent-a",
      usage,
    });
    const { result, rerender } = renderHook(
      ({ serverId, agentId }) => useAgentContextUsage(serverId, agentId),
      { initialProps: { serverId: "host-a", agentId: "agent-a" }, wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.usage).toEqual(usage));

    client.getAgentContextUsage.mockResolvedValue({
      requestId: "refresh",
      agentId: next.agentId,
      usage: null,
    });
    rerender(next);
    await refreshAndFlush(result.current.refresh);
    expect(result.current.usage).toBeNull();

    rerender({ serverId: "host-a", agentId: "agent-a" });
    expect(result.current.usage).toEqual(usage);
  });
});
