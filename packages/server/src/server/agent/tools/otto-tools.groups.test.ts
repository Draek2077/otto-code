import { describe, expect, test, vi } from "vitest";
import { OTTO_TOOL_GROUPS, ottoToolGroupForName } from "@otto-code/protocol/provider-config";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createOttoToolCatalog, type OttoToolHostDependencies } from "./otto-tools.js";

function host(overrides: Partial<OttoToolHostDependencies> = {}): OttoToolHostDependencies {
  return {
    agentManager: {
      getAgent: vi.fn(() => ({ id: "caller", cwd: "/project", config: {}, labels: {} })),
    } as unknown as OttoToolHostDependencies["agentManager"],
    agentStorage: {} as OttoToolHostDependencies["agentStorage"],
    providerSnapshotManager: {} as OttoToolHostDependencies["providerSnapshotManager"],
    callerAgentId: "caller",
    enableVoiceTools: true,
    readAgentProfiles: () => [],
    // Catalog construction must not invoke services; only execution does so.
    personalityMemory: {} as NonNullable<OttoToolHostDependencies["personalityMemory"]>,
    projectKnowledge: {} as NonNullable<OttoToolHostDependencies["projectKnowledge"]>,
    architecturalViews: {} as NonNullable<OttoToolHostDependencies["architecturalViews"]>,
    openArchitecturalView: vi.fn(),
    runService: {} as NonNullable<OttoToolHostDependencies["runService"]>,
    logger: createTestLogger(),
    ...overrides,
  };
}

describe("domain registrars share one Otto catalog boundary", () => {
  test("preserves the complete ordered chat-scoped tool surface", () => {
    expect([...createOttoToolCatalog(host()).tools.keys()]).toMatchSnapshot();
  });

  test.each(OTTO_TOOL_GROUPS)("%s cannot register tools outside its selected group", (group) => {
    const all = createOttoToolCatalog(host());
    const selected = createOttoToolCatalog(host({ enabledOttoToolGroups: [group] }));
    expect([...selected.tools.keys()]).toEqual(
      [...all.tools.keys()].filter((name) => ottoToolGroupForName(name) === group),
    );
  });

  test("an empty group selection withholds every built-in registrar", () => {
    expect(createOttoToolCatalog(host({ enabledOttoToolGroups: [] })).tools.size).toBe(0);
  });

  test("voice-only returns before registering ordinary tool groups", () => {
    expect([...createOttoToolCatalog(host({ voiceOnly: true })).tools.keys()]).toEqual([
      "read_architectural_view_draft",
      "update_architectural_view_draft",
      "show_architectural_view",
      "speak",
    ]);
  });

  test("optional groups are absent when their host services are not wired", () => {
    const catalog = createOttoToolCatalog(
      host({
        personalityMemory: undefined,
        projectKnowledge: undefined,
        architecturalViews: undefined,
        runService: undefined,
        readAgentProfiles: undefined,
      }),
    );
    for (const name of [
      "remember_lesson",
      "query_project_knowledge",
      "read_architectural_view_draft",
      "start_workflow",
      "list_agent_profiles",
    ]) {
      expect(catalog.getTool(name)).toBeUndefined();
    }
  });

  test("rejects invalid group input before reaching a service", async () => {
    const moveChatToWorkspace = vi.fn();
    const catalog = createOttoToolCatalog(host({ moveChatToWorkspace }));
    await expect(catalog.executeTool("move_chat_to_workspace", {})).rejects.toThrow();
    expect(moveChatToWorkspace).not.toHaveBeenCalled();
  });
});
