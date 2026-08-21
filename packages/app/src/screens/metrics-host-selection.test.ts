import { describe, expect, it } from "vitest";
import { resolveMetricsHostServerId } from "./metrics-host-selection";

const hosts = [{ serverId: "remote" }, { serverId: "local" }];

describe("resolveMetricsHostServerId", () => {
  it("uses the explicit picker choice", () => {
    expect(
      resolveMetricsHostServerId({
        hosts,
        selectedServerId: "remote",
        activeWorkspaceServerId: "local",
        lastWorkspaceServerId: "local",
        localServerId: "local",
      }),
    ).toBe("remote");
  });

  it("follows the active workspace before falling back to the local daemon", () => {
    expect(
      resolveMetricsHostServerId({
        hosts,
        selectedServerId: null,
        activeWorkspaceServerId: "remote",
        lastWorkspaceServerId: "local",
        localServerId: "local",
      }),
    ).toBe("remote");
  });

  it("ignores hosts that are no longer registered", () => {
    expect(
      resolveMetricsHostServerId({
        hosts,
        selectedServerId: "removed",
        activeWorkspaceServerId: "removed",
        lastWorkspaceServerId: "removed",
        localServerId: "local",
      }),
    ).toBe("local");
  });
});
