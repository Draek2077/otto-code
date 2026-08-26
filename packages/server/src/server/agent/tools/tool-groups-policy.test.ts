import { describe, expect, test } from "vitest";
import type { MutableDaemonConfig } from "../../daemon-config-store.js";
import { DaemonConfigOttoToolGroupsPolicy } from "./tool-groups-policy.js";

function policyFor(config: unknown): DaemonConfigOttoToolGroupsPolicy {
  return new DaemonConfigOttoToolGroupsPolicy({
    get: () => config as MutableDaemonConfig,
  });
}

describe("DaemonConfigOttoToolGroupsPolicy", () => {
  test("an absent selection means every group", () => {
    expect(policyFor({}).getEnabledGroups()).toBeUndefined();
    expect(policyFor({ mcp: {} }).getEnabledGroups()).toBeUndefined();
  });

  test("an empty selection means no Otto tools, not every group", () => {
    expect(policyFor({ mcp: { toolGroupsV2: [] } }).getEnabledGroups()).toEqual([]);
  });

  // A host configured before the "agents" split has no opinion on the seven
  // categories carved out of it. Reading that silence as "disabled" would strip
  // project knowledge, orchestration, memory, permissions, provider lookups,
  // tasks and voice from anyone who had ever touched a tool toggle.
  test("migrates a pre-split config forward instead of stripping the new categories", () => {
    const groups = policyFor({
      mcp: { injectIntoAgents: true, toolGroups: ["agents", "terminals"] },
    }).getEnabledGroups();
    expect(groups).toContain("knowledge");
    expect(groups).toContain("orchestration");
    expect(groups).toContain("tasks");
    expect(groups).toContain("terminals");
    expect(groups).not.toContain("artifacts");
  });

  test("honours a disabled category once the host has written the current key", () => {
    const groups = policyFor({
      mcp: {
        injectIntoAgents: true,
        toolGroups: ["agents", "terminals"],
        toolGroupsV2: ["agents", "terminals"],
      },
    }).getEnabledGroups();
    expect(groups).toEqual(["agents", "terminals"]);
    expect(groups).not.toContain("knowledge");
  });

  test("drops group names this daemon does not know rather than failing", () => {
    expect(
      policyFor({ mcp: { toolGroupsV2: ["terminals", "invented-later"] } }).getEnabledGroups(),
    ).toEqual(["terminals"]);
  });
});
