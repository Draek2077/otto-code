import { describe, test, expect } from "vitest";
import { retainedToolEnabled } from "../retained-tool-policy.js";
describe("retained Workflow group policy", () => {
  test("legacy agents selection includes its split orchestration group without overriding explicit v2", () => {
    expect(
      retainedToolEnabled(
        "orchestration",
        { mcp: { toolGroups: ["agents"] } },
        "start_workflow",
        "provider",
      ),
    ).toBe(true);
    expect(
      retainedToolEnabled(
        "orchestration",
        { mcp: { toolGroups: ["agents"], toolGroupsV2: [] } },
        "start_workflow",
        "provider",
      ),
    ).toBe(false);
    expect(
      retainedToolEnabled(
        "orchestration",
        { providers: { provider: { ottoToolGroups: ["agents"], ottoToolGroupsV2: [] } } },
        "start_workflow",
        "provider",
      ),
    ).toBe(false);
  });
  test("retained per-tool and global disables remain authoritative", () => {
    expect(
      retainedToolEnabled(
        "orchestration",
        { providers: { provider: { ottoTools: { disabledTools: ["start_workflow"] } } } },
        "start_workflow",
        "provider",
      ),
    ).toBe(false);
    expect(
      retainedToolEnabled(
        "orchestration",
        { mcp: { injectIntoAgents: false } },
        "start_workflow",
        "provider",
      ),
    ).toBe(false);
  });
});
