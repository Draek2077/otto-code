import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { BrainHostStatus } from "@otto-code/protocol/messages";

import { deriveBrainState } from "@/components/brain/brain-state";
import {
  applyBrainStatusChanged,
  applyOptimisticBrainLifecycle,
  brainStatusQueryKey,
} from "@/data/brain-status";

const serverId = "server-1";
const ready: BrainHostStatus = {
  running: true,
  reachable: true,
  state: "ready",
  model: "some-model",
};

function statusMessage(brain: BrainHostStatus) {
  return { type: "status" as const, payload: { status: "brain_status_changed" as const, brain } };
}

describe("applyBrainStatusChanged", () => {
  it("replaces the entry whole rather than merging", () => {
    const queryClient = new QueryClient();
    const queryKey = brainStatusQueryKey(serverId, false);
    queryClient.setQueryData(queryKey, { ...ready, lastError: "an old failure" });

    applyBrainStatusChanged({ serverId, queryClient, message: statusMessage(ready) });

    // A snapshot is complete by contract, so a field the new one omits is a
    // field that is genuinely gone - merging would keep a stale error forever.
    expect(queryClient.getQueryData(queryKey)).toEqual(ready);
  });

  it("ignores a status broadcast that is not a brain snapshot", () => {
    const queryClient = new QueryClient();
    applyBrainStatusChanged({
      serverId,
      queryClient,
      message: { type: "status", payload: { status: "lsp_activity_changed", busyRoots: [] } },
    });
    expect(queryClient.getQueryData(brainStatusQueryKey(serverId, false))).toBeUndefined();
  });
});

describe("applyOptimisticBrainLifecycle", () => {
  it("shows a load starting before the brain has answered", () => {
    const queryClient = new QueryClient();
    const queryKey = brainStatusQueryKey(serverId, false);
    queryClient.setQueryData(queryKey, ready);

    applyOptimisticBrainLifecycle({ serverId, queryClient, lifecycle: "loading" });

    expect(deriveBrainState(queryClient.getQueryData<BrainHostStatus>(queryKey))).toBe("loading");
    // Only the lifecycle field moves; nothing else is guessed at.
    expect(queryClient.getQueryData(queryKey)).toEqual({ ...ready, state: "starting" });
  });

  it("shows an unload starting", () => {
    const queryClient = new QueryClient();
    const queryKey = brainStatusQueryKey(serverId, false);
    queryClient.setQueryData(queryKey, ready);

    applyOptimisticBrainLifecycle({ serverId, queryClient, lifecycle: "unloading" });

    expect(deriveBrainState(queryClient.getQueryData<BrainHostStatus>(queryKey))).toBe("unloading");
  });

  it("is replaced whole by the next authoritative snapshot, including a failure", () => {
    const queryClient = new QueryClient();
    const queryKey = brainStatusQueryKey(serverId, false);
    queryClient.setQueryData(queryKey, ready);
    applyOptimisticBrainLifecycle({ serverId, queryClient, lifecycle: "loading" });

    const failed: BrainHostStatus = {
      running: true,
      reachable: true,
      state: "failed",
      lastError: "does not fit",
    };
    applyBrainStatusChanged({ serverId, queryClient, message: statusMessage(failed) });

    expect(queryClient.getQueryData(queryKey)).toEqual(failed);
    expect(deriveBrainState(queryClient.getQueryData<BrainHostStatus>(queryKey))).toBe("error");
  });

  it("invents nothing when no status has ever been seen", () => {
    const queryClient = new QueryClient();
    applyOptimisticBrainLifecycle({ serverId, queryClient, lifecycle: "loading" });
    expect(queryClient.getQueryData(brainStatusQueryKey(serverId, false))).toBeUndefined();
  });
});
