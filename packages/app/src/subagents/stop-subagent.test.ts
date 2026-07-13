import { describe, expect, it, vi } from "vitest";
import { requestStopSubagent, type StopSubagentDeps } from "./stop-subagent";

function buildDeps(overrides: Partial<StopSubagentDeps> = {}): StopSubagentDeps {
  return {
    getSubagent: () => ({ attend: "attended" }),
    stopObservedSubagent: vi.fn(async () => {}),
    cancelAgent: vi.fn(async () => ({ cancelled: true })),
    reportError: vi.fn(),
    reportNothingToStop: vi.fn(),
    ...overrides,
  };
}

describe("requestStopSubagent", () => {
  it("stops an observed subagent via the provider stop path", async () => {
    const deps = buildDeps({ getSubagent: () => ({ attend: "observed" }) });

    await requestStopSubagent({ serverId: "s1", subagentId: "a::sub::1" }, deps);

    expect(deps.stopObservedSubagent).toHaveBeenCalledWith("a::sub::1");
    expect(deps.cancelAgent).not.toHaveBeenCalled();
  });

  it("cancels a native subagent's run", async () => {
    const deps = buildDeps({ getSubagent: () => ({ attend: "attended" }) });

    await requestStopSubagent({ serverId: "s1", subagentId: "native-1" }, deps);

    expect(deps.cancelAgent).toHaveBeenCalledWith("native-1");
    expect(deps.stopObservedSubagent).not.toHaveBeenCalled();
  });

  it("treats an unknown/absent record as native (no attend marker)", async () => {
    const deps = buildDeps({ getSubagent: () => undefined });

    await requestStopSubagent({ serverId: "s1", subagentId: "native-2" }, deps);

    expect(deps.cancelAgent).toHaveBeenCalledWith("native-2");
  });

  it("reports when the daemon had nothing to stop", async () => {
    // The run had already finished (or hadn't started) — the daemon says no
    // in-flight run was interrupted, so the user gets feedback, not a dead click.
    const deps = buildDeps({ cancelAgent: vi.fn(async () => ({ cancelled: false })) });

    await requestStopSubagent({ serverId: "s1", subagentId: "native-1" }, deps);

    expect(deps.reportNothingToStop).toHaveBeenCalledTimes(1);
    expect(deps.reportError).not.toHaveBeenCalled();
  });

  it("stays silent when an old daemon doesn't report the cancelled flag", async () => {
    const deps = buildDeps({ cancelAgent: vi.fn(async () => {}) });

    await requestStopSubagent({ serverId: "s1", subagentId: "native-1" }, deps);

    expect(deps.reportNothingToStop).not.toHaveBeenCalled();
  });

  it("reports errors instead of throwing", async () => {
    const failure = new Error("stop failed");
    const deps = buildDeps({
      getSubagent: () => ({ attend: "observed" }),
      stopObservedSubagent: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(
      requestStopSubagent({ serverId: "s1", subagentId: "a::sub::1" }, deps),
    ).resolves.toBeUndefined();
    expect(deps.reportError).toHaveBeenCalledWith(failure);
  });
});
